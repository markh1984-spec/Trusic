import type { MenuItemConstructorOptions } from "electron";

export interface MenuOptions {
  appName: string;
  isMac: boolean;
  /** Developer tools are only offered when running from source. */
  isDev: boolean;
  openServerSettings: () => void;
}

/** The standard menus (Edit makes copy and paste work), plus Server… to choose which Trusic to connect to. */
export function buildMenuTemplate({
  appName,
  isMac,
  isDev,
  openServerSettings,
}: MenuOptions): MenuItemConstructorOptions[] {
  const server: MenuItemConstructorOptions = {
    label: "Server…",
    accelerator: "CmdOrCtrl+,",
    click: openServerSettings,
  };

  const first: MenuItemConstructorOptions = isMac
    ? {
        label: appName,
        submenu: [
          { role: "about" },
          { type: "separator" },
          server,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      }
    : { label: "&File", submenu: [server, { type: "separator" }, { role: "quit" }] };

  const view: MenuItemConstructorOptions[] = [{ role: "reload" }, { role: "forceReload" }];
  if (isDev) view.push({ role: "toggleDevTools" });
  view.push(
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  );

  return [first, { role: "editMenu" }, { label: "&View", submenu: view }, { role: "windowMenu" }];
}
