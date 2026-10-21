import type { Transporter } from "nodemailer";
import type { Config } from "./config";

export interface Email {
  to: string;
  subject: string;
  /** Plain-text version, for mail apps that don't show HTML. */
  text: string;
  html: string;
}

/** Sends email. Which kind depends on the settings: see `createMailer`. */
export interface Mailer {
  readonly kind: "console" | "smtp" | "memory";
  send(email: Email): Promise<void>;
}

/**
 * Prints each email, links included, to the server log instead of sending it. This is the default, so everything
 * works with no email account: on the demo, password-reset and confirmation links can be copied from the log.
 */
export class ConsoleMailer implements Mailer {
  readonly kind = "console";
  constructor(private readonly write: (text: string) => void = (text) => process.stdout.write(text)) {}

  async send(email: Email): Promise<void> {
    const rule = "─".repeat(72);
    this.write(
      `\n${rule}\nEmail (printed here because no SMTP server is set up)\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n${rule}\n`,
    );
  }
}

/** Sends through any SMTP service, e.g. Brevo's free plan (see docs/EMAIL.md). */
export class SmtpMailer implements Mailer {
  readonly kind = "smtp";
  private transport: Promise<Transporter> | null = null;

  constructor(
    private readonly from: string,
    private readonly smtp: NonNullable<Config["mail"]["smtp"]>,
  ) {}

  async send(email: Email): Promise<void> {
    // Loaded only when needed, so servers without SMTP don't spend memory on it.
    this.transport ??= import("nodemailer").then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: this.smtp.host,
        port: this.smtp.port,
        secure: this.smtp.secure,
        auth: this.smtp.user ? { user: this.smtp.user, pass: this.smtp.pass } : undefined,
      }),
    );
    const transport = await this.transport;
    await transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/** Keeps emails in memory. For tests, and for the seed script, which shouldn't send anything. */
export class MemoryMailer implements Mailer {
  readonly kind = "memory";
  readonly sent: Email[] = [];

  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
}

export function createMailer(config: Pick<Config, "mail">): Mailer {
  return config.mail.smtp ? new SmtpMailer(config.mail.from, config.mail.smtp) : new ConsoleMailer();
}

/**
 * Send without making the request wait for, or fail because of, the mail server. A lost email can be sent again
 * (every email here has a "send it again" route), but a failed sign-up or report is worse.
 */
export function sendLater(mailer: Mailer, email: Email): void {
  mailer.send(email).catch((error: unknown) => {
    console.error(`Couldn't send "${email.subject}" to ${email.to}: ${(error as Error).message}`);
  });
}
