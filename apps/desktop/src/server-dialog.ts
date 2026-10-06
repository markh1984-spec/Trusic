import { BrowserWindow, ipcMain, net, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { DESKTOP_ORIGIN } from "./app-protocol";
import { BACKGROUND_COLOR } from "./constants";
import { DEFAULT_SERVER_URL, isLocalHost, normalizeServerUrl, type ServerUrlSource } from "./server-url";

export interface ServerDialogOptions {
  preload: string;
  devTools: boolean;
  current: () => { url: string; source: ServerUrlSource };
  /** The TRUSIC_SERVER_URL value, if set: it wins over the saved address each time the app starts. */
  environmentValue: string | undefined;
  save: (url: string) => Promise<void>;
}

/** What the page gets from "server:get". */
export interface ServerInfo {
  url: string;
  source: ServerUrlSource;
  defaultUrl: string;
  environmentValue: string | null;
}

/** What the page gets back from "server:save". */
export type SaveResult = { ok: true } | { ok: false; error: string; canForce: boolean };

const PAGE_URL = `${DESKTOP_ORIGIN}/server.html`;
let dialog: BrowserWindow | null = null;

/** The Server… window: a small form for the address of the Trusic server. */
export function openServerDialog(parent: BrowserWindow | null, options: ServerDialogOptions): void {
  if (dialog) {
    dialog.focus();
    return;
  }
  registerIpc(options);
  dialog = new BrowserWindow({
    ...(parent ? { parent, modal: true } : {}),
    // Room for a two-line error and the TRUSIC_SERVER_URL note without scrolling.
    width: 540,
    height: 390,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Trusic server",
    backgroundColor: BACKGROUND_COLOR,
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: options.devTools,
    },
  });
  dialog.setMenu(null);
  dialog.once("ready-to-show", () => dialog?.show());
  dialog.on("closed", () => {
    dialog = null;
  });
  void dialog.loadURL(PAGE_URL);
}

let registered = false;

function registerIpc(options: ServerDialogOptions) {
  if (registered) return;
  registered = true;

  ipcMain.handle("server:get", (event): ServerInfo => {
    assertFromDialog(event);
    const { url, source } = options.current();
    return { url, source, defaultUrl: DEFAULT_SERVER_URL, environmentValue: options.environmentValue ?? null };
  });

  ipcMain.handle("server:save", async (event, input: unknown, force: unknown): Promise<SaveResult> => {
    assertFromDialog(event);
    const url = normalizeServerUrl(typeof input === "string" ? input : "");
    if (!url) {
      return {
        ok: false,
        canForce: false,
        error: "That doesn't look like a web address. Try something like https://trusic.app or http://localhost:3001.",
      };
    }
    if (force !== true) {
      const problem = await checkServer(url);
      if (problem) return { ok: false, canForce: true, error: `Couldn't reach a Trusic server at ${url}: ${problem}.` };
      const { protocol, hostname } = new URL(url);
      if (protocol === "http:" && !isLocalHost(hostname)) {
        return {
          ok: false,
          canForce: true,
          error: `${url} isn't encrypted, so logins would travel in plain text. Use https:// unless the server is on your own network.`,
        };
      }
    }
    await options.save(url);
    dialog?.close();
    return { ok: true };
  });

  ipcMain.on("server:close", (event) => {
    if (isFromDialog(event)) dialog?.close();
  });
}

/** Only the Server… page may change the server, never the web app or anything it loads. */
function isFromDialog(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return dialog !== null && event.sender === dialog.webContents && (event.senderFrame?.url ?? "").startsWith(PAGE_URL);
}

function assertFromDialog(event: IpcMainInvokeEvent) {
  if (!isFromDialog(event)) throw new Error("Not allowed.");
}

/** Returns a reason if the address doesn't answer like a Trusic server, or null if it does. */
async function checkServer(url: string): Promise<string | null> {
  try {
    const response = await net.fetch(`${url}/api/health`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!response.ok) return `it answered with error ${response.status}`;
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) {
      return "something answered, but it isn't a Trusic server";
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return /timeout|abort/i.test(reason) ? "it didn't answer in time" : `nothing answered (${reason})`;
  }
}
