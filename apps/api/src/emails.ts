/**
 * Every email Trusic sends, in plain English. Each has an HTML version and a plain-text one. Links point at the web
 * app (PUBLIC_URL).
 */
import { REPORT_REASON_NAMES, type ReportReason } from "@trusic/client";
import type { Email } from "./mailer";

interface Content {
  subject: string;
  /** e.g. "Hello Ellie,". Left out when we don't know the person's name. */
  greeting?: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Paragraphs after the button. */
  after?: string[];
  /** A quoted block, e.g. an admin's note or someone's counter-notice. */
  quote?: string;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const para = (text: string) => `<p style="margin:0 0 14px">${escape(text).replace(/\n/g, "<br>")}</p>`;

/** Turn content into an email with matching HTML and text versions. */
export function compose(to: string, content: Content): Email {
  const { subject, greeting, paragraphs, button, after = [], quote } = content;

  const text = [
    greeting,
    ...paragraphs,
    quote ? quote.replace(/^/gm, "> ") : undefined,
    button ? `${button.label}: ${button.url}` : undefined,
    ...after,
    "Trusic",
  ]
    .filter((p): p is string => Boolean(p))
    .join("\n\n");

  const html = [
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#f4f5f7;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1d2129">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">`,
    `<p style="margin:0 0 20px;font-size:20px;font-weight:bold">Trusic</p>`,
    greeting ? para(greeting) : "",
    ...paragraphs.map(para),
    quote
      ? `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #c3c8d0;background:#f4f5f7">${escape(quote).replace(/\n/g, "<br>")}</blockquote>`
      : "",
    button
      ? `<p style="margin:22px 0"><a href="${escape(button.url)}" style="display:inline-block;background:#3fd99a;color:#04150e;padding:12px 22px;border-radius:999px;font-weight:bold;text-decoration:none">${escape(button.label)}</a></p>` +
        `<p style="margin:0 0 14px;font-size:13px;color:#5b6370">If the button doesn't work, copy this link into your browser:<br><a href="${escape(button.url)}" style="color:#1d2129;word-break:break-all">${escape(button.url)}</a></p>`
      : "",
    ...after.map(para),
    `<p style="margin:24px 0 0;font-size:12px;color:#7a8290">Trusic: music streaming that pays the people who make it.</p>`,
    `</div></body></html>`,
  ].join("");

  return { to, subject, text, html };
}

const hello = (name: string | null | undefined) => (name ? `Hello ${name},` : "Hello,");
const reasonName = (reason: ReportReason) => REPORT_REASON_NAMES[reason];

export const emails = {
  verifyEmail: (o: { name: string; url: string }): Content => ({
    subject: "Confirm your email address",
    greeting: hello(o.name),
    paragraphs: [
      "Welcome to Trusic. Please confirm this is your email address. You can listen without doing this, but you'll need it to upload music or get paid.",
    ],
    button: { label: "Confirm my email", url: o.url },
    after: ["The link works for 3 days. If you didn't sign up for Trusic, you can ignore this email."],
  }),

  confirmNewEmail: (o: { name: string; url: string }): Content => ({
    subject: "Confirm your new email address",
    greeting: hello(o.name),
    paragraphs: [
      "You asked to change the email address on your Trusic account to this one. Your account keeps its old address until you confirm.",
    ],
    button: { label: "Confirm my new email", url: o.url },
    after: ["The link works for 3 days. If you didn't ask for this, you can ignore this email."],
  }),

  emailChangeRequested: (o: { name: string; newEmail: string; settingsUrl: string }): Content => ({
    subject: "Your Trusic email address is being changed",
    greeting: hello(o.name),
    paragraphs: [
      `Someone signed in to your Trusic account asked to change its email address to ${o.newEmail}. Nothing changes until that address is confirmed.`,
      "If this was you, there's nothing to do. If it wasn't, change your password now and sign out everywhere.",
    ],
    button: { label: "Go to settings", url: o.settingsUrl },
  }),

  resetPassword: (o: { url: string }): Content => ({
    subject: "Reset your Trusic password",
    greeting: "Hello,",
    paragraphs: ["Someone asked to reset the password for the Trusic account with this email address."],
    button: { label: "Choose a new password", url: o.url },
    after: [
      "The link works for 1 hour and only once. Choosing a new password signs you out on every other device.",
      "If you didn't ask for this, you can ignore this email. Your password won't change.",
    ],
  }),

  passwordChanged: (o: { name: string; resetUrl: string }): Content => ({
    subject: "Your Trusic password was changed",
    greeting: hello(o.name),
    paragraphs: [
      "The password for your Trusic account has just been changed, and your other devices have been signed out.",
      "If this wasn't you, reset your password straight away.",
    ],
    button: { label: "Reset my password", url: o.resetUrl },
  }),

  accountDeleted: (o: { name: string }): Content => ({
    subject: "Your Trusic account has been deleted",
    greeting: hello(o.name),
    paragraphs: [
      "Your Trusic account has been deleted, as you asked. Your profile, likes, playlists and follows are gone, and your uploads have come down.",
      "We keep an anonymous record of payments and plays, because other people's statements and our accounts depend on them. It no longer has your name or email address on it.",
      "You can sign up again with this email address at any time.",
    ],
  }),

  reportReceived: (o: { reference: string; targetTitle: string; reason: ReportReason }): Content => ({
    subject: `We've received your report (${o.reference})`,
    greeting: "Hello,",
    paragraphs: [
      `Thank you for reporting "${o.targetTitle}" for: ${reasonName(o.reason)}. Your reference is ${o.reference}.`,
      "A person at Trusic will look at it and email you when we've decided what to do, or if we need more information.",
    ],
  }),

  reportForAdmins: (o: {
    reference: string;
    targetTitle: string;
    reason: ReportReason;
    details: string;
    adminUrl: string;
  }): Content => ({
    subject: `New report: ${reasonName(o.reason)} (${o.reference})`,
    paragraphs: [`Someone has reported "${o.targetTitle}" for: ${reasonName(o.reason)}.`],
    quote: o.details,
    button: { label: "Open the admin queue", url: o.adminUrl },
    after: ["Copyright notices and illegal content should be dealt with quickly."],
  }),

  moreInfoNeeded: (o: { reference: string; targetTitle: string; question: string; replyUrl: string }): Content => ({
    subject: `We need more information about your report (${o.reference})`,
    greeting: "Hello,",
    paragraphs: [`Thank you for reporting "${o.targetTitle}". Before we can decide, we need to know a bit more:`],
    quote: o.question,
    button: { label: "Reply", url: o.replyUrl },
  }),

  reporterReplied: (o: { reference: string; message: string; adminUrl: string }): Content => ({
    subject: `Reply to report ${o.reference}`,
    paragraphs: [`The person who sent report ${o.reference} has replied:`],
    quote: o.message,
    button: { label: "Open the admin queue", url: o.adminUrl },
  }),

  reportRejected: (o: { reference: string; targetTitle: string; note: string }): Content => ({
    subject: `Your report (${o.reference}): we haven't taken it down`,
    greeting: "Hello,",
    paragraphs: [`We've looked at your report about "${o.targetTitle}" and decided not to take it down. Here's why:`],
    quote: o.note,
    after: ["If you have more information, you're welcome to send a new report."],
  }),

  reportUpheld: (o: { reference: string; targetTitle: string }): Content => ({
    subject: `Your report (${o.reference}): we've taken it down`,
    greeting: "Hello,",
    paragraphs: [
      `Thank you. We've looked at your report and taken down "${o.targetTitle}". It's no longer on Trusic.`,
      "The person who uploaded it can send a counter-notice if they think we've made a mistake. If they do, we'll let you know.",
    ],
  }),

  takenDown: (o: {
    name: string;
    targetTitle: string;
    reason: ReportReason;
    note: string;
    takedownUrl: string;
    strike: { count: number; limit: number; suspended: boolean } | null;
  }): Content => ({
    subject: `We've taken down "${o.targetTitle}"`,
    greeting: hello(o.name),
    paragraphs: [
      `We've taken down "${o.targetTitle}" after a report of ${reasonName(o.reason).toLowerCase()}. It's hidden everywhere on Trusic, it can't be played, and it doesn't earn money while it's down. Here's what our reviewer said:`,
    ],
    quote: o.note,
    button: { label: "See the details or send a counter-notice", url: o.takedownUrl },
    after: [
      ...(o.strike
        ? [
            `This counts as a copyright strike. You now have ${o.strike.count} of ${o.strike.limit}. ${
              o.strike.suspended
                ? "That's the limit, so your account is suspended: your music is hidden and you can't upload."
                : `At ${o.strike.limit}, your account is suspended.`
            } If the content is put back after a counter-notice, the strike is withdrawn.`,
          ]
        : []),
      "If you think we've got this wrong, send a counter-notice from the link above and we'll look again.",
    ],
  }),

  counterNoticeToReporter: (o: {
    reference: string;
    targetTitle: string;
    counterNotice: string;
    replyUrl: string;
  }): Content => ({
    subject: `The uploader has disputed your report (${o.reference})`,
    greeting: "Hello,",
    paragraphs: [
      `We took down "${o.targetTitle}" after your report. The person who uploaded it has sent a counter-notice saying it was taken down by mistake:`,
    ],
    quote: o.counterNotice,
    button: { label: "Reply to us", url: o.replyUrl },
    after: [
      "We may put it back. If you've started legal action about it, or have more to tell us, please reply within 10 working days.",
    ],
  }),

  counterNoticeToAdmins: (o: {
    reference: string;
    targetTitle: string;
    explanation: string;
    adminUrl: string;
  }): Content => ({
    subject: `Counter-notice for report ${o.reference}`,
    paragraphs: [`The uploader of "${o.targetTitle}" has sent a counter-notice:`],
    quote: o.explanation,
    button: { label: "Open the admin queue", url: o.adminUrl },
  }),

  restoredToUploader: (o: { name: string; targetTitle: string; note: string }): Content => ({
    subject: `"${o.targetTitle}" is back on Trusic`,
    greeting: hello(o.name),
    paragraphs: [`We've looked again and put "${o.targetTitle}" back. Here's what our reviewer said:`],
    quote: o.note,
    after: ["Any copyright strike from this takedown has been withdrawn."],
  }),

  restoredToReporter: (o: { reference: string; targetTitle: string; note: string }): Content => ({
    subject: `Your report (${o.reference}): the content has been put back`,
    greeting: "Hello,",
    paragraphs: [`After reviewing a counter-notice, we've put "${o.targetTitle}" back on Trusic. Here's why:`],
    quote: o.note,
  }),

  keptDown: (o: { name: string; targetTitle: string; note: string; takedownUrl: string }): Content => ({
    subject: `"${o.targetTitle}" will stay down`,
    greeting: hello(o.name),
    paragraphs: [`We've read your counter-notice about "${o.targetTitle}" and decided to keep it down. Here's why:`],
    quote: o.note,
    button: { label: "See the details", url: o.takedownUrl },
  }),

  labelReviewed: (o: { reference: string; targetTitle: string; outcome: string; note?: string }): Content => ({
    subject: `Your report (${o.reference}): we've reviewed the AI label`,
    greeting: "Hello,",
    paragraphs: [`Thank you for reporting the AI label on "${o.targetTitle}". ${o.outcome}`],
    quote: o.note,
  }),
};
