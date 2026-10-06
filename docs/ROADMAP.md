# Roadmap

## Done

**Foundation**

- Payout engine and AI-score rubric (`packages/core`), tested to the penny.
- API: accounts, artist profiles, uploads with AI declaration, metadata-based detection, signed streaming with
  seeking, play logging, band splits, appeals and admin review, monthly payout runs, listener statements, artist
  earnings, public transparency data.
- Web app: browse and search, AI labels everywhere, persistent player (media keys and lock screen), upload with a
  live AI-score preview, track transparency pages, "where your money went", artist earnings, transparency page,
  admin.
- Typed client package ready for the desktop and mobile apps.

**Library and releases**

- Releases: albums, EPs and singles with artwork, release dates and track order, plus a release editor in Studio.
  Uploads can go straight onto a release. Release cards carry an AI label too.
- Artist pages: photo, followers, follow button, discography.
- Library: liked songs, playlists (public or private, reorder, duplicates allowed), followed artists, recently
  played.
- Player: queue panel, play next, add to queue, shuffle, repeat (all or one), "add to playlist" from any track.
- Each play records the track's AI score at the time it was played, ready for open question 7.

**Money and rules**

- Subscribers only, no adverts. Visitors and non-subscribers can browse and hear 30-second previews, which never
  count as plays.
- AI assistance is free; labels are "Human-made", "Partly AI" and "AI Slop".
- Strikes for false declarations: exact clawbacks for finalised months, recalculation of open months, suspension at
  three strikes, admin reinstatement. Artist balances with a ledger.
- Songwriting details (writers, collecting-society membership, covers, ISRC) collected at upload, with a summary for
  PRS in admin.
- Stripe in test mode: Checkout subscriptions with VAT-inclusive pricing and signed webhooks; artist payouts through
  Stripe Connect with a £10 minimum. Without Stripe keys, demo billing works with pretend money.

**Online**

- One Docker image and a Render blueprint for a free public demo (sign-ups closed, shared demo password). See
  [HOSTING.md](HOSTING.md).

## Next: things Spotify has that we don't yet

- Recommendations and editorial: personalised home feed, radio, "Human-made only" listening mode.
- Accounts: email verification, password reset, sign in with Apple/Google, profile settings.
- Releases: lyrics, pre-release scheduling.
- Audio: transcode uploads to HLS/AAC at several bitrates and serve them from object storage behind a CDN
  (the `MediaStorage` interface and signed URLs are already in place for this). Loudness normalisation. Resize
  artwork to standard sizes.
- Social: shareable links with previews, collaborative playlists.
- Offline downloads (mobile and desktop).

## Apps

- **Desktop (Mac/Windows/Linux):** wrap the web app with Tauri (small, native) or Electron. The web app is a
  single-page app with one shared player, so most of the work is packaging, auto-update and media keys.
- **iPhone and Android:** first version in `apps/mobile` (Expo), reusing `@trusic/core`, `@trusic/client` and the
  shared queue in `@trusic/player`. It has browse, search, AI labels, the player with background audio, library,
  "your money" and accounts, and can be tried on a phone with Expo Go. Next: test builds with EAS Build, offline
  downloads, and the app-store decisions below.
- **App-store billing:** Apple and Google take 15–30% of in-app subscriptions. Revenue in the payout engine is
  _net_ revenue, so this is handled, but it changes what each subscriber is worth. Note that PRS calculates its fee
  on revenue before those fees. Many services send sign-ups to the web instead; that's a business decision.

## Before launch (blocking real users or real money)

- **Real AI detection.** Trial Deezer's licensed detector, ACRCloud and IRCAM Amplify against a labelled test set
  of human, hybrid and generated tracks, including human tracks processed with the AI tools Trusic allows. Plug the
  winner in behind `AiDetector`. Keep it raise-only with human appeal. The full plan is in
  [research/ai-detection.md](research/ai-detection.md).
- **Rights and licensing.** Get a PRS for Music licence for the songwriting side (its small-service licence is 16%
  of revenue, with an unverified per-stream minimum that could matter a lot), decide how that fits the 80/20 split
  (open question 10), and add ISWCs to the songwriter details already collected at upload. Also needed: an artist agreement
  covering the declaration and penalties, a takedown and repeat-infringer process, audio fingerprinting, and an
  Online Safety Act risk assessment within three months of launch. See
  [research/uk-licensing.md](research/uk-licensing.md) and its checklist for a music lawyer.
- **Billing:** switch Stripe to live mode (see [STRIPE.md](STRIPE.md)), deduct Stripe's fees from booked revenue,
  and decide on app-store billing for the phone apps (or keep sending people to the website).
- **Paying artists:** Stripe Connect's identity checks (KYC) and tax forms in live mode, and a payout schedule.
- **Hosting that keeps data:** a real Postgres database (`DATABASE_URL`), object storage for audio and artwork, and a
  server that doesn't sleep. The free demo deliberately resets on every restart.
- **Fraud:** per-listener stream caps, bot detection, device fingerprinting. User-centric payouts already stop
  stream farms from taking other listeners' money; they can still waste their own.
- **Security and operations:** move web sessions to httpOnly cookies, audit logging for admin actions, backups,
  monitoring, rate limits tuned for production, GDPR (data export and deletion).
