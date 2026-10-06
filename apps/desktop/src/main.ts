import path from "node:path";
import { app, BrowserWindow, Menu, net, protocol, screen, session, shell, type WebContents } from "electron";
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  DESKTOP_HOST,
  createStaticHandler,
  createWebAppHandler,
} from "./app-protocol";
import { APP_ID, BACKGROUND_COLOR } from "./constants";
import { readJson, writeJson } from "./json-file";
import { buildMenuTemplate } from "./menu";
import { openServerDialog } from "./server-dialog";
import { normalizeServerUrl, resolveServerUrl, type ServerUrlSource } from "./server-url";
import { MIN_SIZE, restoreWindowState } from "./window-state";

const isMac = process.platform === "darwin";
/** Running from source (pnpm dev) rather than an installed app. */
const isDev = !app.isPackaged;

const appPath = app.getAppPath();
/** The built web app: copied into the package by electron-builder, or straight from apps/web in development. */
const webRoot = app.isPackaged ? path.join(appPath, "web") : path.resolve(appPath, "../web/dist");
const staticDir = path.join(appPath, "static");
const userFile = (name: string) => path.join(app.getPath("userData"), name);

let server: { url: string; source: ServerUrlSource } = resolveServerUrl({});
let mainWindow: BrowserWindow | null = null;
let quitting = false;

// app://trusic behaves like an https origin: localStorage, fetch, module scripts, and streamed <audio>
// with seeking ("stream"). This has to happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

// Windows links the media controls overlay and notifications to the installed shortcut through this ID.
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // Trusic is already running: it gets a "second-instance" event and comes to the front instead.
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
  app.on("web-contents-created", (_event, contents) => lockDown(contents));
  app.whenReady().then(start, (error: unknown) => {
    console.error(error);
    app.quit();
  });
}

async function start() {
  const environment = process.env.TRUSIC_SERVER_URL;
  if (environment && !normalizeServerUrl(environment)) {
    console.warn(`[trusic] Ignoring TRUSIC_SERVER_URL="${environment}": it isn't an http(s) address.`);
  }
  server = resolveServerUrl({ environment, saved: readSettings().serverUrl });
  console.log(`[trusic] Server: ${server.url} (from ${server.source})`);

  const devServerUrl = await findDevServer();
  const webApp = createWebAppHandler({
    webRoot,
    serverUrl: () => server.url,
    fetch: (url, init) => net.fetch(url, init),
    devServerUrl,
    // Vite's dev server injects inline scripts, so the policy only applies to the built app.
    contentSecurityPolicy: devServerUrl ? undefined : CONTENT_SECURITY_POLICY,
  });
  const desktopPages = createStaticHandler(staticDir);
  protocol.handle(APP_SCHEME, (request) => {
    const { host } = new URL(request.url);
    if (host === APP_HOST) return webApp(request);
    if (host === DESKTOP_HOST) return desktopPages(request);
    return new Response("Not found.", { status: 404 });
  });

  // Copying to the clipboard and full screen are the only browser permissions the app needs.
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed.has(permission) && isAppUrl(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) => allowed.has(permission) && requestingOrigin === APP_ORIGIN,
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildMenuTemplate({ appName: app.name, isMac, isDev, openServerSettings })),
  );
  mainWindow = createMainWindow();
}

function createMainWindow(): BrowserWindow {
  const statePath = userFile("window-state.json");
  const state = restoreWindowState(
    readJson(statePath),
    screen.getAllDisplays().map((display) => display.workArea),
  );

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    title: "Trusic",
    // macOS and Windows take the icon from the app bundle and the .exe.
    ...(process.platform === "linux" ? { icon: path.join(staticDir, "icon.png") } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
    },
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const saveState = () => {
    clearTimeout(saveTimer);
    if (!win.isDestroyed()) writeJson(statePath, { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 500);
  };
  win.on("resize", saveSoon);
  win.on("move", saveSoon);
  win.on("maximize", saveSoon);
  win.on("unmaximize", saveSoon);

  win.on("close", (event) => {
    saveState();
    // On a Mac, closing the window keeps Trusic (and the music) running, like Music and Spotify.
    // Clicking the Dock icon brings it back.
    if (isMac && !quitting) {
      event.preventDefault();
      if (win.isFullScreen()) {
        win.once("leave-full-screen", () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once("ready-to-show", () => {
    if (state.maximized) win.maximize();
    win.show();
  });

  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
}

function showMainWindow() {
  if (!app.isReady()) return;
  if (!mainWindow) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openServerSettings() {
  // The dialog sits on top of the main window, which may be hidden on a Mac.
  showMainWindow();
  openServerDialog(mainWindow, {
    preload: path.join(__dirname, "server-dialog-preload.js"),
    devTools: isDev,
    current: () => server,
    environmentValue: process.env.TRUSIC_SERVER_URL,
    save: changeServer,
  });
}

async function changeServer(url: string) {
  const previous = server.url;
  writeJson(userFile("settings.json"), { ...readSettings(), serverUrl: url });
  server = { url, source: "settings" };
  console.log(`[trusic] Server: ${url} (chosen in the app)`);
  if (url !== previous) {
    // Accounts belong to a server. Sign out, so the old server's login is never sent to the new one.
    await session.defaultSession.clearStorageData({ origin: APP_ORIGIN });
  }
  if (mainWindow) {
    showMainWindow();
    await mainWindow.loadURL(`${APP_ORIGIN}/`);
  }
}

function readSettings(): { serverUrl?: string } {
  const saved = readJson(userFile("settings.json"));
  if (!saved || typeof saved !== "object") return {};
  const { serverUrl } = saved as { serverUrl?: unknown };
  return typeof serverUrl === "string" ? { serverUrl } : {};
}

/**
 * `pnpm dev` passes --dev-server=http://localhost:5173 to load the web app from Vite, with live reload.
 * If Vite isn't running, the built web app is used instead. (Vite's live-reload socket first tries
 * ws://trusic/, logs one failed connection, then connects to the dev server directly.)
 */
async function findDevServer(): Promise<string | undefined> {
  if (app.isPackaged) return undefined;
  const flag = process.argv.find((arg) => arg.startsWith("--dev-server="));
  const url = flag?.slice("--dev-server=".length).replace(/\/+$/, "");
  if (!url) return undefined;
  try {
    await net.fetch(url, { signal: AbortSignal.timeout(2000) });
    console.log(`[trusic] Web app: ${url} (Vite dev server)`);
    return url;
  } catch {
    console.warn(`[trusic] No dev server at ${url}, so using the built web app in ${webRoot}.`);
    return undefined;
  }
}

function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

/** Web links open in the person's browser. Nothing else ever loads inside the app. */
function openInBrowser(url: string) {
  try {
    const { protocol: scheme } = new URL(url);
    if (scheme === "https:" || scheme === "http:" || scheme === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL: ignore it.
  }
}

function lockDown(contents: WebContents) {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openInBrowser(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) void contents.loadURL(url);
    else openInBrowser(url);
    return { action: "deny" };
  });

  // Right-click menu with cut, copy and paste, which Electron doesn't provide on its own.
  contents.on("context-menu", (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      template.push({ role: "copy" });
    }
    if (params.linkURL && !isAppUrl(params.linkURL) && /^https?:/.test(params.linkURL)) {
      template.push({ label: "Open Link in Browser", click: () => openInBrowser(params.linkURL) });
    }
    if (isDev) {
      if (template.length) template.push({ type: "separator" });
      template.push({ label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) });
    }
    if (template.length) Menu.buildFromTemplate(template).popup();
  });
}
