// RUN ROOM asset generator. Draws every image with code; nothing is downloaded.
// Deterministic (seeded) and idempotent (files are only rewritten when their bytes change).
//
//   node tools/assets/generate.mjs      generate everything into client/public/assets
//                                       and write client/src/assets/manifest.ts
//
// Hand-drawn replacements: put art/overrides/<group>/<name>.png in the repo and re-run.
// Groups: tiles, props, fx, characters (ghost.png / byte.png), ui_icons, moods, chrome, portraits.

import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRng } from './lib/rng.mjs';
import { packAtlas } from './lib/atlas.mjs';
import { contactSheet } from './lib/contact.mjs';
import { buildBitmapFont, FONT3, FONT5 } from './lib/font.mjs';
import { OUT_DIR, writePng, writeJson, writeText, loadOverride, writeStats } from './lib/io.mjs';
import { Canvas, rgba } from './lib/canvas.mjs';
import { P } from './lib/palette.mjs';
import { buildTiles, tileSheet, TILE_COLUMNS } from './art/tiles.mjs';
import { buildProps } from './art/props.mjs';
import { buildFx } from './art/fx.mjs';
import { buildGhost, buildByte, sheetFromRows, charactersJson, FRAME_W, FRAME_H } from './art/characters.mjs';
import { buildIcons, buildDigits, buildCursors } from './art/icons.mjs';
import { buildMoods, MOOD_NAMES } from './art/moods.mjs';
import { buildChrome } from './art/chrome.mjs';
import { buildPortraits } from './art/portraits.mjs';
import { renderPreview } from './art/preview.mjs';
import { writeManifest, writePaletteCss } from './manifest.mjs';
import { maskCanvas, maskRegion, normalise, propRule, tileRule, CHARACTER_RULES } from './lib/emissive.mjs';

const SEED = 0x6a05;
const t0 = performance.now();
const rng = createRng(SEED);
const SHEETS_DIR = join(OUT_DIR, 'sheets');

function applyOverrides(group, items) {
  return items.map((it) => {
    const o = loadOverride(group, it.name, { w: it.canvas.w, h: it.canvas.h });
    return o ? { ...it, canvas: o } : it;
  });
}

/** Every opaque pixel of a sprite must use a palette color. */
const paletteRgba = new Set(
  Object.values(P)
    .filter(Boolean)
    .map((c) => rgba(c).join(',')),
);
function auditPalette(label, canvas) {
  for (const key of canvas.colors()) {
    if (!paletteRgba.has(key)) throw new Error(`palette audit: ${label} uses ${key} which is not in the palette module`);
  }
}

// --- A) Tiles --------------------------------------------------------------------------------
const tiles = applyOverrides('tiles', buildTiles(rng.fork('tiles')));
const { sheet: tilesetPng, index: tileIndex } = tileSheet(tiles);
auditPalette('tileset', tilesetPng);
writePng(join(OUT_DIR, 'tileset.png'), tilesetPng);
writeJson(join(OUT_DIR, 'tileset.json'), {
  image: 'tileset.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: TILE_COLUMNS,
  count: tiles.length,
  tiles: tileIndex,
});

// --- B) Props --------------------------------------------------------------------------------
const props = applyOverrides('props', buildProps(rng.fork('props')));
const propsAtlas = packAtlas(props, { imageFile: 'props.png', maxWidth: 256 });
auditPalette('props', propsAtlas.canvas);
writePng(join(OUT_DIR, 'props.png'), propsAtlas.canvas);
writeJson(join(OUT_DIR, 'props.json'), propsAtlas.json);

// --- C) Characters ---------------------------------------------------------------------------
const ghostRows = buildGhost();
const byteRows = buildByte();
const ghostSheet = loadOverride('characters', 'ghost', { w: 96, h: 120 }) ?? sheetFromRows(ghostRows);
const byteSheet = loadOverride('characters', 'byte', { w: 96, h: 120 }) ?? sheetFromRows(byteRows);
auditPalette('ghost', ghostSheet);
auditPalette('byte', byteSheet);
writePng(join(OUT_DIR, 'ghost.png'), ghostSheet);
writePng(join(OUT_DIR, 'byte.png'), byteSheet);
const charJson = charactersJson();
writeJson(join(OUT_DIR, 'characters.json'), charJson);

