# Trusic for iPhone and Android

The Trusic phone app. It does what the website does for listeners: browse new releases and tracks, search, see
every track's AI label and score, play music with a queue (shuffle, repeat, play next), keep a library of playlists,
liked songs and followed artists, see where your money went, and log in or sign up.

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

| Setting                | What it is                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`  | The Trusic API. Defaults to `http://localhost:3001/api`.                                          |
| `EXPO_PUBLIC_SITE_URL` | The Trusic website, where people subscribe. Defaults to the API's address, which serves the site. |

## Subscriptions and previews

There are no free accounts and no ads. Anyone who isn't subscribed, including visitors who haven't logged in, hears a
30-second preview of each track and sees "Preview. Subscribe to hear the full track". Previews never count as plays. The app doesn't sell subscriptions itself: Apple and
Google take a cut of in-app purchases and need paid developer accounts. Instead, the Account and Your money screens
show whether you're subscribed and link to the website to subscribe. Coming back to the app checks again.

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
  the steps above.

## For developers

- Expo SDK 57 with Expo Router (file-based routes in `src/app`) and TypeScript. Screens are in `src/screens`, the
  player, sign-in and library state in `src/state`.
- It uses the shared packages rather than copying them: `@trusic/client` for every API call and type,
  `@trusic/core` for AI label names (`AI_LABELS`) and money formatting, and `@trusic/player` for the queue, which the
  website uses too.
- The repo keeps pnpm's normal isolated installs. No Metro config is needed: Expo has set up monorepos automatically
  since SDK 52 and supports isolated installs since SDK 54.
- Plays: the app counts how long each track is actually heard (seeking doesn't count) and reports it to the API
  when the track ends or changes, or when the app goes to the background with nothing playing. If music keeps
  playing in the background, the listen is reported when it ends or stops, so one listen is never counted twice.
- The sign-in token is kept in the phone's secure storage (`expo-secure-store`), or `localStorage` in a browser.
- `pnpm --filter @trusic/mobile typecheck` and `pnpm --filter @trusic/mobile test` run with the rest of the repo's
  checks.
