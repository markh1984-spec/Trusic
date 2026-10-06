# Trusic desktop app

Trusic for Mac, Windows and Linux. It's the Trusic web app in its own window, with its own icon, a proper menu,
media keys and the computer's "now playing" controls. Everything you can do on the website works the same way,
because it's the same code: there's no separate desktop version of the screens to keep up to date.

The app carries a copy of the web app inside it and gets music and accounts from a **Trusic server** (the API in
`apps/api`). Out of the box that's a server running on the same computer. Once Trusic is online, it will be the
public address (see [Choosing the server](#choosing-the-server)).

## Try it on your computer

You need the same things as for the rest of the repo: Node 22 or newer and pnpm. From the top of the repo:

```sh
pnpm install
pnpm seed          # demo data, if you haven't already
pnpm dev           # the API on :3001 and the web app's dev server on :5173
```

Then, in a second terminal:

```sh
pnpm --filter @trusic/desktop dev
```

The Trusic window opens. Log in with a demo account, such as `listener@trusic.local` with password
`trusic-demo`. Changes to the web app's code show up straight away, as they do in the browser.

If the web app's dev server isn't running, the desktop app uses the last built copy of the web app instead (from
`pnpm --filter @trusic/desktop build`).

## Choosing the server

The app sends every request to one Trusic server. It picks the address in this order:

1. The `TRUSIC_SERVER_URL` environment variable, if set. For example
   `TRUSIC_SERVER_URL=http://localhost:3201 pnpm --filter @trusic/desktop dev`.
2. The address chosen in the app: **Trusic › Server…** on a Mac, **File › Server…** on Windows and Linux (or
   press ⌘, / Ctrl+,). The app checks that a Trusic server answers there, saves the address in your user
   settings and reloads. Changing server signs you out, because accounts belong to a server.
3. Otherwise `http://localhost:3001`, the API from `pnpm dev`.

**When Trusic is online:** change `DEFAULT_SERVER_URL` in [`src/server-url.ts`](src/server-url.ts) to the public
address (for example `https://trusic.app`) and build new installers. People who download the app then don't need
to set anything. The server needs no changes for the desktop app (no CORS settings either), because the app
passes requests through itself.

## Building installers

### On your own computer

```sh
pnpm --filter @trusic/desktop dist
```

This builds the web app, then the installer for the kind of computer you're on, into `apps/desktop/release/`:

| Computer | You get                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------- |
| Mac      | `Trusic-<version>-mac-universal.dmg` and `.zip`. One download for both Apple Silicon and Intel Macs |
| Windows  | `Trusic-Setup-<version>.exe`, a one-click installer that needs no admin rights                      |
| Linux    | `Trusic-<version>-linux-x86_64.AppImage`, a single file that runs on most distributions             |

Each kind of computer can only build its own installer. Use GitHub for all three at once.

### All three with GitHub Actions

1. On GitHub, open the repository's **Actions** tab.
2. Choose **Desktop installers** on the left, then **Run workflow** and **Run workflow** again.
3. Wait for the three builds (macOS, Windows, Linux) to go green. That usually takes 10 to 15 minutes.
4. Open the finished run. The installers are under **Artifacts** at the bottom of the page. Each downloads as a
   zip, with the installer inside.

The workflow only runs when you start it, and never on its own, because of what it costs. On a **private**
repository, every Actions minute counts against the plan's free monthly allowance (2,000 minutes on GitHub Free at
the time of writing), and **macOS minutes count 10 times** (Windows minutes count twice). A 10-minute Mac build
uses about 100 minutes of the allowance. Public repositories don't pay for minutes. Artifacts also count against a
small storage allowance on private repositories (500 MB on GitHub Free), so installers are kept for 7 days.
Download them, then delete old runs if storage runs low.

## What people see when they install

The installers aren't **code-signed** yet. Signing proves to Apple and Microsoft who made the app, and it costs
money (see below). Without it, the app works normally, but each computer shows a warning the first time.

**Mac** (macOS 13 Ventura or later). Open the `.dmg` and drag Trusic into Applications. The first time Trusic is
opened, macOS says it "could not verify Trusic is free of malware", or that it's "from an unidentified
developer".

- On macOS 15 Sequoia and later: click **Done**, open **System Settings › Privacy & Security**, scroll down to
  "Trusic was blocked…", click **Open Anyway** and confirm with your password.
- On macOS 13 and 14: Control-click (right-click) Trusic in Applications, choose **Open**, then **Open** again.
- If macOS instead says Trusic "is damaged and can't be opened", that's the same check. Run this in Terminal,
  then open Trusic again: `xattr -dr com.apple.quarantine /Applications/Trusic.app`

**Windows** (Windows 10 or 11, 64-bit). Running the installer shows a blue **"Windows protected your PC"** box
from Microsoft Defender SmartScreen, with the publisher shown as "Unknown publisher". Click **More info**, then
**Run anyway**. Trusic installs for the current user, adds Start menu and desktop shortcuts, and opens.

**Linux.** No warnings. Make the AppImage executable (right-click › Properties › "Allow executing file as
program", or `chmod +x Trusic-*.AppImage`) and double-click it. If nothing happens, install FUSE 2:
`sudo apt install libfuse2t64` on Ubuntu 24.04, or `libfuse2` on older versions.

## Signing later, and what it costs

Signing removes the warnings above. Prices are as of 2026 and change, so check before buying.

- **Mac: the Apple Developer Program, US$99 a year.** It gives a "Developer ID" certificate. Apps signed with it
  and notarized (checked by Apple's automated service) open with no warning. You'll also need it for automatic
  updates on Mac. To switch: remove `identity: "-"` and set `hardenedRuntime: true` in
  [`electron-builder.yml`](electron-builder.yml), turn on notarization, and add the certificate and Apple ID as
  GitHub secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Windows: about US$10 a month** with Microsoft's Azure Trusted Signing, if the business qualifies (it checks
  your identity, and some countries and company ages aren't covered yet). The alternative is a code-signing
  certificate from a certificate authority, roughly US$200 to US$600 a year, stored on a hardware key or a
  cloud service. Even when signed, SmartScreen can warn about a brand-new app until enough people have
  installed it.
- **Linux: nothing.** AppImages aren't signed in practice.

## How it works (for developers)

- The built web app (`apps/web/dist`) is packed into the app and served from the custom address
  `app://trusic/`, with `index.html` for any route so links like `app://trusic/release/123` survive a reload.
- Every `app://trusic/api/*` request is forwarded to the Trusic server with Electron's `net.fetch`. The method,
  headers (`Authorization`, `Range`…) and body pass through, and the response streams back unchanged,
  including `206 Partial Content`, so seeking in `<audio>` works. The web app's relative URLs therefore work
  as they are, and the server sees an ordinary client.
- Security: `contextIsolation`, `sandbox` and no Node.js in pages. The Trusic window has no preload at all. It
  can't navigate away from `app://trusic` (web links open in the browser), and it gets a Content-Security-Policy
  and no browser permissions beyond clipboard and full screen. Only the small Server… window has a preload,
  and the main process only accepts its messages. The packaged app also switches off Electron features it
  doesn't need ("fuses"), such as running as plain Node.js or accepting a debugger.
- Media keys and the system's "now playing" controls come from the web app's own `navigator.mediaSession` code.
  Electron needs nothing extra for them (on Windows the app registers its app ID so the controls are linked
  to Trusic). One limit: Chromium only accepts http(s), `data:` and `blob:` artwork there, so cover art is
  missing from the system controls until the web app passes artwork as a `blob:` URL.
- One window per computer (opening Trusic again brings the existing window forward). It remembers its size
  and position, and starts on the web app's dark background. On a Mac, closing the window keeps the music
  playing; click the Dock icon to bring it back.

| File                     | What it does                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| `src/main.ts`            | Starts the app: window, menu, single instance, security rules                |
| `src/app-protocol.ts`    | Serves `app://trusic` and proxies `/api` to the server                       |
| `src/server-url.ts`      | Default server address and how the app picks one                             |
| `src/server-dialog*.ts`  | The Server… window (`static/server.html` is its page)                        |
| `src/window-state.ts`    | Remembering the window's size and position                                   |
| `electron-builder.yml`   | Installer settings for Mac, Windows and Linux                                |
| `scripts/make-icons.mjs` | Draws the app icon into `build/` (run `pnpm --filter @trusic/desktop icons`) |
| `test/`                  | Unit tests, including the proxy with Range requests                          |

| Command (`pnpm --filter @trusic/desktop …`) | What it does                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `dev`                                       | Run from source against the web dev server (or the built web app)                   |
| `build`                                     | Build the web app, then compile the desktop app's TypeScript                        |
| `dist`                                      | `build`, then make the installer for this computer with electron-builder            |
| `test` / `typecheck`                        | Unit tests and type checks (also part of the root `pnpm test` and `pnpm typecheck`) |
| `icons`                                     | Regenerate the app icons                                                            |

Not done yet: automatic updates (they need Mac signing and somewhere to publish releases), offline downloads,
and Windows on ARM builds (those PCs run the x64 version through emulation).