// --- D) FX -----------------------------------------------------------------------------------
const fx = applyOverrides('fx', buildFx());
const fxAtlas = packAtlas(fx, { imageFile: 'fx.png', maxWidth: 128 });
auditPalette('fx', fxAtlas.canvas);
writePng(join(OUT_DIR, 'fx.png'), fxAtlas.canvas);
writeJson(join(OUT_DIR, 'fx.json'), fxAtlas.json);

// --- E) UI icons, badge digits, cursors -----------------------------------------------------
const icons = applyOverrides('ui_icons', buildIcons());
const digits = applyOverrides('ui_icons', buildDigits());
const cursors = buildCursors();
const iconItems = [...icons, ...digits, ...cursors.map((c) => ({ name: c.name, canvas: c.canvas }))];
const iconAtlas = packAtlas(iconItems, { imageFile: 'ui_icons.png', maxWidth: 256 });
auditPalette('ui_icons', iconAtlas.canvas);
writePng(join(OUT_DIR, 'ui_icons.png'), iconAtlas.canvas);
writeJson(join(OUT_DIR, 'ui_icons.json'), iconAtlas.json);
const cursorManifest = {};
for (const c of cursors) {
  const file = `${c.name}.png`;
  writePng(join(OUT_DIR, file), c.canvas.scaled(2));
  cursorManifest[c.name.replace('cursor_', '')] = { image: file, width: 32, height: 32, hotX: c.hotspot.x * 2, hotY: c.hotspot.y * 2 };
}

// --- F) Mood faces ---------------------------------------------------------------------------
const moods = applyOverrides('moods', buildMoods());
const moodAtlas = packAtlas(moods, { imageFile: 'moods.png', maxWidth: 128 });
auditPalette('moods', moodAtlas.canvas);
writePng(join(OUT_DIR, 'moods.png'), moodAtlas.canvas);
writeJson(join(OUT_DIR, 'moods.json'), moodAtlas.json);

// --- G) 9-slice UI chrome --------------------------------------------------------------------
const chrome = buildChrome().map((c) => {
  const o = loadOverride('chrome', c.name, { w: c.canvas.w, h: c.canvas.h });
  return o ? { ...c, canvas: o } : c;
});
const chromeJson = { note: 'slice = 9-slice margins in source pixels (CSS border-image-slice / Phaser NineSlice)', images: {} };
for (const c of chrome) {
  auditPalette(`chrome ${c.name}`, c.canvas);
  writePng(join(OUT_DIR, 'ui', `${c.name}.png`), c.canvas);
  chromeJson.images[c.name] = { image: `ui/${c.name}.png`, width: c.canvas.w, height: c.canvas.h, slice: c.slice };
}
writeJson(join(OUT_DIR, 'ui', 'ui_chrome.json'), chromeJson);

// --- H) Portraits ----------------------------------------------------------------------------
const portraits = applyOverrides('portraits', buildPortraits());
const portraitManifest = {};
for (const p of portraits) {
  auditPalette(p.name, p.canvas);
  writePng(join(OUT_DIR, `${p.name}.png`), p.canvas);
  portraitManifest[p.name.replace('portrait_', '')] = { image: `${p.name}.png`, width: p.canvas.w, height: p.canvas.h };
}

// --- Bitmap fonts for the canvas (speech bubbles, tickers) ----------------------------------
const fontManifest = {};
for (const [font, file, role] of [
  [FONT5, 'font5x7', 'bubble'],
  [FONT3, 'font3x5', 'tiny'],
]) {
  const { canvas, xml } = buildBitmapFont(font, `${file}.png`);
  writePng(join(OUT_DIR, `${file}.png`), canvas);
  writeText(join(OUT_DIR, `${file}.xml`), xml);
  fontManifest[role] = { key: font.name, image: `${file}.png`, xml: `${file}.xml`, size: font.h, lineHeight: font.lineHeight, advance: font.advance };
}

