// Tileset: 16x16 tiles, 3/4 top-down view, light from the top-left.
// Face tiles (vertical wall surfaces) come in three variants: single height, the upper and the
// lower half of a two tile tall wall. Wall caps are autotiled with a 4-bit neighbour mask.

import { Canvas } from '../lib/canvas.mjs';
import { P, NEON } from '../lib/palette.mjs';

const T = 16;

function floorBase(rng, base = P.floor1, speck = P.floor2, seam = P.floor0) {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, base);
  // Plate seams on the bottom and right, faint bevel on the top and left.
  c.hline(0, 15, 15, seam);
  c.vline(15, 0, 15, seam);
  c.hline(1, 13, 0, speck);
  c.vline(0, 1, 13, speck);
  for (let i = 0; i < 4; i++) c.px(rng.int(2, 13), rng.int(2, 13), rng.chance(0.5) ? speck : seam);
  return c;
}

function floorA(rng) {
  const c = floorBase(rng);
  // Two tiny rivets in opposite corners.
  c.px(2, 2, P.floor3);
  c.px(13, 13, P.floor0);
  return c;
}

function floorB() {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.floor1);
  c.hline(0, 15, 0, P.wall2);
  c.vline(0, 0, 15, P.wall2);
  c.hline(1, 15, 1, P.floor2);
  c.vline(1, 1, 15, P.floor2);
  c.hline(1, 15, 15, P.floor0);
  c.vline(15, 1, 15, P.floor0);
  c.px(8, 8, P.wall2);
  c.px(0, 0, P.wall3);
  return c;
}

function floorNeon(rng) {
  const c = floorBase(rng);
  const n = NEON.cyan;
  for (let x = 0; x < T; x++) {
    if (x % 2 === 0) c.px(x, 10, n.halo);
    c.px(x, 11, n.glow);
    c.px(x, 12, x % 5 === 2 ? n.core : n.tube);
    c.px(x, 13, n.glow);
    if (x % 2 === 1) c.px(x, 14, n.halo);
  }
  return c;
}

function carpet() {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.pur0);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d1 = (x + y) % 8;
      const d2 = (x - y + 16) % 8;
      if (d1 === 0 && d2 === 0) c.px(x, y, P.mag1);
      else if ((d1 === 0 || d2 === 0) && (x + y) % 2 === 0) c.px(x, y, P.pur1);
    }
  }
  return c;
}

function grate() {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.navy);
  for (let s = 0; s < 4; s++) {
    const y = s * 4;
    c.hline(1, 14, y, P.gry0);
    c.hline(1, 14, y + 1, P.wall2);
    c.hline(1, 14, y + 2, P.wall1);
  }
  c.vline(0, 0, 15, P.wall2);
  c.vline(15, 0, 15, P.wall0);
  c.vline(8, 0, 15, P.wall1);
  return c;
}

function checker() {
  const c = new Canvas(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      c.px(x, y, light ? P.gry0 : P.floor1);
    }
  }
  // Bevel the light squares a little.
  for (const [sx, sy] of [
    [0, 0],
    [8, 8],
  ]) {
    c.hline(sx, sx + 7, sy, P.gry1);
    c.hline(sx, sx + 7, sy + 7, P.wall2);
  }
  return c;
}

function cables(rng, vertical) {
  const c = floorBase(rng);
  const draw = (pos, lit, base) => {
    for (let i = 0; i < T; i++) {
      const wob = (i + pos) % 7 === 0 ? 1 : 0;
      if (vertical) {
        c.px(pos + wob, i, lit);
        c.px(pos + 1 + wob, i, base);
        c.px(pos + 2 + wob, i, P.outline);
      } else {
        c.px(i, pos + wob, lit);
        c.px(i, pos + 1 + wob, base);
        c.px(i, pos + 2 + wob, P.outline);
      }
    }
  };
  draw(4, P.gry1, P.gry0);
  draw(9, P.pur2, P.pur1);
  return c;
}

