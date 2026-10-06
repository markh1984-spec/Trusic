import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  Balance,
  BillingConfig,
  Me,
  PayArtistsResult,
  PayoutAccountStatus,
  SubscribeResult,
} from "@trusic/client";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revenueEntries, users } from "../src/db/schema";
import { currentPeriod } from "../src/payout-service";
import { ADMIN_EMAIL, call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

/** A stand-in for the bits of Stripe's API Trusic uses, recording what it was sent. */
function fakeStripe() {
  const requests: { method: string; path: string; body: URLSearchParams }[] = [];
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  const server: Server = createServer(async (req, res) => {
    const body = new URLSearchParams(await readBody(req));
    const path = req.url ?? "";
    requests.push({ method: req.method ?? "", path, body });
    const json = (o: object) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(o));
    };
    if (path === "/v1/checkout/sessions")
      return json({ id: "cs_1", object: "checkout.session", url: "https://checkout.test/cs_1" });
    if (path.startsWith("/v1/subscriptions/"))
      return json({ id: "sub_1", object: "subscription", cancel_at: 1_900_000_000 });
    if (path === "/v1/accounts" && req.method === "POST") return json({ id: "acct_1", object: "account" });
    if (path === "/v1/account_links") return json({ object: "account_link", url: "https://connect.test/onboard" });
    if (path.startsWith("/v1/accounts/"))
      return json({ id: "acct_1", object: "account", details_submitted: true, payouts_enabled: true });
    if (path === "/v1/transfers") return json({ id: "tr_1", object: "transfer", amount: Number(body.get("amount")) });
    res.statusCode = 404;
    json({ error: { message: `fake stripe has no ${path}` } });
  });
  return { server, requests };
}

const WEBHOOK_SECRET = "whsec_test_secret";
let t: TestApp;
let stripe: Stripe;
let fake: ReturnType<typeof fakeStripe>;

