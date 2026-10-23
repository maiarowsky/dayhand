// A sliding one-minute window of calls, so hlm ui stays under the server's
// per-key limits (120 reads and 60 changes a minute, docs/mcp.md#limits) with
// room left for the user's other hlm commands and agents on the same key. A
// rate_limited answer from the server pauses the window until it allows again.

export const WINDOW_MS = 60_000;
/** Of the server's 120 reads and 60 changes a minute. */
export const READS_PER_MINUTE = 100;
export const CHANGES_PER_MINUTE = 50;

export class Budget {
  private calls: number[] = [];
  private pausedUntil = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = WINDOW_MS,
  ) {}

  /** Records a call and returns true, or returns false when the window is full or paused. */
  take(): boolean {
    const now = this.now();
    if (now < this.pausedUntil) return false;
    this.calls = this.calls.filter((at) => at > now - this.windowMs);
    if (this.calls.length >= this.limit) return false;
    this.calls = [...this.calls, now];
    return true;
  }

  /** Milliseconds until the next call may be made (0 when it may be made now). */
  waitMs(): number {
    const now = this.now();
    const live = this.calls.filter((at) => at > now - this.windowMs);
    const full = live.length >= this.limit ? live[0]! + this.windowMs - now : 0;
    return Math.max(full, this.pausedUntil - now, 0);
  }

  /** The server refused a call: nothing more until `ms` from now. */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }
}