function vent(rng) {
  const c = floorBase(rng);
  c.rect(2, 3, 12, 10, P.outline);
  c.rect(3, 4, 10, 8, P.navy);
  for (let y = 4; y < 12; y += 2) c.hline(3, 12, y, P.gry0);
  c.hline(2, 13, 3, P.gry1);
  c.vline(2, 3, 12, P.gry1);
  c.hline(3, 13, 12, P.wall0);
  return c;
}

function serverFloor() {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.floor2);
  c.hline(0, 15, 0, P.wall3);
  c.vline(0, 0, 15, P.wall3);
  c.hline(0, 15, 15, P.floor0);
  c.vline(15, 0, 15, P.floor0);
  for (let y = 3; y <= 12; y += 3) for (let x = 3; x <= 12; x += 3) c.px(x, y, P.floor0);
  c.px(1, 1, P.wall4);
  return c;
}

// --- Wall caps -----------------------------------------------------------------------------

const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Cap tile for a 4-bit mask of connected neighbours (N=1, E=2, S=4, W=8). */
function wallTop(mask) {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.wall0);
  // Subtle texture so long runs of caps do not look like holes.
  for (let y = 3; y < T; y += 6) for (let x = (y % 4) + 2; x < T; x += 7) c.px(x, y, P.wall1);
  if (!(mask & N)) {
    c.hline(0, 15, 0, P.outline);
    c.hline(0, 15, 1, P.wall3);
  }
  if (!(mask & W)) {
    c.vline(0, 0, 15, P.outline);
    c.vline(1, 0, 15, P.wall3);
  }
  if (!(mask & S)) {
    c.hline(0, 15, 15, P.outline);
    c.hline(0, 15, 14, P.wall2);
  }
  if (!(mask & E)) {
    c.vline(15, 0, 15, P.outline);
    c.vline(14, 0, 15, P.wall2);
  }
  // Re-assert the outline on corners where two open edges meet.
  if (!(mask & N) && !(mask & W)) c.px(1, 1, P.wall4);
  if (!(mask & N) && !(mask & E)) {
    c.px(15, 0, P.outline);
    c.px(14, 1, P.wall3);
  }
  if (!(mask & S) && !(mask & W)) {
    c.px(0, 15, P.outline);
    c.px(1, 14, P.wall2);
  }
  // Keep the open edges continuous where the neighbour edge is connected.
  if (!(mask & N) && mask & W) c.px(0, 1, P.wall3);
  if (!(mask & N) && mask & E) c.px(15, 1, P.wall3);
  if (!(mask & S) && mask & W) c.px(0, 14, P.wall2);
  if (!(mask & S) && mask & E) c.px(15, 14, P.wall2);
  if (!(mask & W) && mask & N) c.px(1, 0, P.wall3);
  if (!(mask & W) && mask & S) c.px(1, 15, P.wall3);
  if (!(mask & E) && mask & N) c.px(14, 0, P.wall2);
  if (!(mask & E) && mask & S) c.px(14, 15, P.wall2);
  return c;
}

/** Overlay for inner corners (both orthogonal neighbours are caps but the diagonal is not). */
function wallInner(corner) {
  const c = new Canvas(T, T);
  const lit = P.wall3;
  const dark = P.wall2;
  if (corner === 'ne') {
    c.px(15, 0, P.outline);
    c.px(14, 0, lit);
    c.px(15, 1, dark);
  } else if (corner === 'nw') {
    c.px(0, 0, P.outline);
    c.px(1, 0, lit);
    c.px(0, 1, lit);
  } else if (corner === 'se') {
    c.px(15, 15, P.outline);
    c.px(14, 15, dark);
    c.px(15, 14, dark);
  } else {
    c.px(0, 15, P.outline);
    c.px(1, 15, dark);
    c.px(0, 14, lit);
  }
  return c;
}

// --- Wall faces ----------------------------------------------------------------------------

