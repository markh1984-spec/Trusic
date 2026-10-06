/**
 * Counts how long a track is actually heard, from the player's position updates.
 *
 * Only forward movement in small steps counts, so seeking ahead doesn't add
 * listening time and seeking back doesn't take any away. The API counts a
 * listen of 30 seconds or more as a stream, so this decides who gets paid.
 */

/** Position jumps larger than this are seeks (or stalls), not listening. */
export const MAX_STEP_SECONDS = 3;

/** Listens shorter than this aren't worth reporting. */
export const MIN_REPORT_MS = 1000;

export interface Listen {
  trackId: string;
  msPlayed: number;
}

export class ListenTracker {
  private trackId: string | null = null;
  private ms = 0;
  private lastPosition: number | null = null;

  /** Start counting a new listen. Previews never count, so pass `counts: false` for them. */
  start(trackId: string, { counts = true }: { counts?: boolean } = {}): void {
    this.trackId = counts ? trackId : null;
    this.ms = 0;
    this.lastPosition = null;
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
   * End the listen and return it for reporting, or null if there's nothing worth
   * reporting. Counting carries on from zero for the same track, so a repeat
   * (or a replay) is a new listen.
   */
  take(): Listen | null {
    const listen = this.trackId && this.ms >= MIN_REPORT_MS ? { trackId: this.trackId, msPlayed: this.msPlayed } : null;
    this.ms = 0;
    return listen;
  }
}
