# Roadmap

## Done: foundation

- Payout engine and AI-score rubric (`packages/core`), tested to the penny.
- API: accounts, artist profiles, uploads with AI declaration, metadata-based detection, signed streaming with
  seeking, play logging, band splits, appeals and admin review, monthly payout runs, listener statements, artist
  earnings, public transparency data.
- Web app: browse and search, AI labels everywhere, persistent player (media keys and lock screen), upload with a
  live AI-score preview, track transparency pages, "where your money went", artist earnings, transparency page,
  admin.
- Typed client package ready for the desktop and mobile apps.

## Next: things Spotify has that we don't yet

- Library: likes, playlists, follows, listening history, queue management, shuffle/repeat.
- Releases: albums and EPs, artwork, credits, release dates, lyrics.
- Recommendations and editorial: home feed, radio, "Human-made only" mode.
- Accounts: email verification, password reset, sign in with Apple/Google, profile settings.
- Audio: transcode uploads to HLS/AAC at several bitrates and serve them from object storage behind a CDN
  (the `AudioStorage` interface and signed URLs are already in place for this). Loudness normalisation.
- Offline downloads (mobile and desktop).

## Apps

- **Desktop (Mac/Windows/Linux):** wrap the web app with Tauri (small, native) or Electron. The web app is a
  single-page app with one shared player, so most of the work is packaging, auto-update and media keys.
- **iPhone and Android:** React Native (Expo), reusing `@trusic/core` and `@trusic/client` so the rules and API
  types are shared. Needs background audio, lock-screen controls and offline storage.
- **App-store billing:** Apple and Google take 15–30% of in-app subscriptions. Revenue in the payout engine is
  _net_ revenue, so this is handled, but it changes what each subscriber is worth. Many services send sign-ups to
  the web instead; that's a business decision.

## Before launch (blocking real users or real money)

- **Real AI detection.** Evaluate audio-analysis detectors (commercial APIs and open models) against a labelled
  set of human, hybrid and generated tracks. Plug the winner in behind `AiDetector`. Keep it raise-only with human
  appeal.
- **Billing:** Stripe subscriptions on the web (with VAT handled), app-store billing on mobile, webhooks that write
  `revenue_entries`.
- **Paying artists:** Stripe Connect (or similar) payouts, KYC, minimum payout threshold, tax forms, and locking a
  payout month once it has been paid.
- **Score snapshots:** record each stream's AI score at play time, so mid-month appeals are fair.
- **Fraud:** per-listener stream caps, bot detection, device fingerprinting. User-centric payouts already stop
  stream farms from taking other listeners' money; they can still waste their own.
- **Rights and licensing:** take legal advice. Direct uploads from artists cover the recordings, but the
  _songwriting_ side (performing and mechanical rights, which PRS for Music and MCPS handle in the UK) normally
  needs licences and royalty reporting, and that may sit alongside or inside the 80%. Also needed: terms of
  service, an artist agreement covering the declaration and penalties, copyright takedown (DMCA-style) process and
  audio fingerprinting to stop people uploading other artists' music.
- **Security and operations:** move web sessions to httpOnly cookies, audit logging for admin actions, backups,
  monitoring, rate limits tuned for production, GDPR (data export and deletion).