/** A wall face `h` pixels tall (16 single, 32 for a two tile wall). */
function faceBase(h) {
  const c = new Canvas(T, h);
  c.rect(0, 0, T, h, P.wall2);
  // Shadow band under the cap.
  c.hline(0, 15, 0, P.wall0);
  c.hline(0, 15, 1, P.wall1);
  c.hline(0, 15, 2, P.wall3);
  // Panel seams every 8px, lit on the left side.
  for (let x = 0; x < T; x += 8) {
    c.vline(x, 3, h - 4, P.wall1);
    c.vline(x + 1, 3, h - 4, P.wall3);
  }
  // Rivets.
  c.px(4, 5, P.wall4);
  c.px(12, 5, P.wall4);
  if (h > 16) {
    c.hline(0, 15, 17, P.wall1);
    c.hline(0, 15, 18, P.wall3);
    c.px(4, 21, P.wall4);
    c.px(12, 21, P.wall4);
  }
  // Baseboard.
  c.hline(0, 15, h - 4, P.wall1);
  c.hline(0, 15, h - 3, P.wall0);
  c.hline(0, 15, h - 2, P.wall0);
  c.hline(0, 15, h - 1, P.outline);
  for (let x = 2; x < T; x += 4) c.px(x, h - 3, P.cyan0);
  return c;
}

function neonFace(h, hue) {
  const c = faceBase(h);
  const n = NEON[hue];
  const y = h === 16 ? 7 : 11;
  for (let x = 0; x < T; x++) {
    if (x % 2 === 0) {
      c.px(x, y - 2, n.halo);
      c.px(x, y + 2, n.halo);
    }
    c.px(x, y - 1, n.glow);
    c.px(x, y, x % 6 === 3 ? n.core : n.tube);
    c.px(x, y + 1, n.glow);
  }
  // Mounting clips.
  c.px(3, y, P.gry1);
  c.px(11, y, P.gry1);
  return c;
}

function windowFace(h, rng) {
  const c = faceBase(h);
  const top = 3;
  const bottom = h - 6;
  // Frame
  c.rect(1, top, 14, bottom - top + 1, P.outline);
  c.rect(2, top + 1, 12, bottom - top - 1, P.navy);
  // Sky: a few stars, a moon in tall windows.
  for (let i = 0; i < 5; i++) c.px(rng.int(3, 12), rng.int(top + 2, top + 5), rng.chance(0.5) ? P.white : P.blu3);
  if (h > 16) {
    c.rect(10, top + 3, 2, 2, P.yel3);
    c.px(10, top + 3, P.yel2);
  }
  // Skyline.
  const base = bottom - 1;
  let x = 2;
  while (x <= 13) {
    const bw = rng.int(2, 3);
    const bh = rng.int(3, h > 16 ? 10 : 5);
    c.rect(x, base - bh + 1, Math.min(bw, 14 - x), bh, P.wall0);
    for (let wy = base - bh + 2; wy <= base; wy += 2) {
      for (let wx = x; wx < Math.min(x + bw, 14); wx++) if (rng.chance(0.35)) c.px(wx, wy, rng.pick([P.yel2, P.org2, P.cyan2]));
    }
    x += bw;
  }
  // Mullion + sill.
  c.vline(8, top + 1, bottom - 1, P.wall1);
  c.hline(1, 14, bottom + 1, P.wall4);
  c.hline(1, 14, bottom + 2, P.wall1);
  return c;
}

function doorTile() {
  const c = faceBase(16);
  // Opening.
  c.rect(3, 2, 10, 14, P.floor1);
  c.rect(3, 2, 10, 2, P.navy);
  c.rect(3, 4, 10, 1, P.floor0);
  c.hline(3, 12, 14, P.gry0);
  c.hline(3, 12, 15, P.gry1);
  // Jambs, lit on the left.
  c.vline(1, 1, 15, P.outline);
  c.vline(2, 1, 15, P.wall4);
  c.vline(13, 1, 15, P.wall1);
  c.vline(14, 1, 15, P.outline);
  // Lintel with a status light.
  c.hline(1, 14, 0, P.outline);
  c.hline(2, 13, 1, P.wall1);
  c.px(7, 1, P.grn2);
  c.px(8, 1, P.grn2);
  c.px(6, 1, P.grn0);
  c.px(9, 1, P.grn0);
  return c;
}

