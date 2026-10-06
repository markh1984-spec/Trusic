import { ApiError, TrusicClient } from "@trusic/client";
import { API_URL } from "./config";
import { tokenStore } from "./token";

export const api = new TrusicClient({
  baseUrl: API_URL,
  getToken: () => tokenStore.get(),
});

/** Artwork and stream URLs come back relative ("/api/images/..."); phones need them absolute. */
export function mediaUrl(path: string | null | undefined): string | null {
  return path ? api.resolveUrl(path) : null;
}

/** A message for the listener. Network failures usually mean the API URL is wrong for this device. */
export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return `Can't reach the Trusic server at ${API_URL}.`;
  return e instanceof Error && e.message ? e.message : fallback;
}

export const isAuthError = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);
