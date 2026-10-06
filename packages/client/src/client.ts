import type { AiDeclaration } from "@trusic/core";
import type {
  AdminAppeal,
  Appeal,
  Artist,
  AuthResponse,
  EarningsPeriod,
  ListenerStatementView,
  Me,
  PayoutRunSummary,
  PlayRecorded,
  RubricInfo,
  Split,
  StreamUrl,
  Subscription,
  TrackDetail,
  TrackList,
  Transparency,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  /** e.g. "/api" in the browser, "https://api.trusic.app/api" on mobile. */
  baseUrl: string;
  getToken?: () => string | null;
  fetch?: typeof fetch;
}

export interface UploadTrackInput {
  artistId: string;
  title: string;
  genre?: string;
  declaration: AiDeclaration;
  /** A browser File/Blob, or any Blob-like the platform's FormData accepts. */
  audio: Blob;
  filename: string;
}

export class TrusicClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken ?? (() => null);
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  /** Turn an API-relative URL (like a stream URL) into an absolute one. */
  resolveUrl(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    const origin = /^https?:\/\//.test(this.baseUrl) ? new URL(this.baseUrl).origin : "";
    return origin + path;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers.authorization = `Bearer ${token}`;

    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in data ? String(data.error) : `Request failed (${res.status})`;
      throw new ApiError(res.status, message, data);
    }
    return data as T;
  }

  // Accounts
  register(input: { email: string; password: string; displayName: string }) {
    return this.request<AuthResponse>("POST", "/auth/register", input);
  }
  login(input: { email: string; password: string }) {
    return this.request<AuthResponse>("POST", "/auth/login", input);
  }
  logout() {
    return this.request<void>("POST", "/auth/logout");
  }
  me() {
    return this.request<Me>("GET", "/me");
  }

  // Artists
  createArtist(input: { name: string; bio?: string }) {
    return this.request<Artist>("POST", "/artists", input);
  }
  updateArtist(id: string, input: { name?: string; bio?: string }) {
    return this.request<Artist>("PATCH", `/artists/${id}`, input);
  }
  artist(slug: string) {
    return this.request<{ artist: Artist; tracks: TrackList["tracks"] }>("GET", `/artists/${encodeURIComponent(slug)}`);
  }

  // Tracks
  tracks(params: { q?: string; label?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const suffix = qs.size ? `?${qs}` : "";
    return this.request<TrackList>("GET", `/tracks${suffix}`);
  }
  track(id: string) {
    return this.request<TrackDetail>("GET", `/tracks/${id}`);
  }
  uploadTrack(input: UploadTrackInput) {
    const form = new FormData();
    form.set("artistId", input.artistId);
    form.set("title", input.title);
    if (input.genre) form.set("genre", input.genre);
    form.set("declaration", JSON.stringify(input.declaration));
    form.set("audio", input.audio, input.filename);
    return this.request<TrackDetail>("POST", "/tracks", form);
  }
  removeTrack(id: string) {
    return this.request<void>("DELETE", `/tracks/${id}`);
  }
  splits(trackId: string) {
    return this.request<Split[]>("GET", `/tracks/${trackId}/splits`);
  }
  setSplits(trackId: string, splits: { email: string; shareBps: number }[]) {
    return this.request<Split[]>("PUT", `/tracks/${trackId}/splits`, { splits });
  }
  appeal(trackId: string, message: string) {
    return this.request<Appeal>("POST", `/tracks/${trackId}/appeals`, { message });
  }
  rubric() {
    return this.request<RubricInfo>("GET", "/rubric");
  }

  // Listening
  streamUrl(trackId: string) {
    return this.request<StreamUrl>("GET", `/tracks/${trackId}/stream`);
  }
  recordPlay(trackId: string, msPlayed: number) {
    return this.request<PlayRecorded>("POST", "/plays", { trackId, msPlayed });
  }

  // Money
  subscribe() {
    return this.request<Subscription>("POST", "/billing/subscribe");
  }
  cancelSubscription() {
    return this.request<{ user: User }>("POST", "/billing/cancel");
  }
  statements() {
    return this.request<ListenerStatementView[]>("GET", "/me/statements");
  }
  earnings() {
    return this.request<EarningsPeriod[]>("GET", "/me/earnings");
  }
  transparency() {
    return this.request<Transparency>("GET", "/transparency");
  }

  // Admin
  adminAppeals(status: "open" | "upheld" | "rejected" = "open") {
    return this.request<AdminAppeal[]>("GET", `/admin/appeals?status=${status}`);
  }
  resolveAppeal(id: string, input: { decision: "upheld" | "rejected"; score?: number; note?: string }) {
    return this.request<Appeal>("POST", `/admin/appeals/${id}/resolve`, input);
  }
  reviewTrack(trackId: string, input: { score: number; note?: string }) {
    return this.request<TrackDetail>("POST", `/admin/tracks/${trackId}/review`, input);
  }
  runPayouts(period: string) {
    return this.request<PayoutRunSummary>("POST", "/admin/payouts/run", { period });
  }
}