function doorSide() {
  const c = new Canvas(T, T);
  c.rect(0, 0, T, T, P.floor1);
  c.hline(0, 15, 2, P.floor0);
  // Wall stubs above and below the opening.
  c.rect(0, 0, T, 2, P.wall0);
  c.hline(0, 15, 0, P.outline);
  c.hline(0, 15, 1, P.wall2);
  c.rect(0, 14, T, 2, P.wall0);
  c.hline(0, 15, 14, P.wall3);
  c.hline(0, 15, 15, P.outline);
  // Threshold and an exit light strip.
  c.vline(12, 3, 13, P.gry0);
  c.vline(13, 3, 13, P.gry1);
  c.vline(15, 3, 13, P.grn1);
  c.px(15, 8, P.grn2);
  return c;
}

function shadowN() {
  const c = new Canvas(T, T);
  c.hline(0, 15, 0, P.shadow);
  c.hline(0, 15, 1, P.shadow);
  c.hline(0, 15, 2, P.shadowSoft);
  return c;
}

function shadowW() {
  const c = new Canvas(T, T);
  c.vline(0, 0, 15, P.shadow);
  c.vline(1, 0, 15, P.shadowSoft);
  return c;
}

/** Returns the ordered tile list. The order is the tile index in tileset.png (8 columns). */
export function buildTiles(rng) {
  const r = (salt) => rng.fork(salt);
  const tiles = [];
  const add = (name, canvas) => tiles.push({ name, canvas });

  add('floor_a', floorA(r('floor_a')));
  add('floor_b', floorB());
  add('floor_neon', floorNeon(r('floor_neon')));
  add('carpet', carpet());
  add('grate', grate());
  add('checker', checker());
  add('cable_h', cables(r('cable_h'), false));
  add('cable_v', cables(r('cable_v'), true));
  add('vent', vent(r('vent')));
  add('server_floor', serverFloor());
  add('wall_top', wallTop(N | E | S | W));
  add('wall_face', faceBase(16));
  add('wall_neon_cyan', neonFace(16, 'cyan'));
  add('wall_neon_magenta', neonFace(16, 'magenta'));
  add('window_night', windowFace(16, r('window_single')));
  add('door', doorTile());

  // Two tile tall variants: upper and lower halves of a 16x32 face.
  const tall = {
    wall_face: faceBase(32),
    wall_neon_cyan: neonFace(32, 'cyan'),
    wall_neon_magenta: neonFace(32, 'magenta'),
    window_night: windowFace(32, r('window_tall')),
  };
  for (const [name, canvas] of Object.entries(tall)) {
    add(`${name}_top`, canvas.crop(0, 0, T, T));
    add(`${name}_bottom`, canvas.crop(0, T, T, T));
  }

  for (let mask = 0; mask < 16; mask++) add(`wall_top_${mask}`, wallTop(mask));
  for (const corner of ['ne', 'nw', 'se', 'sw']) add(`wall_top_inner_${corner}`, wallInner(corner));
  add('door_side', doorSide());
  add('shadow_n', shadowN());
  add('shadow_w', shadowW());
  return tiles;
}

export const TILE_COLUMNS = 8;

/** Packs tiles into an 8 column sheet with no gaps (Phaser spritesheet / tilemap friendly). */
export function tileSheet(tiles) {
  const rows = Math.ceil(tiles.length / TILE_COLUMNS);
  const sheet = new Canvas(TILE_COLUMNS * T, rows * T);
  const index = {};
  tiles.forEach((t, i) => {
    sheet.blit(t.canvas, (i % TILE_COLUMNS) * T, Math.floor(i / TILE_COLUMNS) * T);
    index[t.name] = i;
  });
  return { sheet, index };
}
