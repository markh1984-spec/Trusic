# Switching on Stripe (test mode, free)

Out of the box Trusic uses **demo billing**: "Subscribe" works instantly and payouts are recorded without any
money moving. When you want to see real payment screens, switch on Stripe in **test mode**. A Stripe account is
free, test mode never charges anyone, and nothing here costs money until you take real payments (Stripe then
charges a fee per payment; there's no monthly fee).

## What Trusic does with Stripe

- **Listeners subscribe** on a Stripe Checkout page (£10.99/month including VAT). When the payment goes
  through, Stripe tells Trusic (a "webhook"), the account becomes Premium, and the payment is booked as revenue
  without the VAT.
- **Cancelling** keeps Premium until the end of the month already paid for.
- **Artists set up payouts** with Stripe Connect from Studio. Stripe checks their identity and bank details.
- **An admin pays artists** from the Admin page once a month is finalised. Everyone whose available balance has
  reached the minimum (£10 by default) is paid by Stripe transfer. Smaller balances roll over.

## Steps

1. **Create a Stripe account** at stripe.com. You don't need to activate payments or add a bank account for test
   mode.
2. Make sure the **Test mode** switch in the Stripe dashboard is on.
3. **Copy your test secret key** from Developers → API keys. It starts with `sk_test_`.
4. **Turn on Connect** (Connect → Get started) and choose a platform where users get paid
   ("Express" accounts). This is free in test mode.
5. **Tell Trusic.** In `apps/api/.env` (copy `apps/api/.env.example`), set:

   ```
   STRIPE_SECRET_KEY=sk_test_…
   PUBLIC_URL=http://localhost:5173
   ```

6. **Forward webhooks.** Stripe needs to reach Trusic to confirm payments.
   - **On your computer:** install the free Stripe CLI and run
     `stripe listen --forward-to localhost:3001/api/billing/webhook`. It prints a signing secret (`whsec_…`):
     put it in `STRIPE_WEBHOOK_SECRET`.
   - **Once Trusic is online:** in Developers → Webhooks, add an endpoint at
     `https://your-trusic-address/api/billing/webhook` with the events `checkout.session.completed`,
     `invoice.paid`, `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing
     secret into `STRIPE_WEBHOOK_SECRET`.
7. **Restart Trusic** (`pnpm dev`). The Your money page now says payments are handled by Stripe.
8. **Try it:** subscribe with card number `4242 4242 4242 4242`, any future expiry date and any CVC.

## Before taking real money

- Switch to live keys, and set the webhook up again in live mode.
- Decide how VAT is handled. Trusic currently assumes the price includes UK VAT at 20%. Stripe Tax can do this
  for you, for a fee.
- Deduct Stripe's fees from booked revenue (marked as a TODO in the code). Revenue is meant to be net of payment
  fees.
- Check the payout minimum and how often to pay.
