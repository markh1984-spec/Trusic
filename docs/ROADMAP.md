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
- The demo can keep its data for free with a Supabase project: Postgres for the database, and its S3-compatible
  storage for audio and artwork (Cloudflare R2, Backblaze B2 and MinIO work too). The demo data is loaded once, into
  an empty database.

**Audio and artwork**

- Uploads are converted in the background with ffmpeg: 160 kbps AAC (about 1.2 MB a minute, against 10 MB for
  WAV), turned up or down towards −14 LUFS without compressing anything, plus a separate 30-second preview file. The
  upload itself is kept privately, so tracks can be re-encoded later. New tracks show as "Processing" in Studio and
  go live when they're ready; work interrupted by a restart carries on.
- Artwork and artist photos are cropped square and kept as WebP at 120, 300 and 640 pixels. The web, desktop and
  phone apps load the size they show.

**Accounts, reports and takedowns**

- Email: printed to the server log by default, or sent through any SMTP service (Brevo's free plan is documented in
  [EMAIL.md](EMAIL.md)).
- Email confirmation (needed to upload or be paid, not to listen), forgotten passwords, and a Settings page: name,
  email, password, sign out everywhere.
- Your data: download everything as a JSON file, or delete the account, with money records kept anonymously.
- Reports for copyright, offensive or illegal content, impersonation and wrong AI labels, from a "Report…" item on
  tracks, releases, artists and playlists, by anyone. An admin takedown queue with counter-notices and restoring,
  copyright strikes (three suspend the account), and a page explaining copyright notices. Terms are a placeholder.

**Sharing and lyrics**

- Share links: a link to a track, release, artist or public playlist shows a preview with its title, artist,
  artwork and AI label in WhatsApp, iMessage, Slack, Discord, X, Facebook and the rest, with a 1200×630 share image
  drawn by the server (no outside service). "Share" copies the link, or opens the share sheet on phones.
- QR codes for share links, to download for posters and flyers.
- Embeddable players for tracks, releases and artists, light or dark, for bands' own websites. They play 30-second
  previews (which never count as plays), always show the AI label and link to Trusic. Pages also advertise the
  player through oEmbed, so tools that look for it can turn a pasted Trusic link into the player.
- Lyrics: plain or synced to the music, added in Studio by the uploader or anyone in the band split, with a
  tap-along tool for syncing. Shown on track pages and in a Lyrics panel that follows the song. Not shown for covers
  (see open question 19).
- The phone app has sharing (the phone's share sheet with the website's link) and lyrics too: on track screens, and
  in Now Playing, where synced lyrics follow the song and a tap on a line jumps to it.

**Desktop app**

- Mac, Windows and Linux app (Electron, `apps/desktop`) that runs the web app unchanged, with media keys and the
  system's "now playing" controls. The server is chosen in the app. Unsigned installers come from a manual GitHub
  workflow.

**Discovery and artist stats** (web, desktop and phone; rules in [PRODUCT.md](PRODUCT.md) section 4)

- "Human-made only" switch, kept on the listener's account (visitors' choice stays in their browser or phone).
- Personalised home page, "More like this", "Fans also like" and endless radio from a track, an artist or a
  playlist, all built in-house from listening on Trusic, each saying why it was picked. The phone app has them all.
- "Trusic for Artists" in Studio: streams, listeners, followers and likes over 7, 28 and 365 days, top tracks, where
  listeners pressed play, per-track pages, and each person's own money by track and month.
- Every play records where it started, from the website, the desktop app and the phone app. The demo data has six
  months of listening by 35 subscribers.

**Offline listening**

- Subscribers download releases, playlists and liked songs in the phone and desktop apps, on up to five devices.
  Downloads are checked online at least every 30 days, deleted when the subscription ends or on signing out, and
  taken-down tracks are removed at the next check. The phone app has an offline mode, a Downloads section with
  storage used and a Wi-Fi-only setting; the desktop app has a Downloads page and keeps playing when the server
  can't be reached. Phones keep downloaded music out of iCloud and Android backups, and download it again if the
  phone clears it to free space.
- Both apps queue every play with an id made up on the device and send them when back online, so offline listening
  pays artists and a play sent twice counts once. Plays that arrive after their month is finalised count in the next
  month calculated, and listeners' statements say so.

## Next: things Spotify has that we don't yet

- Editorial: playlists picked by people at Trusic, clearly marked as such.
- Stats: keep a record of unfollows and unlikes so followers over time can show losses too; a daily summary table if
  one artist ever has millions of plays a year (see `apps/api/src/stats-service.ts`).
- Accounts: sign in with Apple/Google, two-step sign-in.
- Releases: pre-release scheduling.
- A lyric licence for covers, if the founder wants one (open question 19). Lyrics for listening offline.
- Audio: a "data saver" setting with a lower bitrate, HLS with several bitrates, and a CDN in front of storage. A
  button for an artist to retry an upload that failed to convert.
- Social: collaborative playlists.
- Downloads: a "Your devices" page to see and remove devices, downloading over mobile data per collection, and
  saving artwork on phones for offline browsing.

## Apps

- **Desktop (Mac/Windows/Linux):** the app exists (see Done). Still to do: code signing (Apple Developer Program
  and a Windows certificate) and automatic updates.
- **iPhone and Android:** first version in `apps/mobile` (Expo), reusing `@trusic/core`, `@trusic/client` and the
  shared queue in `@trusic/player`. It has the personalised home page, browse, search, AI labels, the "Human-made
  only" switch, the player with background audio, radio, "More like this" and "Fans also like", lyrics, sharing,
  reporting, library, "your money" and accounts, downloads for listening offline, and says where each play started.
  It can be tried on a phone with Expo Go. Next: test builds with EAS Build, trying it on real phones (see
  apps/mobile/README.md for what only a phone can show), and the app-store decisions below.
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
  covering the declaration and penalties, real terms and a privacy notice (the Terms page lists what a lawyer must
  write), a lawyer's review of the takedown and repeat-infringer process that's now built (open question 13), audio
  fingerprinting at upload, and an Online Safety Act risk assessment within three months of launch. See
  [research/uk-licensing.md](research/uk-licensing.md) and its checklist for a music lawyer.
- **Billing:** switch Stripe to live mode (see [STRIPE.md](STRIPE.md)), deduct Stripe's fees from booked revenue,
  and decide on app-store billing for the phone apps (or keep sending people to the website).
- **Paying artists:** Stripe Connect's identity checks (KYC) and tax forms in live mode, and a payout schedule.
- **Hosting that keeps data:** the free Supabase setup keeps data, but it pauses after a week without use, has no
  backups you can restore, and only takes files up to 50 MB. A launch needs paid plans for the database and storage
  (with backups), a server that doesn't sleep, and more than one CPU for converting uploads.
- **Fraud:** per-listener stream caps, bot detection, device fingerprinting. User-centric payouts already stop
  stream farms from taking other listeners' money; they can still waste their own.
- **Security and operations:** move web sessions to httpOnly cookies, audit logging for admin actions, backups,
  monitoring, rate limits tuned for production (several servers would need a shared store for them), and an email
  service with an authenticated domain (see [EMAIL.md](EMAIL.md)).
