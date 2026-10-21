/**
 * Counts how long a track is actually heard, from the player's position updates.
 *
 * Only forward movement in small steps counts, so seeking ahead doesn't add
 * listening time and seeking back doesn't take any away. The API counts a
 * listen of 30 seconds or more as a stream, so this decides who gets paid.
 *
 * Each listen has an id, made up when it starts. Reporting the listen so far
 * (`snapshot`) and again when it ends (`take`) sends the same id, which the
 * server counts once.
 */
import type { PlayReport, PlaySource } from "@trusic/client";
import { newPlayId } from "@trusic/player";

/** Position jumps larger than this are seeks (or stalls), not listening. */
export const MAX_STEP_SECONDS = 3;

/** Listens shorter than this aren't worth reporting. */
export const MIN_REPORT_MS = 1000;

/** One listen, ready for the play queue. */
export type Listen = PlayReport;

export class ListenTracker {
  private trackId: string | null = null;
  private ms = 0;
  private lastPosition: number | null = null;
  private id = newPlayId();
  private startedAt = Date.now();
  private source: PlaySource | null = null;

  /**
   * Start counting a new listen. Previews never count, so pass `counts: false` for them. `source` says where the
   * play started, for artists' stats.
   */
  start(
    trackId: string,
    {
      counts = true,
      now = Date.now(),
      source = null,
    }: { counts?: boolean; now?: number; source?: PlaySource | null } = {},
  ): void {
    this.trackId = counts ? trackId : null;
    this.source = source;
    this.ms = 0;
    this.lastPosition = null;
    this.begin(now);
  }

  /** Feed the player's position, in seconds, whenever it reports one. */
  update(positionSeconds: number): void {
    if (this.lastPosition !== null) {
      const step = positionSeconds - this.lastPosition;
      if (step > 0 && step < MAX_STEP_SECONDS) this.ms += step * 1000;
    }
    this.lastPosition = positionSeconds;
  }

  /** The listener moved the playhead: carry on counting from the new position. */
  seeked(positionSeconds: number): void {
    this.lastPosition = positionSeconds;
  }

  get msPlayed(): number {
    return Math.round(this.ms);
  }

  /**
   * The listen so far, without ending it: reported when the app goes to the
   * background mid-song, in case the phone closes the app before it ends.
   */
  snapshot(): Listen | null {
    if (!this.trackId || this.ms < MIN_REPORT_MS) return null;
    return {
      id: this.id,
      trackId: this.trackId,
      playedAt: new Date(this.startedAt).toISOString(),
      msPlayed: this.msPlayed,
      ...(this.source ? { source: this.source } : {}),
    };
  }

  /**
   * End the listen and return it for reporting, or null if there's nothing worth
   * reporting. Counting carries on from zero for the same track, so a repeat
   * (or a replay) is a new listen with a new id.
   */
  take(now = Date.now()): Listen | null {
    const listen = this.snapshot();
    this.ms = 0;
    this.begin(now);
    return listen;
  }

  private begin(now: number) {
    this.id = newPlayId();
    this.startedAt = now;
  }
}
