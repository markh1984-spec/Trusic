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

**Desktop app**

- Mac, Windows and Linux app (Electron, `apps/desktop`) that runs the web app unchanged, with media keys and the
  system's "now playing" controls. The server is chosen in the app. Unsigned installers come from a manual GitHub
  workflow.

## Next: things Spotify has that we don't yet

- Recommendations and editorial: personalised home feed, radio, "Human-made only" listening mode.
- Accounts: email verification, password reset, sign in with Apple/Google, profile settings.
- Releases: credits, lyrics, pre-release scheduling.
- Audio: transcode uploads to HLS/AAC at several bitrates and serve them from object storage behind a CDN
  (the `MediaStorage` interface and signed URLs are already in place for this). Loudness normalisation. Resize
  artwork to standard sizes.
- Social: shareable links with previews, collaborative playlists.
- Offline downloads (mobile and desktop).

## Apps

- **Desktop (Mac/Windows/Linux):** the app exists (see Done). Still to do: code signing (Apple Developer Program
  and a Windows certificate), automatic updates, and cover art in the system's media controls, which needs the
  web app to hand its artwork to `navigator.mediaSession` as a `blob:` URL.
- **iPhone and Android:** React Native (Expo), reusing `@trusic/core` and `@trusic/client` so the rules and API
  types are shared. Needs background audio, lock-screen controls and offline storage.
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
  (open question 10), and collect ISRC, ISWC and songwriter details at upload. Also needed: an artist agreement
  covering the declaration and penalties, a takedown and repeat-infringer process, audio fingerprinting, and an
  Online Safety Act risk assessment within three months of launch. See
  [research/uk-licensing.md](research/uk-licensing.md) and its checklist for a music lawyer.
- **Billing:** Stripe subscriptions on the web (with VAT handled), app-store billing on mobile, webhooks that write
  `revenue_entries`.
- **Paying artists:** Stripe Connect (or similar) payouts, KYC, minimum payout threshold, tax forms, and locking a
  payout month once it has been paid.
- **Fraud:** per-listener stream caps, bot detection, device fingerprinting. User-centric payouts already stop
  stream farms from taking other listeners' money; they can still waste their own.
- **Security and operations:** move web sessions to httpOnly cookies, audit logging for admin actions, backups,
  monitoring, rate limits tuned for production, GDPR (data export and deletion).
