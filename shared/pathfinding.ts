// A* pathfinding over the office collision grid (easystarjs, 4 directions, synchronous).
// Used by the server simulation; the client only uses it for the debug overlay.

import * as EasyStarNS from 'easystarjs';
import { buildCollisionGrid, MAP_H, MAP_W } from './officeLayout';
import type { PathPoint } from './types';

type EasyStarModule = typeof EasyStarNS;
// easystarjs is CommonJS: under Node ESM only `default` exists, bundlers may expose both.
const EasyStar: EasyStarModule = (EasyStarNS as unknown as { default?: EasyStarModule }).default ?? EasyStarNS;

export class Pathfinder {
  readonly grid: number[][];
  private readonly es: InstanceType<EasyStarModule['js']>;

  constructor(grid: number[][] = buildCollisionGrid()) {
    this.grid = grid.map((row) => [...row]);
    this.es = new EasyStar.js();
    this.es.setGrid(this.grid);
    this.es.setAcceptableTiles([0]);
    this.es.enableSync();
    this.es.setIterationsPerCalculation(100000);
  }

  isWalkable(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && this.grid[y][x] === 0;
  }

  /** Shortest 4-directional path including both end points, or null when unreachable. */
  find(from: { x: number; y: number }, to: { x: number; y: number }): PathPoint[] | null {
    const sx = Math.round(from.x);
    const sy = Math.round(from.y);
    const tx = Math.round(to.x);
    const ty = Math.round(to.y);
    if (!this.isWalkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [[sx, sy]];
    let result: PathPoint[] | null = null;
    this.es.findPath(sx, sy, tx, ty, (path) => {
      result = path ? path.map((p) => [p.x, p.y] as PathPoint) : null;
    });
    this.es.calculate();
    return result ? straighten(result, (x, y) => this.isWalkable(x, y)) : null;
  }
}

type Axis = 'h' | 'v';

/** Cells of an L shaped route from a to b (a excluded, b included), moving along `first` first. */
function lRoute(a: PathPoint, b: PathPoint, first: Axis): PathPoint[] {
  const cells: PathPoint[] = [];
  let [x, y] = a;
  const stepX = Math.sign(b[0] - x);
  const stepY = Math.sign(b[1] - y);
  const walkX = () => {
    while (x !== b[0]) {
      x += stepX;
      cells.push([x, y]);
    }
  };
  const walkY = () => {
    while (y !== b[1]) {
      y += stepY;
      cells.push([x, y]);
    }
  };
  if (first === 'h') {
    walkX();
    walkY();
  } else {
    walkY();
    walkX();
  }
  return cells;
}

/**
 * A* happily returns staircase paths in open rooms. Greedily replace runs of the path with
 * L shaped legs (never longer, since an L is a Manhattan shortest route) whenever every cell of
 * the leg is walkable. The agent then walks straight and turns once, which reads far better.
 */
export function straighten(path: PathPoint[], walkable: (x: number, y: number) => boolean): PathPoint[] {
  if (path.length < 3) return path;
  const out: PathPoint[] = [path[0]];
  let i = 0;
  let lastAxis: Axis | null = null;
  while (i < path.length - 1) {
    let advanced = false;
    for (let j = path.length - 1; j > i && !advanced; j--) {
      const a = path[i];
      const b = path[j];
      const order: Axis[] = lastAxis === 'v' ? ['v', 'h'] : ['h', 'v'];
      for (const first of order) {
        // An L leg is a Manhattan route, so it is never longer than the A* run it replaces.
        const leg = lRoute(a, b, first);
        if (leg.every(([x, y]) => walkable(x, y))) {
          out.push(...leg);
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          lastAxis = first === 'h' ? (dy !== 0 ? 'v' : 'h') : dx !== 0 ? 'h' : 'v';
          i = j;
          advanced = true;
          break;
        }
      }
    }
    if (!advanced) {
      out.push(path[i + 1]);
      i++;
    }
  }
  return out;
}
