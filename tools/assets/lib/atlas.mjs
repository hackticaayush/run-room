// Shelf packer that writes Phaser-compatible "JSON hash" atlases.

import { Canvas } from './canvas.mjs';

/**
 * items: [{ name, canvas, data? }]. Packs tallest first into shelves of maxWidth with a 1px gap.
 * Returns { canvas, frames: { name: { x, y, w, h } }, json }.
 */
export function packAtlas(items, { imageFile, maxWidth = 256, gap = 1, extra = {} } = {}) {
  const names = new Set();
  for (const it of items) {
    if (names.has(it.name)) throw new Error(`atlas ${imageFile}: duplicate sprite name ${it.name}`);
    names.add(it.name);
    if (it.canvas.w > maxWidth) throw new Error(`atlas ${imageFile}: ${it.name} wider than ${maxWidth}`);
  }
  const order = [...items].sort((a, b) => b.canvas.h - a.canvas.h || b.canvas.w - a.canvas.w || (a.name < b.name ? -1 : 1));

  const placed = [];
  let shelfY = gap;
  let shelfH = 0;
  let cursorX = gap;
  let usedW = 0;
  for (const it of order) {
    const { w, h } = it.canvas;
    if (cursorX + w + gap > maxWidth) {
      shelfY += shelfH + gap;
      shelfH = 0;
      cursorX = gap;
    }
    placed.push({ it, x: cursorX, y: shelfY });
    cursorX += w + gap;
    usedW = Math.max(usedW, cursorX);
    shelfH = Math.max(shelfH, h);
  }
  const totalH = shelfY + shelfH + gap;
  const canvas = new Canvas(usedW, totalH);
  const frames = {};
  const jsonFrames = {};
  // Keep JSON keys in the caller's order (stable diffs, readable files).
  const byName = new Map(placed.map((p) => [p.it.name, p]));
  for (const it of items) {
    const p = byName.get(it.name);
    canvas.blit(it.canvas, p.x, p.y);
    const { w, h } = it.canvas;
    frames[it.name] = { x: p.x, y: p.y, w, h };
    jsonFrames[it.name] = {
      frame: { x: p.x, y: p.y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      ...(it.data ? { data: it.data } : {}),
    };
  }
  const json = {
    frames: jsonFrames,
    meta: {
      app: 'run-room asset generator',
      version: '1',
      image: imageFile,
      format: 'RGBA8888',
      size: { w: canvas.w, h: canvas.h },
      scale: '1',
      ...extra,
    },
  };
  return { canvas, frames, json };
}
