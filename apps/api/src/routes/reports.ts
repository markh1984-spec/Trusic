import {
  reportReference,
  type AdminCopyrightStrike,
  type AdminReport,
  type MyTakedown,
  type MyTakedowns,
  type ReporterView,
  type ReportMessage,
  type ReportReceipt,
  type ReportStatus,
  type ReportTarget,
} from "@trusic/client";
import { AI_LABELS, aiLabel } from "@trusic/core";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FullAppDeps } from "../app";
import { optionalUser, requireAdmin, requireUser, type AuthUser } from "../auth";
import type { Tx } from "../db/client";
import { copyrightStrikes, reportMessages, reports, tracks, users } from "../db/schema";
import { hashToken } from "../email-tokens";
import { compose, emails } from "../emails";
import { HttpError } from "../errors";
import { sendLater } from "../mailer";
import { applyReviewScore, issueStrike } from "../strikes";
import {
  COPYRIGHT_STRIKES_TO_SUSPEND,
  issueCopyrightStrike,
  recalculateOpenMonths,
  resolveTarget,
  restore,
  takeDown,
  toCopyrightStrike,
  withdrawCopyrightStrike,
  type ResolvedTarget,
} from "../takedowns";
import { loadTrackSummaries } from "../views";

const TARGET_TYPES = ["track", "release", "artist", "playlist", "artwork"] as const;
const REASONS = ["copyright", "offensive", "impersonation", "ai_label"] as const;

const CopyrightBody = z.object({
  role: z.enum(["owner", "agent"]),
  claimantName: z.string().trim().min(2, "Give the full name of the person making the claim.").max(200),
  organisation: z.string().trim().max(200).optional(),
  address: z.string().trim().min(5, "Give a postal address.").max(1000),
  phone: z.string().trim().max(50).optional(),
  work: z.string().trim().min(5, "Describe the work you say is being copied.").max(2000),
  goodFaith: z.literal(true, { error: "Please tick the good-faith statement." }),
  accurate: z.literal(true, { error: "Please tick the statement that the notice is accurate." }),
  signature: z.string().trim().min(2, "Type your full name as a signature.").max(200),
});

const ReportBody = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().trim().min(1).max(200),
  reason: z.enum(REASONS),
  details: z.string().trim().min(10, "Tell us a little more: at least 10 characters.").max(5000),
  reporterName: z.string().trim().max(120).optional(),
  reporterEmail: z.email().max(254).optional(),
  copyright: CopyrightBody.optional(),
});

const NoteBody = z.object({
  note: z.string().trim().min(5, "Write a short note: it's sent to the people involved.").max(5000),
});

const CounterNoticeBody = z.object({
  name: z.string().trim().min(2, "Type your full name as a signature.").max(200),
  explanation: z.string().trim().min(20, "Explain why, in at least 20 characters.").max(5000),
  goodFaith: z.literal(true, { error: "Please tick the good-faith statement." }),
  consentToShare: z.literal(true, {
    error: "We need to be able to pass your counter-notice to the person who reported it.",
  }),
});

const LabelReviewBody = z.object({
  /** The corrected score. Leave out to keep the current one. */
  score: z.number().int().min(0).max(100).optional(),
  /** A false declaration: issue a strike and claw back, as with a rejected appeal. */
  strike: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});

const QUEUES: Record<"action" | "waiting" | "closed", ReportStatus[]> = {
  action: ["open", "counter_notice"],
  waiting: ["needs_info"],
  closed: ["taken_down", "rejected", "restored", "resolved"],
};

/** Statuses in which an admin can still decide what to do with a report. */
const UNDECIDED: ReportStatus[] = ["open", "needs_info"];

/** What the uploader sees of a report's history. Questions to the reporter, and their answers, stay between them. */
const UPLOADER_MESSAGES = new Set(["taken_down", "counter_notice", "restored", "kept_down"]);

type ReportRow = typeof reports.$inferSelect;
type MessageRow = typeof reportMessages.$inferSelect;

