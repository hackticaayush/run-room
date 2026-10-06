import { describe, expect, it } from 'vitest';
import { SimClockMirror } from '../shared/clock';
import type { ClockInfo } from '../shared/types';

const info = (worldClock: number, serverTime: number, speed = 1, paused = false): ClockInfo => ({
  worldClock,
  serverTime,
  speed,
  paused,
  propAnimFrame: 0,
});

describe('sim clock mirror', () => {
  it('two viewers that handle the same frames at different delays agree on sim time', () => {
    const fast = new SimClockMirror();
    const slow = new SimClockMirror();
    // Same machine: identical wall clocks. Frame 1 at server t=1000 (sim 5000).
    fast.sync(info(5000, 1000), 100, 1001);
    slow.sync(info(5000, 1000), 100, 1001);
    // Frame 2 at server t=2000 (sim 6000): fast handles it after 2 ms, slow after 90 ms.
    fast.sync(info(6000, 2000), 1102, 2002);
    slow.sync(info(6000, 2000), 1190, 2090);
    // Ask both at the same instant, long after the smoothing settled.
    const fastLocal = 1102 + 1000;
    const slowLocal = 1190 + 1000 - 88; // same wall instant on the slow tab's own clock
    const a = fast.now(fastLocal + 2000);
    const b = slow.now(slowLocal + 2000);
    expect(Math.abs(a - b)).toBeLessThan(2);
  });

  it('decays corrections with time, not with the number of calls', () => {
    const busy = new SimClockMirror();
    const idle = new SimClockMirror();
    for (const m of [busy, idle]) {
      m.sync(info(0, 0), 0, 0);
      // Next sync says we were 100 ms ahead.
      m.sync(info(900, 1000), 1000, 1000);
    }
    for (let t = 1000; t < 2000; t += 5) busy.now(t); // foreground: many calls
    expect(Math.abs(busy.now(2000) - idle.now(2000))).toBeLessThan(0.5);
  });

  it('freezes while paused and follows the speed multiplier', () => {
    const m = new SimClockMirror();
    m.sync(info(1000, 0, 2), 0, 0);
    expect(m.now(500)).toBeCloseTo(2000, 0);
    m.sync(info(3000, 1000, 2, true), 1000, 1000);
    expect(m.now(5000)).toBe(3000);
    expect(m.isPaused).toBe(true);
  });
});