// Favicon: Ghost's head from the front facing stand frame.
writePng(join(OUT_DIR, 'favicon.png'), ghostSheet.crop(0, 1, 16, 16));

// --- Emissive copies for night lighting ----------------------------------------------------
// Same layout as the source atlases; only light emitting pixels survive.
const propsEmissive = propsAtlas.canvas.clone();
const emissiveProps = [];
for (const [name, rect] of Object.entries(propsAtlas.frames)) {
  if (maskRegion(propsEmissive, rect, normalise(propRule(name)))) emissiveProps.push(name);
}
writePng(join(OUT_DIR, 'props_emissive.png'), propsEmissive);
writeJson(join(OUT_DIR, 'props_emissive.json'), { ...propsAtlas.json, meta: { ...propsAtlas.json.meta, image: 'props_emissive.png' } });

const tilesEmissive = tilesetPng.clone();
const emissiveTiles = [];
tiles.forEach((t, i) => {
  const rect = { x: (i % TILE_COLUMNS) * 16, y: Math.floor(i / TILE_COLUMNS) * 16, w: 16, h: 16 };
  if (maskRegion(tilesEmissive, rect, normalise(tileRule(t.name)))) emissiveTiles.push(t.name);
});
writePng(join(OUT_DIR, 'tileset_emissive.png'), tilesEmissive);

writePng(join(OUT_DIR, 'ghost_emissive.png'), maskCanvas(ghostSheet, CHARACTER_RULES.ghost));
writePng(join(OUT_DIR, 'byte_emissive.png'), maskCanvas(byteSheet, CHARACTER_RULES.byte));

// --- Contact sheets and preview --------------------------------------------------------------
writePng(
  join(SHEETS_DIR, 'tiles_sheet.png'),
  contactSheet(
    tiles.map((t) => ({ name: t.name, canvas: t.canvas })),
    { title: 'TILESET', maxWidth: 1400 },
  ),
);
writePng(
  join(SHEETS_DIR, 'props_sheet.png'),
  contactSheet(
    props.map((p) => ({ name: p.name, canvas: p.canvas })),
    { title: 'PROPS', maxWidth: 1600 },
  ),
);
writePng(join(SHEETS_DIR, 'fx_sheet.png'), contactSheet(fx, { title: 'FX', maxWidth: 1200 }));

const colNames = ['stand', 'step_a', 'stand', 'step_b', 'blink', 'unused'];
const charEntries = [];
for (const [who, rows] of [
  ['ghost', ghostRows],
  ['byte', byteRows],
]) {
  rows.forEach((row, r) => {
    row.forEach((f, c) => {
      if (r < 4 && c === 5) return;
      const label = r < 4 ? `${charJson.rowNames[r].replace('walk_', '')} ${colNames[c]}` : charJson.specialColumns[c];
      charEntries.push({ name: label, canvas: f, group: `${who.toUpperCase()} ${charJson.rowNames[r].toUpperCase()}` });
    });
  });
}
charEntries.push({ name: 'ghost.png', canvas: ghostSheet, group: 'FULL SHEETS' });
charEntries.push({ name: 'byte.png', canvas: byteSheet, group: 'FULL SHEETS' });
writePng(join(SHEETS_DIR, 'characters_sheet.png'), contactSheet(charEntries, { title: 'CHARACTERS', maxWidth: 1500 }));

