/**
 * Where the desktop app sends API requests.
 *
 * Today that's a Trusic API running on the same computer. Once Trusic is hosted online, change
 * DEFAULT_SERVER_URL to the public address (for example "https://trusic.app") before building installers,
 * so people who download the app don't have to set anything.
 */
export const DEFAULT_SERVER_URL = "http://localhost:3001";

export type ServerUrlSource = "environment" | "settings" | "default";

/**
 * Tidy up a server address typed by a person. Returns null if it isn't a usable web address.
 *
 * "localhost:3001" becomes "http://localhost:3001", "trusic.app" becomes "https://trusic.app", and a pasted
 * ".../api" or trailing slash is dropped, because the app adds "/api/..." itself.
 */
export function normalizeServerUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/:?#]/, 1)[0]!.toLowerCase();
    text = `${isLocalHost(host) ? "http" : "https"}://${text}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;

  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
  return url.origin + path;
}

/** The address to use: TRUSIC_SERVER_URL wins, then the one saved from the Server… menu, then the default. */
export function resolveServerUrl(options: { environment?: string; saved?: string }): {
  url: string;
  source: ServerUrlSource;
} {
  const fromEnvironment = options.environment ? normalizeServerUrl(options.environment) : null;
  if (fromEnvironment) return { url: fromEnvironment, source: "environment" };
  const saved = options.saved ? normalizeServerUrl(options.saved) : null;
  if (saved) return { url: saved, source: "settings" };
  return { url: DEFAULT_SERVER_URL, source: "default" };
}

/** True for addresses that only make sense on this computer, where plain http is fine. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}
