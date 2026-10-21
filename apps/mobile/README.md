# Trusic for iPhone and Android

The Trusic phone app. It does what the website does for listeners: a home page picked for you, browse and search,
see every track's AI label and score, a "Human-made only" switch, play music with a queue (shuffle, repeat, play
next), endless radio, lyrics that follow the song, keep a library of playlists, liked songs and followed artists,
share links, report problems, see where your money went, and log in or sign up. Subscribers can also download music
to listen without signal (see [Listening offline](#listening-offline)). What each part does is described in
[What's in the app](#whats-in-the-app).

It's one app for both iPhone and Android, built with [Expo](https://expo.dev) (React Native). The same code also runs
in a web browser, which is handy for quick checks.

## Try it on your own phone for free

You don't need an Apple or Google developer account for this. You use **Expo Go**, a free app that runs Trusic
straight from your computer while you're developing.

1. **Install Expo Go** on your phone from the App Store or Google Play.
2. **Put your phone and computer on the same Wi-Fi.**
3. **Find your computer's address on the Wi-Fi** (its LAN IP, something like `192.168.1.20`):
   - Mac: System Settings → Wi-Fi → Details next to your network → IP address. Or run `ipconfig getifaddr en0`.
   - Windows: run `ipconfig` and look for "IPv4 Address".
4. **Tell the app where the API is.** In `apps/mobile`, copy `.env.example` to `.env` and set:

   ```sh
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3001/api   # your computer's address, not "localhost"
   ```

   On your phone, `localhost` means the phone itself, so it has to be your computer's address.

5. **Start the API so your phone can reach it.** From the repo root (run `pnpm install` and `pnpm seed` first if you
   haven't):

   ```sh
   HOST=0.0.0.0 pnpm --filter @trusic/api dev
   ```

   By default the API only accepts connections from your own computer; `HOST=0.0.0.0` lets your phone in too.

   **Or skip this step and use your online demo** (see [docs/HOSTING.md](../../docs/HOSTING.md)): set
   `EXPO_PUBLIC_API_URL=https://your-site.onrender.com/api` in `apps/mobile/.env`, and log in with the demo password
   from Render. Then the phone doesn't need to be on the same Wi-Fi as your computer.

6. **Start the app** in a second terminal, from the repo root:

   ```sh
   pnpm mobile
   ```

   A QR code appears. On an iPhone, scan it with the Camera app; on Android, scan it from inside Expo Go.

7. **Log in** on the Account tab with `listener@trusic.local` and password `trusic-demo`.

If the app says it **can't reach the Trusic server**, check the address in `.env` (then restart `pnpm mobile`), that
the API was started with `HOST=0.0.0.0`, that both devices are on the same Wi-Fi, and that your computer's firewall
allows connections on port 3001. Some office and public Wi-Fi networks stop devices talking to each other; a phone
hotspot or home Wi-Fi works.

**Simulators and emulators:** the iPhone simulator on a Mac can use `http://localhost:3001/api`. The Android
emulator reaches your computer at `10.0.2.2`, so use `http://10.0.2.2:3001/api`.

**What Expo Go can't do:** Expo Go can't apply the app's own native settings, so music carrying on with the screen
locked, and the lock-screen controls, may not work fully there. They need a proper build of the app (see
"Publishing" below). Everything else works in Expo Go.

## Run it in a web browser

```sh
pnpm --filter @trusic/mobile web
```

This opens the app at http://localhost:8081. The API only answers browsers on addresses it's told about, so start it
with:

```sh
CORS_ORIGINS=http://localhost:8081 pnpm --filter @trusic/api dev
```

For a static copy you can host anywhere, `pnpm --filter @trusic/mobile export:web` builds one into `apps/mobile/dist`.

## Settings

Put these in `apps/mobile/.env` (see `.env.example`) and restart `pnpm mobile` after changing them.

| Setting                | What it is                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`  | The Trusic API. Defaults to `http://localhost:3001/api`.                                                                                                                                                         |
| `EXPO_PUBLIC_SITE_URL` | The Trusic website, where people subscribe and where share links point. Defaults to the API's address, which serves the site. Share links use the server's public address (its `PUBLIC_URL`) unless this is set. |

## What's in the app

- **Home** has shelves picked from listening on Trusic. Listeners get Jump back in, Made for you, New from artists
  you follow and Because you liked…; everyone gets Popular on Trusic, New releases, Fresh human-made music and
  Artists to discover. Each track says why it's there, and each shelf has a "Why am I seeing this?" note. Below
  them is every new track, which can be filtered by AI label.
- **"Human-made only"** is a switch at the top of Home and in Account. When it's on, tracks labelled Partly AI and AI
  Slop are left out of Home, search, "More like this", "Fans also like" and radio. Albums, playlists and artists you
  open yourself still play everything, with a note saying how many tracks aren't Human-made. Signed in, it's kept on
  your account, so it's the same on the website; visitors' choice is kept on the phone.
- **Radio** starts from a track (in its "⋯" sheet or on its screen), an artist or a playlist (on their screens) and
  never ends: more is added as it runs low, as on the website.
- **Track screens** show "More like this", and **artist screens** "Fans also like".
- **Lyrics**: the **Lyrics** button in Now Playing swaps the artwork for the words. Synced lyrics light up line by
  line and keep the line being sung in view; tap a line to jump to it (not past the end of a 30-second preview).
  Plain lyrics just scroll. Track screens show lyrics too. Lyrics for covers are never shown, as on the website.
- **Share** is in the "⋯" sheets and on track, release, artist and public playlist screens. It opens the phone's
  share sheet with the website's link, which shows a preview wherever it's pasted.
- **Report…** is in the "⋯" sheets and on release, artist and playlist screens (not on your own). Offensive or
  illegal content, impersonation and wrong AI labels are reported from the app. Copyright notices need the
  claimant's details and two signed statements, so that choice opens the website's form.
- **Where plays start**: every play says where it was started (an album, a playlist, an artist's page, search,
  Liked songs, radio, recommendations or the queue), so artists' stats are right.
- **Tracks that go**: tracks being processed, that failed to convert, that were taken down or whose artist is
  suspended never show to listeners. If one goes while it's in your queue, the app says "… isn't available any more,
  so it was skipped" and plays the next one. A link to anything that's gone opens a "This … isn't available" screen
  rather than an error.
- **Your own tracks that aren't live**: their uploader can still open them, and is told why, as on the website:
  still converting (the screen updates by itself), converting failed (with **Try again** when the upload can be
  converted again), removed, hidden while the account is suspended, or taken down (with a link to the takedown on
  the website, where counter-notices are sent). Artist pages and playlists that were taken down say so to their
  owner, and can't be shared. Taken-down artwork needs signing in on the website, so the app shows a placeholder.

## Subscriptions and previews

There are no free accounts and no ads. Anyone who isn't subscribed, including visitors who haven't logged in, hears a
30-second preview of each track and sees "Preview. Subscribe to hear the full track". Previews never count as plays. The app doesn't sell subscriptions itself: Apple and
Google take a cut of in-app purchases and need paid developer accounts. Instead, the Account and Your money screens
show whether you're subscribed and link to the website to subscribe. Coming back to the app checks again.

## Listening offline

Subscribers can download albums, EPs, singles, playlists and their liked songs to listen without signal:

- **Download** switches are on release and playlist screens and on Liked songs. Tracks download in the background
  while the app is open, on Wi-Fi only unless you turn that off.
- **Library › Downloads** shows what's downloaded, how much space it takes, the "Download using Wi-Fi only" setting
  and **Remove all downloads**.
- **Offline**, a banner says so. Downloaded releases and playlists still open, and tracks that aren't downloaded are
  greyed out. Downloaded tracks play from the phone, with or without signal.
- Downloads are kept in the app's private storage, named by track id, never in a music folder. They belong to the
  account and the phone: signing out deletes them, and so does the subscription ending. The app checks them with
  Trusic whenever it's online (at least every 12 hours); after 30 days without a check they stop playing until it
  can. Tracks that have been taken down are deleted at the next check. One account can keep downloads on up to five
  phones and computers. A phone removed under Settings › Your devices on the website deletes its downloads at its
  next check, and Library › Downloads says why.
- **Backups.** Downloaded music is kept in the app's cache folder, which iCloud and Android's backups leave out:
  Apple asks apps not to back up files that can be downloaded again, and a backup full of music would be slow and
  could use up someone's iCloud space. Expo's file system has no way to mark a file elsewhere as "don't back up"
  (that would need native code, which Expo Go can't run). The catch: a phone that's very short of space may empty
  an app's cache folder, and on Android "Clear cache" in the phone's settings does too. The app notices at its next
  check and downloads those tracks again (on Wi-Fi, if that's the setting). The list of downloads and the plays
  waiting to be sent stay in the app's documents folder, so nothing that counts towards paying artists is lost.
- Every listen goes into a queue on the phone and is sent when there's a connection, so offline listening pays
  artists. Plays more than 30 days old aren't accepted.

The full rules are in [docs/PRODUCT.md](../../docs/PRODUCT.md).

### What can only be checked on a real phone

Downloads, offline mode and the play queue have been tested in a browser (where the app keeps downloads in the
browser's own storage). These need a real iPhone and Android phone, ideally with a test build from EAS Build:

- Downloading into the phone's storage with Expo's file system, and playing those files, including with the screen
  locked.
- What happens to a download in progress when the app goes to the background or is closed (it should carry on next
  time the app opens).
- Wi-Fi only: that downloads wait on mobile data and start on Wi-Fi.
- Turning on aeroplane mode: the offline banner, greyed-out tracks and playing downloads.
- The listen being reported when the app goes to the background mid-song, then once more when it ends, without
  counting twice.
- Backups: that an iPhone backup (Settings › your name › iCloud › Manage storage › Backups) doesn't include
  Trusic's downloads, and that downloads come back by themselves after the phone clears the app's cache. On
  Android, Settings › Apps › Trusic › Storage › Clear cache does that. A phone that was already used with an earlier
  version of the app deletes its old downloads once and downloads them again into the new place.

The new features have been tested the same way. These also need a real phone:

- **Share**: the iPhone and Android share sheets (the browser test checked the link and title the app hands them).
  On iPhones the share sheet opens just after the "⋯" sheet has closed, which only a real iPhone can show.
- **Lyrics**: that synced lyrics scroll smoothly and keep the line being sung in view, that scrolling them yourself
  pauses that for a few seconds, and that tapping a line jumps the music there.
- **Report**: that "Copyright infringement" opens the website's form in the phone's browser.
- **A track taken down while queued**: tested by removing a track mid-queue; it should be checked once on a phone,
  including with the screen locked.

## Publishing to the App Store and Google Play (later)

When you're ready to put Trusic in the stores, you'll need:

- **An Apple Developer Program membership**, paid yearly (currently US$99 a year). Needed for the App Store and for
  installing test builds on iPhones through TestFlight.
- **A Google Play developer account**, a one-off fee (currently US$25).
- **EAS Build**, Expo's service that turns this code into real iPhone and Android apps in the cloud, so you don't
  need a Mac. It has a free tier with a limited number of builds a month. **EAS Submit** then uploads the builds to
  the stores. Roughly:

  ```sh
  npm install -g eas-cli
  eas login
  eas build:configure            # choose the app's permanent IDs, e.g. app.trusic
  eas build --platform all
  eas submit --platform all
  ```

- **Store listings:** screenshots, a description, a privacy policy web page, an age rating, and the stores' privacy
  questionnaires.

Before submitting, check Apple's and Google's current rules on linking to a website to buy a subscription. They
change often and differ by country. Apple has a route for music services ("reader apps") to link to their website, and
the link may need to be hidden in some countries.

## Known gaps

- **Lock-screen buttons.** Expo's audio library gives the lock screen play/pause and skip forward/back within a track,
  but not next/previous track.
- **Not yet tried on real phones.** It has been tested in a browser at phone size. iPhone and Android builds need
  the steps above. For downloads, see [what can only be checked on a real phone](#what-can-only-be-checked-on-a-real-phone).
- **Artwork offline.** Downloads keep the music but not the cover art, so covers may be blank without signal.
- **Lyrics offline.** Lyrics need a connection, even for downloaded tracks. Now Playing says so.
- **Share options.** The phone shares links only. Embed codes and QR codes for posters are on the website.
- **Copyright notices** are sent from the website's form, which the app opens.

## For developers

- Expo SDK 57 with Expo Router (file-based routes in `src/app`) and TypeScript. Screens are in `src/screens`, the
  player, sign-in and library state in `src/state`.
- It uses the shared packages rather than copying them: `@trusic/client` for every API call and type,
  `@trusic/core` for AI label names (`AI_LABELS`) and money formatting, and `@trusic/player` for the queue, which the
  website uses too.
- The repo keeps pnpm's normal isolated installs. No Metro config is needed: Expo has set up monorepos automatically
  since SDK 52 and supports isolated installs since SDK 54.
- Plays: the app counts how long each track is actually heard (seeking doesn't count) and puts it in the play queue
  (`src/state/offline.tsx`) when the track ends or changes, or when the app goes to the background. If music keeps
  playing in the background, the listen so far is reported then and again when it ends. Each listen has an id made
  up on the phone and the API keeps one play per id, so it's never counted twice. The queue is sent to
  `POST /api/plays/batch` whenever the server can be reached.
- Downloads: the rules are shared with the desktop app in `@trusic/player` (`downloads.ts` and `outbox.ts`, with
  tests). `src/lib/offline-storage.ts` keeps files with Expo's file system (audio in `Paths.cache`, see Backups
  above); `offline-storage.web.ts` is the browser version. Both tell the download manager which files have gone
  (`missing`), so cleared downloads come back.
- Play sources: lists pass `source` to `TrackList` and `usePlayTracks` (`"release"`, `"playlist"`, `"artist"`,
  `"search"`, `"liked"`, `"recommendations"`; radio is `"radio"`), and the player reports `currentPlaySource` from
  `@trusic/player`, which makes tracks queued by hand `"queue"`.
- Radio uses the shared queue's `radio` seed and `radioNeedsMore`, topped up from `GET /api/radio` as on the website
  (`src/state/player.tsx`). A track the server no longer has (404) is taken out of the queue with the queue's
  `dropTrack` action.
- "Human-made only" is in `src/state/human-only.tsx`: the account's setting, or the phone's for visitors, sent as
  `humanOnly` with every request that uses it.
- Lyrics (`src/components/Lyrics.tsx`, rules in `src/lib/lyrics.ts`), shelves (`src/components/Shelves.tsx`),
  sharing (`src/lib/share.ts` and `share-sheet.ts`), the page "⋯" sheets with Radio and Share
  (`src/components/PageActions.tsx`) and reporting (`src/screens/ReportScreen.tsx`, `src/lib/report.ts`). The pure
  rules have tests next to them.
- The sign-in token is kept in the phone's secure storage (`expo-secure-store`), or `localStorage` in a browser.
- `pnpm --filter @trusic/mobile typecheck` and `pnpm --filter @trusic/mobile test` run with the rest of the repo's
  checks.
