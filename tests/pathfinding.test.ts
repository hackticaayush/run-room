import { describe, expect, it } from 'vitest';
import {
  LAYOUT_ROWS,
  MAP_H,
  MAP_W,
  PROPS,
  STATIONS,
  STATION_IDS,
  WALKABLE_CHARS,
  buildCollisionGrid,
  charAt,
  resolveTiles,
  roomAt,
} from '../shared/officeLayout';
import { Pathfinder, straighten } from '../shared/pathfinding';
import { sampleMove, moveDuration } from '../shared/motion';
import tileset from '../client/public/assets/tileset.json';

describe('office layout', () => {
  it('is a 32 x 20 grid of known characters', () => {
    expect(LAYOUT_ROWS.length).toBe(MAP_H);
    for (const row of LAYOUT_ROWS) expect(row.length).toBe(MAP_W);
  });

  it('resolves to tile names that exist in tileset.json', () => {
    const names = new Set(Object.keys(tileset.tiles));
    for (const row of resolveTiles()) {
      for (const cell of row) for (const layer of cell.layers) expect(names.has(layer), layer).toBe(true);
    }
  });

  it('places every prop footprint inside the map, colliding props on walkable floor', () => {
    for (const p of PROPS) {
      expect(p.x + p.w).toBeLessThanOrEqual(MAP_W);
      expect(p.y + p.h).toBeLessThanOrEqual(MAP_H);
      if (p.collide) {
        for (let dy = 0; dy < p.h; dy++) {
          for (let dx = 0; dx < p.w; dx++) expect(WALKABLE_CHARS.has(charAt(p.x + dx, p.y + dy)), `${p.id}`).toBe(true);
        }
      }
    }
  });

  it('keeps every station on a walkable tile inside its room', () => {
    const grid = buildCollisionGrid();
    for (const id of STATION_IDS) {
      const s = STATIONS[id];
      expect(grid[s.y][s.x], `${id} blocked`).toBe(0);
      expect(roomAt(s.x, s.y), id).toBe(s.room);
    }
  });
});

describe('pathfinding', () => {
  const pf = new Pathfinder();
  const grid = buildCollisionGrid();

  it('finds a path between every pair of stations', () => {
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        const path = pf.find(STATIONS[a], STATIONS[b]);
        expect(path, `${a} -> ${b}`).not.toBeNull();
      }
    }
  });

  it('never walks through walls or furniture and only takes 4-directional unit steps', () => {
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        const path = pf.find(STATIONS[a], STATIONS[b])!;
        expect(path[0]).toEqual([STATIONS[a].x, STATIONS[a].y]);
        expect(path[path.length - 1]).toEqual([STATIONS[b].x, STATIONS[b].y]);
        for (let i = 0; i < path.length; i++) {
          const [x, y] = path[i];
          expect(grid[y][x], `${a}->${b} hits blocked ${x},${y}`).toBe(0);
          if (i > 0) {
            const [px, py] = path[i - 1];
            expect(Math.abs(x - px) + Math.abs(y - py)).toBe(1);
          }
        }
      }
    }
  });

  it('straightening keeps the shortest length and removes staircase turns', () => {
    const open = () => true;
    const stairs: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
      [3, 3],
    ];
    const s = straighten(stairs, open);
    expect(s.length).toBe(stairs.length);
    let turns = 0;
    for (let i = 2; i < s.length; i++) {
      const d1 = [s[i - 1][0] - s[i - 2][0], s[i - 1][1] - s[i - 2][1]].join();
      const d2 = [s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]].join();
      if (d1 !== d2) turns++;
    }
    expect(turns).toBe(1);
  });

  it('returns null for blocked targets', () => {
    expect(pf.find(STATIONS.DOOR, { x: 0, y: 0 })).toBeNull();
  });
});

describe('motion sampling', () => {
  it('interpolates along a path at the given speed and reports arrival', () => {
    const move = { path: [[0, 0], [1, 0], [1, 1]] as [number, number][], startClock: 1000, speed: 2 };
    expect(moveDuration(move)).toBe(1000);
    expect(sampleMove(move, 1000)).toMatchObject({ x: 0, y: 0, done: false });
    expect(sampleMove(move, 1250)).toMatchObject({ x: 0.5, y: 0, facing: 'right' });
    expect(sampleMove(move, 1750)).toMatchObject({ x: 1, y: 0.5, facing: 'down' });
    expect(sampleMove(move, 2000)).toMatchObject({ x: 1, y: 1, done: true });
    expect(sampleMove(move, 9000)).toMatchObject({ x: 1, y: 1, done: true });
  });
});
