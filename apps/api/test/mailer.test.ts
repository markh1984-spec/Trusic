import { createServer, type Server } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { compose, emails } from "../src/emails";
import { ConsoleMailer, createMailer, SmtpMailer } from "../src/mailer";

describe("emails", () => {
  it("have matching HTML and text versions, with the link in both", () => {
    const email = compose(
      "ellie@trusic.test",
      emails.verifyEmail({ name: "Ellie <script>", url: "https://trusic.test/verify-email?token=abc&x=1" }),
    );
    expect(email.subject).toBe("Confirm your email address");
    expect(email.text).toContain("Hello Ellie <script>,");
    expect(email.text).toContain("Confirm my email: https://trusic.test/verify-email?token=abc&x=1");
    expect(email.html).toContain("Hello Ellie &lt;script&gt;,");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain('href="https://trusic.test/verify-email?token=abc&amp;x=1"');
  });
});

describe("mailers", () => {
  it("prints emails, links included, when no SMTP server is set", async () => {
    let printed = "";
    const mailer = new ConsoleMailer((text) => (printed += text));
    await mailer.send(
      compose("a@trusic.test", emails.resetPassword({ url: "https://trusic.test/reset-password?token=t" })),
    );
    expect(printed).toContain("To: a@trusic.test");
    expect(printed).toContain("Subject: Reset your Trusic password");
    expect(printed).toContain("https://trusic.test/reset-password?token=t");
    expect(createMailer(loadConfig({})).kind).toBe("console");
  });

  it("uses SMTP when SMTP_HOST is set", () => {
    const config = loadConfig({
      SMTP_HOST: "smtp-relay.example",
      SMTP_USER: "me",
      SMTP_PASS: "key",
      MAIL_FROM: "x@y.z",
    });
    expect(config.mail.smtp).toEqual({ host: "smtp-relay.example", port: 587, secure: false, user: "me", pass: "key" });
    expect(loadConfig({ SMTP_HOST: "h", SMTP_PORT: "465" }).mail.smtp?.secure).toBe(true);
    expect(createMailer(config).kind).toBe("smtp");
  });

  describe("over SMTP", () => {
    let server: Server;
    const received: string[] = [];
    afterAll(() => server?.close());

    it("delivers a message to an SMTP server", async () => {
      // Just enough of an SMTP server to accept one message.
      server = createServer((socket) => {
        let data = false;
        let message = "";
        socket.write("220 test ESMTP\r\n");
        socket.on("data", (chunk) => {
          const text = chunk.toString();
          if (data) {
            message += text;
            if (message.includes("\r\n.\r\n")) {
              data = false;
              received.push(message);
              socket.write("250 queued\r\n");
            }
            return;
          }
          for (const line of text.split("\r\n").filter(Boolean)) {
            const command = line.slice(0, 4).toUpperCase();
            if (command === "EHLO" || command === "HELO") socket.write("250 test\r\n");
            else if (command === "DATA") {
              data = true;
              socket.write("354 go ahead\r\n");
            } else if (command === "QUIT") socket.end("221 bye\r\n");
            else socket.write("250 ok\r\n");
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;

      const mailer = new SmtpMailer("Trusic <hello@trusic.test>", { host: "127.0.0.1", port, secure: false });
      await mailer.send(
        compose("fan@trusic.test", emails.passwordChanged({ name: "Fan", resetUrl: "https://x.test" })),
      );
      expect(received).toHaveLength(1);
      expect(received[0]).toContain("Subject: Your Trusic password was changed");
      expect(received[0]).toContain("To: fan@trusic.test");
      expect(received[0]).toContain("multipart/alternative");
    });
  });
});
