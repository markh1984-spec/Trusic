/**
 * The play queue: every listen the apps report waits here until the server has
 * it. Plays made offline are sent when the app is back online.
 *
 * Each listen has an id made up on the device, and the server counts an id
 * once however often it's sent. So a play can be reported early (the phone
 * app does when it goes to the background mid-song) and again when it ends,
 * and a batch can be retried after a dropped connection, without double counting.
 */
import { ApiError, type PlayBatchResult, type PlayReport } from "@trusic/client";
import { DAY_MS, MAX_PLAY_AGE_DAYS } from "@trusic/core";

/** Where an outbox keeps its plays between app launches. One per account. */
export interface OutboxStorage {
  load(): Promise<PlayReport[] | null>;
  save(plays: PlayReport[]): Promise<void>;
}

export type SendPlays = (plays: PlayReport[]) => Promise<PlayBatchResult>;

const BATCH_SIZE = 100;

/** A random UUID (version 4) for a new listen. */
export function newPlayId(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (native) return native.call((globalThis as { crypto?: unknown }).crypto);
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Errors worth trying again later: no connection, the server busy or down, or the sign-in needing renewal. */
export function isTemporary(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export class PlayOutbox {
  private plays: PlayReport[] = [];
  private readonly ready: Promise<void>;
  private sending: Promise<boolean> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(
    private readonly storage: OutboxStorage,
    private readonly send: SendPlays,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ready = storage
      .load()
      .then((saved) => {
        // Anything added while loading goes after what was saved.
        if (saved) this.plays = [...saved.filter((p) => !this.plays.some((q) => q.id === p.id)), ...this.plays];
      })
      .catch(() => undefined);
  }

  /** Plays waiting to be sent. */
  get size(): number {
    return this.plays.length;
  }

  get pending(): readonly PlayReport[] {
    return this.plays;
  }

  /** Queue a listen. Adding the same id again keeps the longest report of it. */
  async add(play: PlayReport): Promise<void> {
    await this.ready;
    const existing = this.plays.find((p) => p.id === play.id);
    if (existing) existing.msPlayed = Math.max(existing.msPlayed, play.msPlayed);
    else this.plays.push({ ...play });
    await this.persist();
  }

  /**
   * Send everything queued, in batches. Resolves true once the queue is empty.
   * If the server can't be reached the plays stay queued for next time. Only a
   * play the server has answered for (kept or turned down) leaves the queue.
   */
  flush(): Promise<boolean> {
    if (this.sending) return this.sending.then(() => this.flush());
    this.sending = this.sendAll().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async sendAll(): Promise<boolean> {
    await this.ready;
    this.dropExpired();
    while (this.plays.length > 0) {
      const batch = this.plays.slice(0, BATCH_SIZE).map((p) => ({ ...p }));
      try {
        const result = await this.send(batch);
        const answered = new Set(result.results.map((r) => r.id));
        const sent = new Map(batch.map((p) => [p.id, p.msPlayed]));
        // A play reported again while this batch was on its way stays, to send its longer listen.
        this.plays = this.plays.filter((p) => !answered.has(p.id) || p.msPlayed > (sent.get(p.id) ?? 0));
      } catch (error) {
        if (isTemporary(error)) {
          await this.persist();
          return false;
        }
        // The server can never accept this batch (it's malformed), so don't keep sending it.
        const ids = new Set(batch.map((p) => p.id));
        this.plays = this.plays.filter((p) => !ids.has(p.id));
      }
      await this.persist();
    }
    return true;
  }

  /** The server turns down plays older than 30 days, so stop keeping them. */
  private dropExpired() {
    const oldest = this.now() - MAX_PLAY_AGE_DAYS * DAY_MS;
    this.plays = this.plays.filter((p) => Date.parse(p.playedAt) >= oldest);
  }

  private persist(): Promise<void> {
    const snapshot = this.plays.map((p) => ({ ...p }));
    this.saving = this.saving.then(() => this.storage.save(snapshot)).catch(() => undefined);
    return this.saving;
  }
}
