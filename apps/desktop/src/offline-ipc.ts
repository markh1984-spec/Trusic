import { ipcMain, net, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { APP_ORIGIN } from "./app-protocol";
import type { OfflineStore } from "./offline-store";

export interface OfflineIpcOptions {
  store: OfflineStore;
  /** The Trusic window: the only page allowed to manage downloads. */
  window: () => BrowserWindow | null;
  serverUrl: () => string;
}

/** While the server can't be reached, ask it this often whether it's back. */
const RETRY_MS = 10_000;

/**
 * The main process's side of `window.trusicDesktop.offline` (see main-preload.ts), and the app's idea of
 * whether the server can be reached. That comes from every /api request the window makes, and while
 * offline, from asking the server's health check every few seconds.
 */
export function registerOfflineIpc({ store, window, serverUrl }: OfflineIpcOptions) {
  let online = true;
  let retry: NodeJS.Timeout | undefined;

  const setOnline = (value: boolean) => {
    if (value === online) return;
    online = value;
    window()?.webContents.send("offline:connection", online);
    clearTimeout(retry);
    if (!online) retry = setTimeout(checkServer, RETRY_MS);
  };

  const checkServer = async () => {
    if (online) return;
    try {
      const response = await net.fetch(`${serverUrl()}/api/health`, {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (response.ok) return setOnline(true);
    } catch {
      // Still offline.
    }
    retry = setTimeout(checkServer, RETRY_MS);
  };

  /** Only the Trusic window, showing the web app, may manage downloads. */
  const assertFromApp = (event: IpcMainInvokeEvent) => {
    const win = window();
    const frameUrl = event.senderFrame?.url ?? "";
    if (!win || event.sender !== win.webContents || !frameUrl.startsWith(`${APP_ORIGIN}/`)) {
      throw new Error("Not allowed.");
    }
  };
  const ids = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 20_000) : [];

  ipcMain.handle("offline:load", (event) => {
    assertFromApp(event);
    return { deviceId: store.deviceId(), manifest: store.readManifest(), online };
  });
  ipcMain.handle("offline:save-manifest", (event, manifest: unknown) => {
    assertFromApp(event);
    store.saveManifest(manifest);
  });
  ipcMain.handle("offline:download", async (event, trackId: unknown, url: unknown, artworkUrl: unknown) => {
    assertFromApp(event);
    if (typeof trackId !== "string" || typeof url !== "string") throw new Error("Not a download.");
    const result = await store.download(trackId, url, typeof artworkUrl === "string" ? artworkUrl : null);
    if (!result.ok && result.offline) setOnline(false);
    return result;
  });
  ipcMain.handle("offline:remove", (event, trackIds: unknown) => {
    assertFromApp(event);
    store.remove(ids(trackIds));
  });
  ipcMain.handle("offline:remove-all", (event) => {
    assertFromApp(event);
    store.removeAll();
  });
  ipcMain.handle("offline:prune", (event, keep: unknown) => {
    assertFromApp(event);
    store.prune(ids(keep));
  });

  return { setOnline };
}
