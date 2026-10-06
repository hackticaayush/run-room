// Client side mirror of the server sim clock.
//
// The server owns the only real clock. It sends CLOCK events (worldClock, speed, paused,
// serverTime). A mirror extrapolates between syncs with the local monotonic clock so every client
// computes the same sim time for the same wall time:
//   - Processing delay compensation: each sync is advanced by how late it was handled, measured
//     against the best (smallest) wall clock offset seen so far, NTP style. Two tabs that handle
//     the same frame 80 ms apart still land on the same timeline.
//   - Small corrections are smoothed with a TIME based decay (not per call), so a throttled
//     background tab converges exactly like a foreground one. Large jumps snap.

import { PROP_FRAME_MS } from './constants';
import type { ClockInfo } from './types';

const SNAP_MS = 250;
const DECAY_MS = 120;

export class SimClockMirror {
  private base = 0;
  private baseLocal = 0;
  private speed = 1;
  private paused = false;
  private synced = false;
  /** Smallest (local epoch - server epoch) seen: clock skew plus the best latency. */
  private minOffset = Number.POSITIVE_INFINITY;
  private correction = 0;
  private correctionAt = 0;
  private lastValue = Number.NEGATIVE_INFINITY;

  sync(info: ClockInfo, localNow: number, epochNow: number = Date.now()): void {
    const sample = epochNow - info.serverTime;
    // Trust the best sample; creep up 1 ms per sync so a clock adjustment can recover.
    this.minOffset = Math.min(sample, this.minOffset + 1);
    const lateBy = Math.max(0, Math.min(1000, sample - this.minOffset));
    const before = this.synced ? this.value(localNow) : null;
    this.base = info.worldClock + (info.paused ? 0 : lateBy * info.speed);
    this.baseLocal = localNow;
    this.speed = info.speed;
    this.paused = info.paused;
    this.synced = true;
    const after = this.raw(localNow);
    if (before === null || info.paused || Math.abs(before - after) > SNAP_MS) {
      this.correction = 0;
    } else {
      // Keep showing the previous estimate and bleed the difference out over ~DECAY_MS.
      this.correction = before - after;
    }
    this.correctionAt = localNow;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get speedMultiplier(): number {
    return this.speed;
  }

  private raw(localNow: number): number {
    if (!this.synced) return 0;
    return this.base + (this.paused ? 0 : (localNow - this.baseLocal) * this.speed);
  }

  private value(localNow: number): number {
    const age = Math.max(0, localNow - this.correctionAt);
    return this.raw(localNow) + this.correction * Math.exp(-age / DECAY_MS);
  }

  /** Current sim time estimate. Monotonic for small backward corrections. */
  now(localNow: number): number {
    let v = this.value(localNow);
    if (v < this.lastValue && this.lastValue - v < SNAP_MS) v = this.lastValue;
    this.lastValue = v;
    return v;
  }
}

export function propFrameAt(worldClock: number): number {
  return Math.floor(worldClock / PROP_FRAME_MS);
}