const publicTarget = ({ type, id, title, description, path, artwork }: ResolvedTarget): ReportTarget => ({
  type,
  id,
  title,
  description,
  path,
  artwork,
});

/** Live content can be reported by anyone who can see it. */
const canReport = (target: ResolvedTarget | null, viewer: AuthUser | null): target is ResolvedTarget =>
  Boolean(
    target &&
    target.state === "live" &&
    (target.visibleTo === "everyone" || (viewer && viewer.id === target.ownerUserId)),
  );

function toMessage(m: MessageRow): ReportMessage {
  return {
    id: m.id,
    kind: m.kind,
    from: m.kind === "reporter_reply" ? "reporter" : m.kind === "counter_notice" ? "uploader" : "trusic",
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

function toMyTakedown(r: ReportRow, messages: MessageRow[]): MyTakedown {
  return {
    id: r.id,
    reference: reportReference(r.id),
    targetType: r.targetType,
    targetTitle: r.targetTitle,
    reason: r.reason,
    status: r.status,
    claimant: r.copyright
      ? { name: r.copyright.claimantName, organisation: r.copyright.organisation || null, work: r.copyright.work }
      : null,
    counterNotice: r.counterNotice,
    messages: messages.filter((m) => m.reportId === r.id && UPLOADER_MESSAGES.has(m.kind)).map(toMessage),
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/** A fresh link for the reporter to answer from. Only its hash is kept. */
const newReplyToken = () => randomBytes(24).toString("base64url");

/**
 * Reports and takedowns.
 *
 * Anyone can report something. Copyright, offensive-content and impersonation reports go to the admin takedown
 * queue, where an admin takes the content down, rejects the report or asks the reporter for more. A takedown emails
 * the uploader the reason; they can send a counter-notice, and an admin can put the content back. Upheld copyright
 * takedowns are copyright strikes. Wrong-label reports are settled with the same score review as appeals.
 */
export const reportRoutes =
  ({ db, config, mailer }: FullAppDeps): FastifyPluginAsync =>
  async (app) => {
    const link = (path: string) => `${config.publicUrl}${path}`;
    const adminUrl = link("/admin#reports");
    const replyUrl = (reportId: string, token: string) => link(`/report/reply/${reportId}?token=${token}`);

    function notifyAdmins(content: Parameters<typeof compose>[1]) {
      db.select({ email: users.email })
        .from(users)
        .where(and(eq(users.isAdmin, true), isNull(users.deletedAt)))
        .then((admins) => admins.forEach((a) => sendLater(mailer, compose(a.email, content))))
        .catch((error: unknown) => app.log.error(error));
    }

    /** The uploader, if they still have an account. */
    async function ownerOf(r: ReportRow) {
      if (!r.ownerUserId) return null;
      const [owner] = await db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, r.ownerUserId), isNull(users.deletedAt)))
        .limit(1);
      return owner ?? null;
    }

    async function loadReport(id: string): Promise<ReportRow> {
      const [row] = await db
        .select()
        .from(reports)
        .where(eq(reports.id, z.uuid().parse(id)))
        .limit(1);
      if (!row) throw new HttpError(404, "Report not found.");
      return row;
    }

    const addMessage = (
      tx: Tx,
      reportId: string,
      kind: MessageRow["kind"],
      body: string,
      authorUserId: string | null,
    ) => tx.insert(reportMessages).values({ reportId, kind, body, authorUserId });

    async function adminView(rows: ReportRow[]): Promise<AdminReport[]> {
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const ownerIds = [...new Set(rows.flatMap((r) => (r.ownerUserId ? [r.ownerUserId] : [])))];
      const trackIds = rows.filter((r) => r.reason === "ai_label").map((r) => r.targetId);
      const [messages, owners, strikeCounts, summaries, declared] = await Promise.all([
        db
          .select()
          .from(reportMessages)
          .where(inArray(reportMessages.reportId, ids))
          .orderBy(asc(reportMessages.createdAt)),
        ownerIds.length
          ? db
              .select({ id: users.id, displayName: users.displayName, email: users.email })
              .from(users)
              .where(inArray(users.id, ownerIds))
          : [],
        ownerIds.length
          ? db
              .select({ userId: copyrightStrikes.userId, n: count() })
              .from(copyrightStrikes)
              .where(and(inArray(copyrightStrikes.userId, ownerIds), isNull(copyrightStrikes.withdrawnAt)))
              .groupBy(copyrightStrikes.userId)
          : [],
        loadTrackSummaries(db, trackIds),
        trackIds.length
          ? db
              .select({ id: tracks.id, declaredScore: tracks.declaredScore })
              .from(tracks)
              .where(inArray(tracks.id, trackIds))
          : [],
      ]);
      const ownerById = new Map(owners.map((o) => [o.id, o]));
      const strikesById = new Map(strikeCounts.map((s) => [s.userId, s.n]));
      const declaredById = new Map(declared.map((d) => [d.id, d.declaredScore]));

      const out: AdminReport[] = [];
      for (const r of rows) {
        const target = await resolveTarget(db, r.targetType, r.targetId);
        const owner = r.ownerUserId ? ownerById.get(r.ownerUserId) : undefined;
        const summary = r.reason === "ai_label" ? summaries.get(r.targetId) : undefined;
        out.push({
          id: r.id,
          reference: reportReference(r.id),
          targetType: r.targetType,
          targetId: r.targetId,
          targetTitle: r.targetTitle,
          targetPath: target?.path ?? null,
          targetState: target?.state ?? "gone",
          reason: r.reason,
          details: r.details,
          status: r.status,
          reporter: { userId: r.reporterUserId, name: r.reporterName, email: r.reporterEmail },
          owner: owner ? { ...owner, copyrightStrikes: strikesById.get(owner.id) ?? 0 } : null,
          copyright: r.copyright,
          counterNotice: r.counterNotice,
          messages: messages.filter((m) => m.reportId === r.id).map(toMessage),
          track: summary ? { ...summary, declaredScore: declaredById.get(r.targetId) ?? summary.aiScore } : null,
          createdAt: r.createdAt.toISOString(),
          decidedAt: r.decidedAt?.toISOString() ?? null,
        });
      }
      return out;
    }

    const adminViewOf = async (id: string) => (await adminView([await loadReport(id)]))[0]!;

    // -- Reporting (anyone) ----------------------------------------------------------------------------------

    /** What the report form shows about the thing being reported. Artists can be looked up by slug. */
    app.get<{ Params: { type: string; id: string } }>("/report-targets/:type/:id", async (request) => {
      const viewer = await optionalUser(db, request);
      const type = z.enum(TARGET_TYPES).parse(request.params.type);
      const target = await resolveTarget(db, type, request.params.id);
      if (!canReport(target, viewer)) throw new HttpError(404, "We couldn't find that on Trusic.");
      return publicTarget(target);
    });

    app.post("/reports", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
      const viewer = await optionalUser(db, request);
      const body = ReportBody.parse(request.body);
      if (body.reason === "copyright" && !body.copyright) {
        throw new HttpError(400, "A copyright notice needs your details, the work concerned and both statements.");
      }
      if (body.reason === "ai_label" && body.targetType !== "track") {
        throw new HttpError(400, "AI labels belong to tracks, so please report the track itself.");
      }
      const target = await resolveTarget(db, body.targetType, body.targetId);
      if (!canReport(target, viewer)) throw new HttpError(404, "We couldn't find that on Trusic.");
      const reporterEmail = (body.reporterEmail ?? viewer?.email)?.toLowerCase();
      if (!reporterEmail) throw new HttpError(400, "Give us your email address so we can tell you what happens.");
      const copyright = body.reason === "copyright" ? body.copyright! : null;

      const [report] = await db
        .insert(reports)
        .values({
          targetType: target.type,
          targetId: target.id,
          targetTitle: target.title,
          ownerUserId: target.ownerUserId,
          reason: body.reason,
          details: body.details,
          reporterUserId: viewer?.id ?? null,
          reporterName: body.reporterName || copyright?.claimantName || viewer?.displayName || null,
          reporterEmail,
          copyright,
        })
        .returning();
      const reference = reportReference(report!.id);
      sendLater(
        mailer,
        compose(reporterEmail, emails.reportReceived({ reference, targetTitle: target.title, reason: body.reason })),
      );
      notifyAdmins(
        emails.reportForAdmins({
          reference,
          targetTitle: target.title,
          reason: body.reason,
          details: body.details,
          adminUrl,
        }),
      );
      return reply.code(201).send({ id: report!.id, reference } satisfies ReportReceipt);
    });

    /** The reporter's link from an email. It works while we're waiting to hear from them. */
    async function reportForReporter(id: string, token: string) {
      const row = await loadReport(id).catch(() => null);
      if (!row?.replyTokenHash || row.replyTokenHash !== hashToken(token)) {
        throw new HttpError(404, "This link isn't valid any more.");
      }
      return row;
    }

    async function reporterView(r: ReportRow): Promise<ReporterView> {
      let question: string | null = null;
      if (r.status === "needs_info") {
        const [latest] = await db
          .select({ body: reportMessages.body })
          .from(reportMessages)
          .where(and(eq(reportMessages.reportId, r.id), eq(reportMessages.kind, "info_request")))
          .orderBy(desc(reportMessages.createdAt))
          .limit(1);
        question = latest?.body ?? null;
      } else if (r.status === "counter_notice" && r.counterNotice) {
        question = `The uploader's counter-notice:\n\n${r.counterNotice.explanation}\n\n${r.counterNotice.name}`;
      }
      return {
        reference: reportReference(r.id),
        targetTitle: r.targetTitle,
        status: r.status,
        question,
        canReply: r.status === "needs_info" || r.status === "counter_notice",
      };
    }

    app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/reports/:id/reply", async (request) => {
      return reporterView(await reportForReporter(request.params.id, request.query.token ?? ""));
    });

    app.post<{ Params: { id: string } }>(
      "/reports/:id/reply",
      { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
      async (request) => {
        const body = z
          .object({ token: z.string().max(200), message: z.string().trim().min(2).max(5000) })
          .parse(request.body);
        const r = await reportForReporter(request.params.id, body.token);
        if (r.status !== "needs_info" && r.status !== "counter_notice") {
          throw new HttpError(409, "This report isn't waiting for a reply.");
        }
        await db.transaction(async (tx) => {
          await addMessage(tx, r.id, "reporter_reply", body.message, r.reporterUserId);
          await tx
            .update(reports)
            .set({ status: r.status === "needs_info" ? "open" : r.status, updatedAt: new Date() })
            .where(eq(reports.id, r.id));
        });
        notifyAdmins(emails.reporterReplied({ reference: reportReference(r.id), message: body.message, adminUrl }));
        return reporterView(await loadReport(r.id));
      },
    );

    // -- Uploaders -------------------------------------------------------------------------------------------

    app.get("/me/takedowns", async (request) => {
      const user = await requireUser(db, request);
      const [rows, strikes] = await Promise.all([
        db
          .select()
          .from(reports)
          .where(and(eq(reports.ownerUserId, user.id), isNotNull(reports.takedown)))
          .orderBy(desc(reports.createdAt)),
        db
          .select()
          .from(copyrightStrikes)
          .where(eq(copyrightStrikes.userId, user.id))
          .orderBy(desc(copyrightStrikes.createdAt)),
      ]);
      const messages = rows.length
        ? await db
            .select()
            .from(reportMessages)
            .where(
              inArray(
                reportMessages.reportId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(reportMessages.createdAt))
        : [];
      return {
        takedowns: rows.map((r) => toMyTakedown(r, messages)),
        copyrightStrikes: strikes.map(toCopyrightStrike),
        strikesToSuspend: COPYRIGHT_STRIKES_TO_SUSPEND,
      } satisfies MyTakedowns;
    });

    /** The uploader disputes a takedown. An admin then decides whether to put the content back. */
    app.post<{ Params: { id: string } }>("/me/takedowns/:id/counter-notice", async (request) => {
      const user = await requireUser(db, request);
      const body = CounterNoticeBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (r.ownerUserId !== user.id || !r.takedown) throw new HttpError(404, "Takedown not found.");
      if (r.counterNotice) {
        throw new HttpError(409, "You've already sent a counter-notice about this.");
      }
      if (r.status !== "taken_down") {
        throw new HttpError(409, "You can only send a counter-notice while the content is down.");
      }

      const counterNotice = { ...body, sentAt: new Date().toISOString() };
      const token = r.reporterEmail ? newReplyToken() : null;
      await db.transaction(async (tx) => {
        await tx
          .update(reports)
          .set({
            status: "counter_notice",
            counterNotice,
            ...(token ? { replyTokenHash: hashToken(token) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "counter_notice", body.explanation, user.id);
      });

      const reference = reportReference(r.id);
      notifyAdmins(
        emails.counterNoticeToAdmins({
          reference,
          targetTitle: r.targetTitle,
          explanation: body.explanation,
          adminUrl,
        }),
      );
      if (r.reporterEmail && token) {
        sendLater(
          mailer,
          compose(
            r.reporterEmail,
            emails.counterNoticeToReporter({
              reference,
              targetTitle: r.targetTitle,
              counterNotice: `${body.explanation}\n\n${body.name} (${user.email})`,
              replyUrl: replyUrl(r.id, token),
            }),
          ),
        );
      }
      const updated = await loadReport(r.id);
      const messages = await db.select().from(reportMessages).where(eq(reportMessages.reportId, r.id));
      return toMyTakedown(updated, messages);
    });

    // -- Admins ----------------------------------------------------------------------------------------------

    app.get<{ Querystring: { queue?: string; kind?: string } }>("/admin/reports", async (request) => {
      await requireAdmin(db, request);
      const queue = z.enum(["action", "waiting", "closed"]).default("action").parse(request.query.queue);
      const kind = z.enum(["takedown", "ai_label"]).optional().parse(request.query.kind);
      const rows = await db
        .select()
        .from(reports)
        .where(
          and(
            inArray(reports.status, QUEUES[queue]),
            kind === "ai_label" ? eq(reports.reason, "ai_label") : undefined,
            kind === "takedown" ? ne(reports.reason, "ai_label") : undefined,
          ),
        )
        .orderBy(queue === "closed" ? desc(reports.updatedAt) : asc(reports.createdAt))
        .limit(200);
      return adminView(rows);
    });

    /** Take the content down. The uploader is emailed why; a copyright takedown is also a copyright strike. */
    app.post<{ Params: { id: string } }>("/admin/reports/:id/take-down", async (request) => {
      const admin = await requireAdmin(db, request);
      const { note } = NoteBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (r.reason === "ai_label") {
        throw new HttpError(400, "Wrong-label reports are settled by reviewing the score, not by a takedown.");
      }
      if (!UNDECIDED.includes(r.status)) throw new HttpError(409, "This report has already been dealt with.");

      const { record, strike } = await db.transaction(async (tx) => {
        const record = await takeDown(tx, r.targetType, r.targetId);
        const now = new Date();
        await tx
          .update(reports)
          .set({ status: "taken_down", takedown: record, decidedByUserId: admin.id, decidedAt: now, updatedAt: now })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "taken_down", note, admin.id);
        const strike =
          r.reason === "copyright" && r.ownerUserId
            ? await issueCopyrightStrike(tx, {
                userId: r.ownerUserId,
                reportId: r.id,
                targetTitle: r.targetTitle,
                reason: note,
                issuedByUserId: admin.id,
              })
            : null;
        return { record, strike };
      });
      // Taken-down tracks stop earning in months that aren't finalised yet.
      if (record.tracks.length) await recalculateOpenMonths(db, config.currency);

      const owner = await ownerOf(r);
      if (owner) {
        sendLater(
          mailer,
          compose(
            owner.email,
            emails.takenDown({
              name: owner.displayName,
              targetTitle: r.targetTitle,
              reason: r.reason,
              note,
              takedownUrl: link(`/takedown/${r.id}`),
              strike: strike ? { ...strike, limit: COPYRIGHT_STRIKES_TO_SUSPEND } : null,
            }),
          ),
        );
      }
      if (r.reporterEmail) {
        sendLater(
          mailer,
          compose(
            r.reporterEmail,
            emails.reportUpheld({ reference: reportReference(r.id), targetTitle: r.targetTitle }),
          ),
        );
      }
      return adminViewOf(r.id);
    });

    app.post<{ Params: { id: string } }>("/admin/reports/:id/reject", async (request) => {
      const admin = await requireAdmin(db, request);
      const { note } = NoteBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (!UNDECIDED.includes(r.status)) throw new HttpError(409, "This report has already been dealt with.");
      await db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(reports)
          .set({ status: "rejected", decidedByUserId: admin.id, decidedAt: now, updatedAt: now, replyTokenHash: null })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "rejected", note, admin.id);
      });
      if (r.reporterEmail) {
        sendLater(
          mailer,
          compose(
            r.reporterEmail,
            emails.reportRejected({ reference: reportReference(r.id), targetTitle: r.targetTitle, note }),
          ),
        );
      }
      return adminViewOf(r.id);
    });

    app.post<{ Params: { id: string } }>("/admin/reports/:id/request-info", async (request) => {
      const admin = await requireAdmin(db, request);
      const { note } = NoteBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (!UNDECIDED.includes(r.status)) throw new HttpError(409, "This report has already been dealt with.");
      if (!r.reporterEmail) {
        throw new HttpError(400, "We don't have an email address for whoever sent this report, so we can't ask them.");
      }
      const token = newReplyToken();
      await db.transaction(async (tx) => {
        await tx
          .update(reports)
          .set({ status: "needs_info", replyTokenHash: hashToken(token), updatedAt: new Date() })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "info_request", note, admin.id);
      });
      sendLater(
        mailer,
        compose(
          r.reporterEmail,
          emails.moreInfoNeeded({
            reference: reportReference(r.id),
            targetTitle: r.targetTitle,
            question: note,
            replyUrl: replyUrl(r.id, token),
          }),
        ),
      );
      return adminViewOf(r.id);
    });

    /** Put taken-down content back, e.g. after a counter-notice. Its copyright strike is withdrawn. */
    app.post<{ Params: { id: string } }>("/admin/reports/:id/restore", async (request) => {
      const admin = await requireAdmin(db, request);
      const { note } = NoteBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if ((r.status !== "taken_down" && r.status !== "counter_notice") || !r.takedown) {
        throw new HttpError(409, "Only content that's been taken down can be put back.");
      }
      const record = r.takedown;
      await db.transaction(async (tx) => {
        await restore(tx, record, r.ownerUserId);
        await withdrawCopyrightStrike(tx, r.id);
        const now = new Date();
        await tx
          .update(reports)
          .set({ status: "restored", decidedByUserId: admin.id, decidedAt: now, updatedAt: now, replyTokenHash: null })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "restored", note, admin.id);
      });
      if (record.tracks.length) await recalculateOpenMonths(db, config.currency);

      const owner = await ownerOf(r);
      if (owner) {
        sendLater(
          mailer,
          compose(
            owner.email,
            emails.restoredToUploader({ name: owner.displayName, targetTitle: r.targetTitle, note }),
          ),
        );
      }
      if (r.reporterEmail) {
        sendLater(
          mailer,
          compose(
            r.reporterEmail,
            emails.restoredToReporter({ reference: reportReference(r.id), targetTitle: r.targetTitle, note }),
          ),
        );
      }
      return adminViewOf(r.id);
    });

    /** Turn down a counter-notice: the content stays down. */
    app.post<{ Params: { id: string } }>("/admin/reports/:id/keep-down", async (request) => {
      const admin = await requireAdmin(db, request);
      const { note } = NoteBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (r.status !== "counter_notice") throw new HttpError(409, "There's no counter-notice waiting on this report.");
      await db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(reports)
          .set({
            status: "taken_down",
            decidedByUserId: admin.id,
            decidedAt: now,
            updatedAt: now,
            replyTokenHash: null,
          })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "kept_down", note, admin.id);
      });
      const owner = await ownerOf(r);
      if (owner) {
        sendLater(
          mailer,
          compose(
            owner.email,
            emails.keptDown({
              name: owner.displayName,
              targetTitle: r.targetTitle,
              note,
              takedownUrl: link(`/takedown/${r.id}`),
            }),
          ),
        );
      }
      return adminViewOf(r.id);
    });

    /**
     * Settle a wrong-label report with the existing score review: change the score, or change it and issue a strike
     * for a false declaration (with the same clawback as a rejected appeal), or leave it as it is.
     */
    app.post<{ Params: { id: string } }>("/admin/reports/:id/label-review", async (request) => {
      const admin = await requireAdmin(db, request);
      const body = LabelReviewBody.parse(request.body);
      const r = await loadReport(request.params.id);
      if (r.reason !== "ai_label") throw new HttpError(400, "This isn't a wrong-label report.");
      if (!UNDECIDED.includes(r.status)) throw new HttpError(409, "This report has already been dealt with.");
      const [track] = await db.select().from(tracks).where(eq(tracks.id, r.targetId)).limit(1);
      if (!track) throw new HttpError(404, "Track not found.");

      let outcome: string;
      if (body.score !== undefined && body.score !== track.aiScore) {
        if (body.strike) {
          await issueStrike(db, {
            trackId: track.id,
            correctedScore: body.score,
            reason: body.note || "Reported by a listener: the track has more AI than declared.",
            issuedByUserId: admin.id,
            currency: config.currency,
          });
        } else {
          await applyReviewScore(db, track.id, body.score);
        }
        outcome = `We've changed its AI score from ${track.aiScore} to ${body.score}, so it's now labelled "${AI_LABELS[aiLabel(body.score)].name}".`;
      } else {
        if (body.strike) throw new HttpError(400, "A strike needs a corrected score.");
        outcome = `We've checked it, and its label stays "${AI_LABELS[aiLabel(track.aiScore)].name}" (AI score ${track.aiScore}).`;
      }

      await db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(reports)
          .set({ status: "resolved", decidedByUserId: admin.id, decidedAt: now, updatedAt: now, replyTokenHash: null })
          .where(eq(reports.id, r.id));
        await addMessage(tx, r.id, "label_reviewed", body.note ? `${outcome}\n\n${body.note}` : outcome, admin.id);
      });
      if (r.reporterEmail) {
        sendLater(
          mailer,
          compose(
            r.reporterEmail,
            emails.labelReviewed({
              reference: reportReference(r.id),
              targetTitle: r.targetTitle,
              outcome,
              note: body.note || undefined,
            }),
          ),
        );
      }
      return adminViewOf(r.id);
    });

    app.get("/admin/copyright-strikes", async (request) => {
      await requireAdmin(db, request);
      const rows = await db
        .select({ strike: copyrightStrikes, email: users.email, displayName: users.displayName })
        .from(copyrightStrikes)
        .innerJoin(users, eq(users.id, copyrightStrikes.userId))
        .orderBy(desc(copyrightStrikes.createdAt));
      return rows.map((r) => ({
        strike: toCopyrightStrike(r.strike),
        user: { id: r.strike.userId, email: r.email, displayName: r.displayName },
      })) satisfies AdminCopyrightStrike[];
    });
  };
