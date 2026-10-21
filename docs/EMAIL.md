# Email

Trusic sends emails for:

- confirming an email address (at sign-up, and when someone changes it);
- resetting a forgotten password, and saying a password was changed;
- confirming an account was deleted;
- reports and takedowns: receipts to people who report something, questions and decisions, takedown notices to
  uploaders, counter-notices, and alerts to admins about new reports.

## Out of the box: emails go to the log

With no settings, nothing is sent. Each email, links included, is printed in the server's log instead. That's how
the demo works:

- **On your computer** (`pnpm dev`), emails appear in the terminal that's running the API.
- **On Render**, open the **trusic** service and click **Logs**. Search for `Email (printed here` to find them.

So you can try everything, including password resets, without an email account. The demo accounts
(`…@trusic.local`) count as already confirmed.

## Sending real emails (free): Brevo

Any email service that offers SMTP works. Brevo is one with a free plan:

- **Free plan:** 300 emails a day, with no card needed to sign up
  ([Brevo](https://www.brevo.com/free-smtp-server/), [Brevo pricing for transactional email](https://www.brevo.com/products/transactional-email/)).
  That's plenty for a small launch: each sign-up uses one or two emails.
- **SMTP settings:** server `smtp-relay.brevo.com`, port `587`. The password is an **SMTP key** that you create in
  Brevo, not your Brevo password ([Brevo developer docs](https://developers.brevo.com/docs/smtp-integration)).

These limits were checked on 21 October 2026, through search results (Brevo's own pages couldn't be opened from
where this was written). Check Brevo's site before relying on them; free plans change.

### Steps

1. Sign up at [brevo.com](https://www.brevo.com) and choose the free plan.
2. **Add a sender.** In Brevo's settings, open the **Senders** page and add the address emails should come from, e.g.
   `hello@yourdomain.co.uk`. Brevo emails it a confirmation link. (If you own a domain, also follow Brevo's steps to
   "authenticate" it: emails are much less likely to land in spam.)
3. **Get an SMTP key.** In Brevo's settings, open **SMTP & API**, then the **SMTP** tab, and generate a new SMTP key.
   Copy the key and the **login** shown on that page.
4. **Tell Trusic.** Add these settings (on Render: the **trusic** service → **Environment**; on your computer:
   `apps/api/.env`):

   | Key          | Value                                                        |
   | ------------ | ------------------------------------------------------------ |
   | `SMTP_HOST`  | `smtp-relay.brevo.com`                                       |
   | `SMTP_PORT`  | `587`                                                        |
   | `SMTP_USER`  | The login from step 3                                        |
   | `SMTP_PASS`  | The SMTP key from step 3                                     |
   | `MAIL_FROM`  | `Trusic <hello@yourdomain.co.uk>` (the step 2 sender)        |
   | `PUBLIC_URL` | Only if you use your own domain: e.g. `https://trusic.co.uk` |

5. Restart the server (Render does this when you save). Its log now says `Sending email through smtp-relay.brevo.com`.

`PUBLIC_URL` is the address links in emails point to. On Render it's filled in automatically with your
`….onrender.com` address, so you only need it for your own domain, or when running Trusic somewhere else.

## Other services

Use any provider's SMTP details in the same settings. `SMTP_PORT` 465 uses a secure connection from the start; 587
and 2525 switch to one after connecting. Set `SMTP_SECURE=true` or `false` only if your provider says to.
