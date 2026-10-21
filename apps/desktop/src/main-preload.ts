/**
 * Preload for the Trusic window. It gives the web app one small object, `window.trusicDesktop`, for
 * offline downloads, and nothing else: no Node.js, no Electron, no file paths. The page stays isolated
 * (contextIsolation and the sandbox stay on), and the main process checks that every message comes from
 * the Trusic window showing app://trusic.
 *
 * The web app looks for `window.trusicDesktop` to decide whether to show download buttons, so the
 * website never shows them. Keep this in step with apps/web/src/offline/desktop-bridge.ts.
 *
 * Sandboxed preloads can only load Electron's own modules, so this file imports nothing else.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const offline = {
  /** This computer's id for downloads, the saved list of downloads, and whether the server answers. */
  load: (): Promise<{ deviceId: string; manifest: unknown; online: boolean }> => ipcRenderer.invoke("offline:load"),
  saveManifest: (manifest: unknown): Promise<void> => ipcRenderer.invoke("offline:save-manifest", manifest),
  /** Download one track from a signed link, plus its artwork. */
  download: (
    trackId: string,
    url: string,
    artworkUrl: string | null,
  ): Promise<{ ok: true; bytes: number } | { ok: false; offline: boolean; status: number; message: string }> =>
    ipcRenderer.invoke("offline:download", trackId, url, artworkUrl),
  remove: (trackIds: string[]): Promise<void> => ipcRenderer.invoke("offline:remove", trackIds),
  removeAll: (): Promise<void> => ipcRenderer.invoke("offline:remove-all"),
  prune: (keepTrackIds: string[]): Promise<void> => ipcRenderer.invoke("offline:prune", keepTrackIds),
  /** Hear when the server stops or starts answering. Returns a function that stops listening. */
  onConnectionChange: (listener: (online: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, online: unknown) => listener(online === true);
    ipcRenderer.on("offline:connection", handler);
    return () => {
      ipcRenderer.removeListener("offline:connection", handler);
    };
  },
};

contextBridge.exposeInMainWorld("trusicDesktop", { version: 1, offline });