async function webhook(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return t.app.inject({
    method: "POST",
    url: "/api/billing/webhook",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

const event = (type: string, object: object) => ({
  id: `evt_${Math.random()}`,
  object: "event",
  type,
  data: { object },
});

beforeAll(async () => {
  fake = fakeStripe();
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  const { port } = fake.server.address() as AddressInfo;
  stripe = new Stripe("sk_test_fake", { host: "127.0.0.1", port, protocol: "http", maxNetworkRetries: 0 });
  t = await createTestApp({
    env: { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PAYOUT_MINIMUM_MINOR: "100" },
    stripe,
  });
});
afterAll(async () => {
  await t?.close();
  fake?.server.close();
});

describe("Stripe billing", () => {
  let listener: { token: string; id: string };

  it("sends listeners to Stripe Checkout at the VAT-inclusive price", async () => {
    expect((await call<BillingConfig>(t, "GET", "/api/billing/config")).body).toMatchObject({
      provider: "stripe",
      priceMinor: 1099,
    });
    listener = await register(t, "listener@trusic.test");
    const res = await call<SubscribeResult>(t, "POST", "/api/billing/subscribe", listener.token);
    expect(res.body).toEqual({ mode: "stripe", checkoutUrl: "https://checkout.test/cs_1" });
    const sent = fake.requests.find((r) => r.path === "/v1/checkout/sessions")!.body;
    expect(sent.get("client_reference_id")).toBe(listener.id);
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("1099");
    expect(sent.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    // Not Premium until Stripe confirms.
    expect((await call<Me>(t, "GET", "/api/me", listener.token)).body.user.plan).toBe("free");
  });

  it("rejects webhooks without a valid signature", async () => {
    const res = await webhook(event("checkout.session.completed", { client_reference_id: listener.id }), "whsec_wrong");
    expect(res.statusCode).toBe(400);
  });

  it("upgrades on checkout and books each paid invoice once, net of VAT", async () => {
    await webhook(
      event("checkout.session.completed", {
        client_reference_id: listener.id,
        customer: "cus_1",
        subscription: "sub_1",
      }),
    );
    expect((await call<Me>(t, "GET", "/api/me", listener.token)).body.user.plan).toBe("premium");

    const invoice = {
      id: "in_1",
      object: "invoice",
      customer: "cus_1",
      amount_paid: 1099,
      created: Math.floor(Date.now() / 1000),
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    };
    expect((await webhook(event("invoice.paid", invoice))).statusCode).toBe(200);
    await webhook(event("invoice.paid", invoice)); // Stripe retries happen.
    const rows = await t.database.db.select().from(revenueEntries).where(eq(revenueEntries.userId, listener.id));
    expect(rows.map((r) => [r.amount, r.period, r.externalRef])).toEqual([[916, currentPeriod(), "in_1"]]);
  });

  it("cancels at the end of the paid month, and downgrades when Stripe ends the subscription", async () => {
    const res = await call<{ endsAt: string }>(t, "POST", "/api/billing/cancel", listener.token);
    expect(res.body.endsAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect(fake.requests.find((r) => r.path === "/v1/subscriptions/sub_1")!.body.get("cancel_at_period_end")).toBe(
      "true",
    );
    expect((await call<Me>(t, "GET", "/api/me", listener.token)).body.user.plan).toBe("premium");

    await webhook(
      event("customer.subscription.deleted", {
        id: "sub_1",
        object: "subscription",
        customer: "cus_1",
        status: "canceled",
      }),
    );
    expect((await call<Me>(t, "GET", "/api/me", listener.token)).body.user.plan).toBe("free");
  });
});

describe("Stripe Connect payouts", () => {
  it("connects an artist, then pays their finalised balance once", async () => {
    const admin = await register(t, ADMIN_EMAIL);
    const artist = await register(t, "artist@trusic.test");
    const fan = await register(t, "fan@trusic.test");
    // A subscriber paying £10 (net) this month, so the fan's plays count.
    await t.database.db
      .insert(revenueEntries)
      .values({ userId: fan.id, period: currentPeriod(), source: "subscription", amount: 1000 });
    await t.database.db.update(users).set({ plan: "premium" }).where(eq(users.id, fan.id));

    const profile = (await call<{ id: string }>(t, "POST", "/api/artists", artist.token, { name: "Payees" })).body;
    const track = await sendFile(
      t,
      "POST",
      "/api/tracks",
      artist.token,
      { artistId: profile.id, title: "Paid", declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: "paid.wav", data: wav({ seconds: 40 }) },
    );
    await call(t, "POST", "/api/plays", fan.token, { trackId: (track.body as { id: string }).id, msPlayed: 35_000 });
    await call(t, "POST", "/api/admin/payouts/run", admin.token, { period: currentPeriod() });

    // Not finalised yet: nothing to pay.
    let pay = await call<PayArtistsResult>(t, "POST", "/api/admin/payouts/pay", admin.token);
    expect(pay.body.paid).toEqual([]);
    await call(t, "POST", `/api/admin/payouts/${currentPeriod()}/finalize`, admin.token);

    // The fan's £8 artist share, plus £7.33 from the earlier listener who paid but played nothing
    // (their share went to the human pot, and this is the only human track anyone played).
    const owed = 800 + 733;

    // Finalised, but no Stripe account yet.
    pay = await call<PayArtistsResult>(t, "POST", "/api/admin/payouts/pay", admin.token);
    expect(pay.body.skipped).toMatchObject([
      { userId: artist.id, available: owed, reason: expect.stringContaining("Stripe") },
    ]);

    expect((await call<PayoutAccountStatus>(t, "GET", "/api/me/payouts/status", artist.token)).body.connected).toBe(
      false,
    );
    const link = await call<{ url: string }>(t, "POST", "/api/me/payouts/connect", artist.token);
    expect(link.body.url).toBe("https://connect.test/onboard");
    expect((await call<PayoutAccountStatus>(t, "GET", "/api/me/payouts/status", artist.token)).body).toMatchObject({
      connected: true,
      payoutsEnabled: true,
    });

    pay = await call<PayArtistsResult>(t, "POST", "/api/admin/payouts/pay", admin.token);
    expect(pay.body.paid).toEqual([{ userId: artist.id, displayName: "artist", amount: owed, transferId: "tr_1" }]);
    const transfer = fake.requests.filter((r) => r.path === "/v1/transfers");
    expect(transfer.map((r) => [r.body.get("amount"), r.body.get("destination")])).toEqual([[String(owed), "acct_1"]]);

    // Paying again finds nothing left.
    pay = await call<PayArtistsResult>(t, "POST", "/api/admin/payouts/pay", admin.token);
    expect(pay.body.paid).toEqual([]);
    const balance = (await call<Balance>(t, "GET", "/api/me/balance", artist.token)).body;
    expect(balance).toMatchObject({ available: 0, balance: 0 });
  });
});
