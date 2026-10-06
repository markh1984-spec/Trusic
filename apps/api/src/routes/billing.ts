import type {
  BillingConfig,
  CancelResult,
  PayArtistsResult,
  PayoutAccountStatus,
  SubscribeResult,
} from "@trusic/client";
import { eq, isNotNull, or, sql, sum } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";
import type { AppDeps } from "../app";
import { requireAdmin, requireUser } from "../auth";
import type { Db } from "../db/client";
import { ledgerEntries, payoutRuns, revenueEntries, users } from "../db/schema";
import { HttpError } from "../errors";
import { currentPeriod } from "../payout-service";
import { toUser } from "../views";

/**
 * Subscriptions and artist payouts.
 *
 * With STRIPE_SECRET_KEY set, listeners subscribe through Stripe Checkout and
 * webhooks record what they paid; artists are paid through Stripe Connect.
 * Without it, "demo billing" subscribes people instantly and records payouts
 * without moving money, so the whole flow can be tried for free.
 */
export const billingRoutes =
  ({ db, config, stripe }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const provider = stripe ? "stripe" : "demo";

    app.get("/billing/config", async () => {
      return {
        provider,
        priceMinor: config.premiumMonthlyPriceMinor,
        currency: config.currency,
        payoutMinimumMinor: config.payoutMinimumMinor,
      } satisfies BillingConfig;
    });

    app.post("/billing/subscribe", async (request) => {
      const user = await requireUser(db, request);
      if (!stripe) {
        await subscribeDemo(db, user.id, config.premiumMonthlyNetMinor);
        return { mode: "demo", user: toUser({ ...user, plan: "premium" }) } satisfies SubscribeResult;
      }
      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: user.id,
        ...(row?.stripeCustomerId ? { customer: row.stripeCustomerId } : { customer_email: user.email }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: config.currency.toLowerCase(),
              unit_amount: config.premiumMonthlyPriceMinor,
              recurring: { interval: "month" },
              product_data: { name: "Trusic Premium" },
            },
          },
        ],
        success_url: `${config.publicUrl}/money?subscribed=1`,
        cancel_url: `${config.publicUrl}/money`,
      });
      if (!session.url) throw new HttpError(502, "Stripe didn't return a checkout page.");
      return { mode: "stripe", checkoutUrl: session.url } satisfies SubscribeResult;
    });

    app.post("/billing/cancel", async (request) => {
      const user = await requireUser(db, request);
      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (stripe && row?.stripeSubscriptionId) {
        // Keep Premium until the end of the month they've paid for; the webhook ends it.
        const sub = await stripe.subscriptions.update(row.stripeSubscriptionId, { cancel_at_period_end: true });
        const endsAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;
        return { user: toUser(user), endsAt } satisfies CancelResult;
      }
      await db.update(users).set({ plan: "free" }).where(eq(users.id, user.id));
      return { user: toUser({ ...user, plan: "free" }), endsAt: null } satisfies CancelResult;
    });

    // Stripe signs the raw request body, so this route needs it unparsed.
    await app.register(async (hooks) => {
      hooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
      hooks.post("/billing/webhook", async (request, reply) => {
        if (!stripe || !config.stripeWebhookSecret) throw new HttpError(404, "Stripe isn't configured.");
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(
            request.body as Buffer,
            String(request.headers["stripe-signature"] ?? ""),
            config.stripeWebhookSecret,
          );
        } catch {
          throw new HttpError(400, "Invalid Stripe signature.");
        }
        await handleStripeEvent(db, config, event);
        return reply.code(200).send({ received: true });
      });
    });

    /** Artists connect a Stripe account to be paid into. */
    app.post("/me/payouts/connect", async (request) => {
      const user = await requireUser(db, request);
      if (!stripe) throw new HttpError(400, "Payouts are in demo mode, so there's nothing to connect.");
      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      let accountId = row?.stripeAccountId;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "GB",
          email: user.email,
          capabilities: { transfers: { requested: true } },
          metadata: { trusicUserId: user.id },
        });
        accountId = account.id;
        await db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, user.id));
      }
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${config.publicUrl}/studio`,
        return_url: `${config.publicUrl}/studio?connected=1`,
      });
      return { url: link.url };
    });

    app.get("/me/payouts/status", async (request) => {
      const user = await requireUser(db, request);
      if (!stripe) return { provider, connected: true, payoutsEnabled: true } satisfies PayoutAccountStatus;
      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!row?.stripeAccountId)
        return { provider, connected: false, payoutsEnabled: false } satisfies PayoutAccountStatus;
      const account = await stripe.accounts.retrieve(row.stripeAccountId);
      return {
        provider,
        connected: Boolean(account.details_submitted),
        payoutsEnabled: Boolean(account.payouts_enabled),
      } satisfies PayoutAccountStatus;
    });

    /**
     * Pay every artist whose available balance (finalised earnings, less any
     * clawbacks and earlier payouts) has reached the minimum.
     */
    app.post("/admin/payouts/pay", async (request) => {
      await requireAdmin(db, request);
      const balances = await availableBalances(db);
      const result: PayArtistsResult = { currency: config.currency, paid: [], skipped: [] };

      for (const b of balances) {
        if (b.available < config.payoutMinimumMinor) {
          if (b.available > 0) result.skipped.push({ ...b, reason: "Below the payout minimum; it rolls over." });
          continue;
        }
        if (stripe && !b.stripeAccountId) {
          result.skipped.push({ ...b, reason: "Hasn't connected a Stripe account yet." });
          continue;
        }
        // Record the payout first so it can't be paid twice, and undo it if the transfer fails.
        const [entry] = await db
          .insert(ledgerEntries)
          .values({
            userId: b.userId,
            type: "payout",
            amount: -b.available,
            note: stripe ? "Paid by Stripe" : "Paid (demo)",
          })
          .returning({ id: ledgerEntries.id });
        let transferId: string | null = null;
        if (stripe) {
          try {
            const transfer = await stripe.transfers.create(
              { amount: b.available, currency: config.currency.toLowerCase(), destination: b.stripeAccountId! },
              { idempotencyKey: `payout-${entry!.id}` },
            );
            transferId = transfer.id;
            await db
              .update(ledgerEntries)
              .set({ note: `Paid by Stripe (${transfer.id})` })
              .where(eq(ledgerEntries.id, entry!.id));
          } catch (error) {
            await db.delete(ledgerEntries).where(eq(ledgerEntries.id, entry!.id));
            result.skipped.push({ ...b, reason: `Stripe transfer failed: ${(error as Error).message}` });
            continue;
          }
        }
        result.paid.push({ userId: b.userId, displayName: b.displayName, amount: b.available, transferId });
      }
      return result;
    });
  };

async function subscribeDemo(db: Db, userId: string, netMinor: number) {
  const period = currentPeriod();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ plan: "premium" }).where(eq(users.id, userId));
    await tx
      .insert(revenueEntries)
      .values({ userId, period, source: "subscription", amount: netMinor, externalRef: `demo-${userId}-${period}` })
      .onConflictDoNothing();
  });
}

/** Each payee's available balance: everything except earnings from months not yet finalised. */
async function availableBalances(db: Db) {
  const rows = await db
    .select({
      userId: ledgerEntries.userId,
      available: sum(ledgerEntries.amount),
      displayName: users.displayName,
      stripeAccountId: users.stripeAccountId,
    })
    .from(ledgerEntries)
    .innerJoin(users, eq(users.id, ledgerEntries.userId))
    .leftJoin(payoutRuns, eq(payoutRuns.id, ledgerEntries.runId))
    .where(or(sql`${ledgerEntries.type} <> 'earnings'`, isNotNull(payoutRuns.finalizedAt)))
    .groupBy(ledgerEntries.userId, users.displayName, users.stripeAccountId);
  return rows.map((r) => ({ ...r, available: Number(r.available ?? 0) }));
}

type BillingSettings = Pick<AppDeps["config"], "vatRateBps">;

/** Keep plans and revenue in step with Stripe. Safe to receive the same event twice. */
export async function handleStripeEvent(db: Db, config: BillingSettings, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (!userId) return;
      await db
        .update(users)
        .set({
          plan: "premium",
          stripeCustomerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null),
        })
        .where(eq(users.id, userId));
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId || !invoice.id || invoice.amount_paid <= 0) return;
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, customerId))
        .limit(1);
      if (!user) return;
      const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
      // Prices include VAT; revenue is booked without it.
      // TODO: also deduct Stripe's fee once it's read from the balance transaction.
      const net = Math.round((invoice.amount_paid * 10_000) / (10_000 + config.vatRateBps));
      await db
        .insert(revenueEntries)
        .values({
          userId: user.id,
          period: currentPeriod(new Date(paidAt * 1000)),
          source: "subscription",
          amount: net,
          externalRef: invoice.id,
        })
        .onConflictDoNothing();
      await db.update(users).set({ plan: "premium" }).where(eq(users.id, user.id));
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const active = event.type === "customer.subscription.updated" && ["active", "trialing"].includes(sub.status);
      await db
        .update(users)
        .set({
          plan: active ? "premium" : "free",
          ...(event.type === "customer.subscription.deleted" ? { stripeSubscriptionId: null } : {}),
        })
        .where(eq(users.stripeCustomerId, customerId));
      return;
    }
    default:
      return;
  }
}

/** A Stripe client when a secret key is configured; otherwise demo billing is used. */
export function createStripeClient(
  config: Pick<AppDeps["config"], "stripeSecretKey">,
  options?: Stripe.StripeConfig,
): Stripe | null {
  return config.stripeSecretKey ? new Stripe(config.stripeSecretKey, options) : null;
}
