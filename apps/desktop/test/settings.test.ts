import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ID } from "../src/constants";
import { buildMenuTemplate } from "../src/menu";
import { DEFAULT_SERVER_URL, normalizeServerUrl, resolveServerUrl } from "../src/server-url";
import { DEFAULT_SIZE, MIN_SIZE, restoreWindowState } from "../src/window-state";

describe("server addresses", () => {
  it("tidies what people type", () => {
    expect(normalizeServerUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(normalizeServerUrl("  http://localhost:3001/  ")).toBe("http://localhost:3001");
    expect(normalizeServerUrl("localhost:3201")).toBe("http://localhost:3201");
    expect(normalizeServerUrl("127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(normalizeServerUrl("trusic.app")).toBe("https://trusic.app");
    expect(normalizeServerUrl("https://Trusic.App/api/")).toBe("https://trusic.app");
    expect(normalizeServerUrl("https://example.com/trusic/")).toBe("https://example.com/trusic");
  });

  it("rejects anything that isn't an http(s) address", () => {
    for (const bad of [
      "",
      "   ",
      "ftp://trusic.app",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://",
      "https://user:pw@trusic.app",
    ]) {
      expect(normalizeServerUrl(bad), bad).toBeNull();
    }
  });

  it("prefers TRUSIC_SERVER_URL, then the saved choice, then the default", () => {
    expect(resolveServerUrl({})).toEqual({ url: DEFAULT_SERVER_URL, source: "default" });
    expect(resolveServerUrl({ saved: "https://trusic.app" })).toEqual({
      url: "https://trusic.app",
      source: "settings",
    });
    expect(resolveServerUrl({ environment: "http://localhost:3201", saved: "https://trusic.app" })).toEqual({
      url: "http://localhost:3201",
      source: "environment",
    });
    expect(resolveServerUrl({ environment: "not a url at all", saved: "https://trusic.app" }).source).toBe("settings");
  });

  it("defaults to the local API on port 3001", () => {
    expect(DEFAULT_SERVER_URL).toBe("http://localhost:3001");
  });
});

describe("window size and position", () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1040 };

  it("uses the default size the first time", () => {
    expect(restoreWindowState(undefined, [screen])).toEqual({ ...DEFAULT_SIZE, maximized: false });
  });

  it("restores the last size, position and maximised state", () => {
    expect(restoreWindowState({ x: 100, y: 80, width: 1400, height: 900, maximized: true }, [screen])).toEqual({
      x: 100,
      y: 80,
      width: 1400,
      height: 900,
      maximized: true,
    });
  });

  it("forgets a position that's no longer on any screen", () => {
    const state = restoreWindowState({ x: 2500, y: 100, width: 1200, height: 800 }, [screen]);
    expect(state.x).toBeUndefined();
    expect(state.width).toBe(1200);
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(restoreWindowState({ x: 2500, y: 100, width: 1200, height: 800 }, [screen, second]).x).toBe(2500);
  });

  it("never goes below the minimum size, and ignores junk", () => {
    expect(restoreWindowState({ width: 200, height: 100 }, [screen])).toMatchObject(MIN_SIZE);
    expect(restoreWindowState({ width: "big", x: NaN }, [screen])).toEqual({ ...DEFAULT_SIZE, maximized: false });
  });
});

describe("menu", () => {
  const labels = (isMac: boolean, isDev: boolean) =>
    JSON.stringify(buildMenuTemplate({ appName: "Trusic", isMac, isDev, openServerSettings: () => {} }));

  it("has Server…, Edit, View and Window on every platform", () => {
    for (const isMac of [true, false]) {
      const menu = labels(isMac, false);
      expect(menu).toContain("Server…");
      expect(menu).toContain('"editMenu"');
      expect(menu).toContain('"reload"');
      expect(menu).toContain('"windowMenu"');
    }
  });

  it("only offers developer tools when running from source", () => {
    expect(labels(false, false)).not.toContain("toggleDevTools");
    expect(labels(false, true)).toContain("toggleDevTools");
  });
});

describe("packaging", () => {
  const root = path.resolve(__dirname, "..");
  const builderConfig = readFileSync(path.join(root, "electron-builder.yml"), "utf8");

  it("uses the same app ID in the code and in electron-builder.yml", () => {
    expect(builderConfig).toMatch(new RegExp(`^appId: ${APP_ID.replace(/\./g, "\\.")}\\b`, "m"));
  });

  it("starts from the compiled main process", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { main: string };
    expect(pkg.main).toBe("dist/main.js");
  });
});
