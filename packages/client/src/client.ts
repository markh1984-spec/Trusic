import type { AiDeclaration } from "@trusic/core";
import type {
  AdminAppeal,
  AdminStrike,
  Appeal,
  Artist,
  ArtistPage,
  AuthResponse,
  Balance,
  BillingConfig,
  CancelResult,
  EarningsPeriod,
  HistoryItem,
  LibraryIds,
  LikedTrack,
  ListenerStatementView,
  Me,
  PayArtistsResult,
  PayoutAccountStatus,
  PayoutRunSummary,
  PlaylistDetail,
  PlaylistSummary,
  PlayRecorded,
  ReleaseDetail,
  ReleaseSummary,
  ReleaseType,
  RightsSummary,
  RubricInfo,
  Split,
  StreamUrl,
  StrikeResult,
  SubscribeResult,
  SuspendedAccount,
  TrackCredits,
  TrackDetail,
  TrackList,
  Transparency,
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
  /** Add the track to the end of this release. */
  releaseId?: string;
  credits?: TrackCredits;
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
    return this.request<ArtistPage>("GET", `/artists/${encodeURIComponent(slug)}`);
  }
  setArtistImage(artistId: string, image: Blob, filename: string) {
    return this.request<Artist>("PUT", `/artists/${artistId}/image`, imageForm(image, filename));
  }

  // Releases
  newReleases() {
    return this.request<ReleaseSummary[]>("GET", "/releases");
  }
  release(id: string) {
    return this.request<ReleaseDetail>("GET", `/releases/${id}`);
  }
  createRelease(input: { artistId: string; title: string; type: ReleaseType; releaseDate?: string | null }) {
    return this.request<ReleaseDetail>("POST", "/releases", input);
  }
  updateRelease(id: string, input: { title?: string; type?: ReleaseType; releaseDate?: string | null }) {
    return this.request<ReleaseDetail>("PATCH", `/releases/${id}`, input);
  }
  deleteRelease(id: string) {
    return this.request<void>("DELETE", `/releases/${id}`);
  }
  setReleaseTracks(id: string, trackIds: string[]) {
    return this.request<ReleaseDetail>("PUT", `/releases/${id}/tracks`, { trackIds });
  }
  setReleaseArtwork(id: string, image: Blob, filename: string) {
    return this.request<ReleaseDetail>("PUT", `/releases/${id}/artwork`, imageForm(image, filename));
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
    if (input.releaseId) form.set("releaseId", input.releaseId);
    if (input.credits) form.set("credits", JSON.stringify(input.credits));
    form.set("declaration", JSON.stringify(input.declaration));
    form.set("audio", input.audio, input.filename);
    return this.request<TrackDetail>("POST", "/tracks", form);
  }
  removeTrack(id: string) {
    return this.request<void>("DELETE", `/tracks/${id}`);
  }
  setCredits(trackId: string, credits: TrackCredits) {
    return this.request<TrackDetail>("PUT", `/tracks/${trackId}/credits`, credits);
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

  // Library
  library() {
    return this.request<LibraryIds>("GET", "/me/library");
  }
  likes() {
    return this.request<LikedTrack[]>("GET", "/me/likes");
  }
  like(trackId: string) {
    return this.request<void>("PUT", `/me/likes/${trackId}`);
  }
  unlike(trackId: string) {
    return this.request<void>("DELETE", `/me/likes/${trackId}`);
  }
  follows() {
    return this.request<Artist[]>("GET", "/me/follows");
  }
  follow(artistId: string) {
    return this.request<void>("PUT", `/me/follows/${artistId}`);
  }
  unfollow(artistId: string) {
    return this.request<void>("DELETE", `/me/follows/${artistId}`);
  }
  history() {
    return this.request<HistoryItem[]>("GET", "/me/history");
  }

  // Playlists
  myPlaylists() {
    return this.request<PlaylistSummary[]>("GET", "/me/playlists");
  }
  playlist(id: string) {
    return this.request<PlaylistDetail>("GET", `/playlists/${id}`);
  }
  createPlaylist(input: { name: string; description?: string; isPublic?: boolean }) {
    return this.request<PlaylistDetail>("POST", "/playlists", input);
  }
  updatePlaylist(id: string, input: { name?: string; description?: string; isPublic?: boolean }) {
    return this.request<PlaylistDetail>("PATCH", `/playlists/${id}`, input);
  }
  deletePlaylist(id: string) {
    return this.request<void>("DELETE", `/playlists/${id}`);
  }
  addToPlaylist(id: string, trackIds: string[]) {
    return this.request<PlaylistDetail>("POST", `/playlists/${id}/entries`, { trackIds });
  }
  removeFromPlaylist(id: string, entryId: string) {
    return this.request<PlaylistDetail>("DELETE", `/playlists/${id}/entries/${entryId}`);
  }
  reorderPlaylist(id: string, entryIds: string[]) {
    return this.request<PlaylistDetail>("PUT", `/playlists/${id}/order`, { entryIds });
  }

  // Money
  billingConfig() {
    return this.request<BillingConfig>("GET", "/billing/config");
  }
  /** Demo billing subscribes at once; with Stripe, send the listener to `checkoutUrl`. */
  subscribe() {
    return this.request<SubscribeResult>("POST", "/billing/subscribe");
  }
  cancelSubscription() {
    return this.request<CancelResult>("POST", "/billing/cancel");
  }
  payoutStatus() {
    return this.request<PayoutAccountStatus>("GET", "/me/payouts/status");
  }
  /** Returns a Stripe page where the artist sets up where to be paid. */
  connectPayouts() {
    return this.request<{ url: string }>("POST", "/me/payouts/connect");
  }
  statements() {
    return this.request<ListenerStatementView[]>("GET", "/me/statements");
  }
  earnings() {
    return this.request<EarningsPeriod[]>("GET", "/me/earnings");
  }
  balance() {
    return this.request<Balance>("GET", "/me/balance");
  }
  transparency() {
    return this.request<Transparency>("GET", "/transparency");
  }

  // Admin
  adminAppeals(status: "open" | "upheld" | "rejected" = "open") {
    return this.request<AdminAppeal[]>("GET", `/admin/appeals?status=${status}`);
  }
  resolveAppeal(
    id: string,
    input: { decision: "upheld" | "rejected"; score?: number; note?: string; strike?: boolean },
  ) {
    return this.request<Appeal>("POST", `/admin/appeals/${id}/resolve`, input);
  }
  reviewTrack(trackId: string, input: { score: number; note?: string }) {
    return this.request<TrackDetail>("POST", `/admin/tracks/${trackId}/review`, input);
  }
  runPayouts(period: string) {
    return this.request<PayoutRunSummary>("POST", "/admin/payouts/run", { period });
  }
  payArtists() {
    return this.request<PayArtistsResult>("POST", "/admin/payouts/pay");
  }
  finalizePayouts(period: string) {
    return this.request<PayoutRunSummary>("POST", `/admin/payouts/${period}/finalize`);
  }
  strikeTrack(trackId: string, input: { score: number; reason: string }) {
    return this.request<StrikeResult>("POST", `/admin/tracks/${trackId}/strike`, input);
  }
  rightsSummary() {
    return this.request<RightsSummary>("GET", "/admin/rights-summary");
  }
  adminStrikes() {
    return this.request<AdminStrike[]>("GET", "/admin/strikes");
  }
  suspendedAccounts() {
    return this.request<SuspendedAccount[]>("GET", "/admin/suspended");
  }
  reinstate(userId: string) {
    return this.request<void>("POST", `/admin/users/${userId}/reinstate`);
  }
}

function imageForm(image: Blob, filename: string): FormData {
  const form = new FormData();
  form.set("image", image, filename);
  return form;
}