// UI sheet: icons, digits, cursors, moods, chrome (native and stretched), portraits.
function stretched(c, w, h) {
  // Renders a 9-slice image at w x h source pixels (used only for the contact sheet).
  const out = new Canvas(w, h);
  const s = c.slice;
  const src = c.canvas;
  const cols = [
    [0, s.left, 0, s.left],
    [s.left, src.w - s.left - s.right, s.left, w - s.left - s.right],
    [src.w - s.right, s.right, w - s.right, s.right],
  ];
  const rows = [
    [0, s.top, 0, s.top],
    [s.top, src.h - s.top - s.bottom, s.top, h - s.top - s.bottom],
    [src.h - s.bottom, s.bottom, h - s.bottom, s.bottom],
  ];
  for (const [sy, sh, dy, dh] of rows) {
    for (const [sx, sw, dx, dw] of cols) {
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const p = src.get(sx + Math.min(sw - 1, Math.floor((x * sw) / dw)), sy + Math.min(sh - 1, Math.floor((y * sh) / dh)));
          if (p[3]) out.setRaw(dx + x, dy + y, p);
        }
      }
    }
  }
  return out;
}
const uiEntries = [
  ...icons.map((i) => ({ name: i.name, canvas: i.canvas, group: 'UI ICONS' })),
  ...digits.map((d) => ({ name: d.name, canvas: d.canvas, group: 'BADGE DIGITS' })),
  ...cursors.map((c) => ({ name: c.name, canvas: c.canvas, group: 'CURSORS' })),
  ...moods.map((m) => ({ name: m.name, canvas: m.canvas, group: 'MOOD FACES' })),
  ...chrome.map((c) => ({ name: c.name, canvas: c.canvas, group: '9-SLICE CHROME (NATIVE)' })),
  ...chrome
    .filter((c) => !c.name.startsWith('checkbox'))
    .map((c) => ({ name: `${c.name} 48x24`, canvas: stretched(c, 48, 24), group: '9-SLICE CHROME (STRETCHED)' })),
  ...portraits.map((p) => ({ name: p.name, canvas: p.canvas, group: 'PORTRAITS' })),
];
// The stretched previews reuse palette colors, so they pass the strict palette check.
writePng(join(SHEETS_DIR, 'ui_sheet.png'), contactSheet(uiEntries, { title: 'UI', maxWidth: 1600 }));

const tileMap = new Map(tiles.map((t) => [t.name, t.canvas]));
const propMap = new Map(props.map((p) => [p.name, p.canvas]));
const fxMap = new Map(fx.map((f) => [f.name, f.canvas]));
writePng(join(SHEETS_DIR, 'preview.png'), renderPreview({ tiles: tileMap, props: propMap, ghost: ghostSheet, byte: byteSheet, fx: fxMap }));

// --- I) Manifest (+ palette CSS variables for the HUD) ------------------------------------
writePaletteCss();
writeManifest({
  tileset: { columns: TILE_COLUMNS, index: tileIndex },
  props: propsAtlas,
  fx: fxAtlas,
  uiIcons: iconAtlas,
  moods: moodAtlas,
  characters: charJson,
  chrome,
  portraits: portraitManifest,
  cursors: cursorManifest,
  fonts: fontManifest,
  moodNames: MOOD_NAMES,
  emissive: {
    props: { key: 'props_emissive', image: 'props_emissive.png', json: 'props_emissive.json', frames: emissiveProps },
    tileset: { key: 'tiles_emissive', image: 'tileset_emissive.png', tiles: emissiveTiles },
    characters: { ghost: 'ghost_emissive.png', byte: 'byte_emissive.png' },
    nightTint: parseInt(P.gry1.slice(1), 16),
  },
  sheets: {
    tiles: 'sheets/tiles_sheet.png',
    props: 'sheets/props_sheet.png',
    characters: 'sheets/characters_sheet.png',
    fx: 'sheets/fx_sheet.png',
    ui: 'sheets/ui_sheet.png',
    preview: 'sheets/preview.png',
  },
});

const s = writeStats();
console.log(
  `assets: ${tiles.length} tiles, ${props.length} props, ${fx.length} fx, ${icons.length} icons, ${moods.length} moods, ` +
    `${chrome.length} chrome, 2 character sheets (${FRAME_W}x${FRAME_H}) - ${s.written} written, ${s.unchanged} unchanged, ` +
    `${Math.round(performance.now() - t0)} ms`,
);
