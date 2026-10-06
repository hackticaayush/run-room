// Deterministic movement along a tile path. The server uses it to know where an agent is and
// when it arrives; every client uses the SAME function with its mirrored sim clock, so all tabs
// draw identical positions at the same moment without streaming positions.

import type { Facing, MoveState, PathPoint } from './types';

export interface MotionSample {
  /** Tile coordinates (fractional while walking). */
  x: number;
  y: number;
  facing: Facing;
  /** True once the end of the path is reached. */
  done: boolean;
  /** Tiles travelled so far (drives the walk cycle). */
  distance: number;
}

export function facingBetween(a: PathPoint, b: PathPoint, fallback: Facing = 'down'): Facing {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Total length of a path in tiles (4-directional steps, but works for any polyline). */
export function pathLength(path: PathPoint[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return len;
}

/** Sim milliseconds a move takes. */
export function moveDuration(move: MoveState): number {
  return (pathLength(move.path) / move.speed) * 1000;
}

/**
 * Index of the next path point still ahead of the walker at time t (path.length when done).
 * Used to re-route an agent smoothly: finish the current step, then follow the new path.
 */
export function nextPointIndex(move: MoveState, t: number): number {
  const travelled = Math.max(0, ((t - move.startClock) / 1000) * move.speed);
  let acc = 0;
  for (let i = 1; i < move.path.length; i++) {
    acc += Math.hypot(move.path[i][0] - move.path[i - 1][0], move.path[i][1] - move.path[i - 1][1]);
    if (travelled < acc) return i;
  }
  return move.path.length;
}

/** Where an agent is at sim time t while following move. */
export function sampleMove(move: MoveState, t: number, fallbackFacing: Facing = 'down'): MotionSample {
  const path = move.path;
  if (path.length === 0) return { x: 0, y: 0, facing: fallbackFacing, done: true, distance: 0 };
  const travelled = Math.max(0, ((t - move.startClock) / 1000) * move.speed);
  let remaining = travelled;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Strictly less: landing exactly on the last point counts as arrived.
    if (remaining < seg) {
      const f = seg === 0 ? 1 : remaining / seg;
      return {
        x: a[0] + (b[0] - a[0]) * f,
        y: a[1] + (b[1] - a[1]) * f,
        facing: facingBetween(a, b, fallbackFacing),
        done: false,
        distance: travelled,
      };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  const prev = path.length > 1 ? path[path.length - 2] : last;
  return { x: last[0], y: last[1], facing: facingBetween(prev, last, fallbackFacing), done: true, distance: pathLength(path) };
}
