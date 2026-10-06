// preview.png: a small composed room using the generated tiles, props and characters.
// It mirrors how the game renders the office (caps autotiled, faces by vertical position,
// contact shadows, y-sorted props and characters) so art problems show up in context.

import { Canvas } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

const MINI = [
  '##################',
  '#=======#===c====#',
  '#=======#========#',
  '#sssssss#gggggggg#',
  '#sssssss#gggggggg#',
  '#sssssssggggggggg#',
  '#sssssss#gggggggg#',
  '###s######g#######',
  '#==D======D======#',
  '#nnnnnnnnnnnnnnnn#',
  '#................#',
  '##################',
];

const FLOOR = { s: 'server_floor', g: 'floor_b', n: 'floor_neon', '.': 'floor_a', k: 'carpet', x: 'checker' };
const FACE = { '=': 'wall_face', c: 'wall_neon_cyan', m: 'wall_neon_magenta', w: 'window_night' };

const isCap = (ch) => ch === '#';
const isFace = (ch) => ch in FACE || ch === 'D';

/** Resolves every map cell into a list of tile names (base + overlays). Exported for reuse. */
export function resolveTiles(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '#' : grid[y][x]);
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const ch = at(x, y);
      const layers = [];
      if (isCap(ch)) {
        let mask = 0;
        if (isCap(at(x, y - 1))) mask |= 1;
        if (isCap(at(x + 1, y))) mask |= 2;
        if (isCap(at(x, y + 1))) mask |= 4;
        if (isCap(at(x - 1, y))) mask |= 8;
        layers.push(`wall_top_${mask}`);
        if (mask & 1 && mask & 2 && !isCap(at(x + 1, y - 1))) layers.push('wall_top_inner_ne');
        if (mask & 1 && mask & 8 && !isCap(at(x - 1, y - 1))) layers.push('wall_top_inner_nw');
        if (mask & 4 && mask & 2 && !isCap(at(x + 1, y + 1))) layers.push('wall_top_inner_se');
        if (mask & 4 && mask & 8 && !isCap(at(x - 1, y + 1))) layers.push('wall_top_inner_sw');
      } else if (ch === 'D') {
        layers.push('door');
      } else if (ch in FACE) {
        const above = isFace(at(x, y - 1)) && !isCap(at(x, y - 1));
        const below = isFace(at(x, y + 1));
        const base = FACE[ch];
        layers.push(above ? `${base}_bottom` : below ? `${base}_top` : base);
      } else {
        layers.push(FLOOR[ch] ?? 'floor_a');
        const n = at(x, y - 1);
        if (isCap(n) || isFace(n)) layers.push('shadow_n');
        if (isCap(at(x - 1, y))) layers.push('shadow_w');
      }
      row.push(layers);
    }
    out.push(row);
  }
  return out;
}

export function renderPreview({ tiles, props, ghost, byte, fx }) {
  const T = 16;
  const W = MINI[0].length;
  const H = MINI.length;
  const scene = new Canvas(W * T, H * T);
  scene.rect(0, 0, scene.w, scene.h, P.navy);
  const resolved = resolveTiles(MINI);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const name of resolved[y][x]) {
        const t = tiles.get(name);
        if (!t) throw new Error(`preview: missing tile ${name}`);
        scene.blit(t, x * T, y * T, { blend: true });
      }
    }
  }

  // Wall mounted props first.
  const wall = [
    ['window_rain_0', 10 * T, 1 * T],
    ['neon_sign_on', 13 * T + 3, 1 * T + 3],
    ['poster_skull', 15 * T, 1 * T + 6],
  ];
  for (const [name, px, py] of wall) scene.blit(props.get(name), px, py, { blend: true });

  // Floor standing things, y-sorted by their bottom edge.
  const frameOf = (sheet, col, row) => sheet.crop(col * 16, row * 24, 16, 24);
  const items = [
    ['server_rack_0', 2 * T, 2 * T],
    ['server_rack_hot_1', 3 * T, 2 * T],
    ['server_rack_0', 4 * T, 2 * T],
    ['server_rack_1', 5 * T, 2 * T],
    ['server_rack_0', 6 * T, 2 * T],
    ['workstation_desk_green', 10 * T, 2 * T],
    ['chair', 11 * T, 4 * T],
    ['desk_blue', 14 * T, 5 * T + 8],
    ['plant', 9 * T, 5 * T + 8],
    ['cables', 2 * T, 5 * T],
    ['energy_drink_cans', 16 * T, 3 * T],
  ].map(([name, px, py]) => ({ img: props.get(name), px, py }));
  items.push({ img: frameOf(ghost, 1, 0), px: 11 * T, py: 4 * T - 8, char: true });
  items.push({ img: frameOf(byte, 1, 1), px: 6 * T, py: 9 * T - 8, char: true });
  items.push({ img: frameOf(ghost, 2, 4), px: 4 * T, py: 4 * T - 8, char: true });
  items.sort((a, b) => a.py + a.img.h - (b.py + b.img.h));
  for (const it of items) {
    if (it.char) scene.blit(fx.get('shadow'), it.px + 2, it.py + it.img.h - 4, { blend: true });
    scene.blit(it.img, it.px, it.py, { blend: true });
  }
  scene.blit(fx.get('packet_1'), 8 * T, 8 * T, { blend: true });
  scene.blit(fx.get('heart'), 12 * T, 3 * T, { blend: true });
  return scene.scaled(4);
}
