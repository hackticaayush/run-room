// File helpers: PNG encode/decode, stable JSON, and the art override folder.

import { PNG } from 'pngjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from './canvas.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const OUT_DIR = join(REPO_ROOT, 'client', 'public', 'assets');
export const OVERRIDE_DIR = join(REPO_ROOT, 'art', 'overrides');

const stats = { written: 0, unchanged: 0 };
export function writeStats() {
  return { ...stats };
}

/** Writes bytes only when they differ, so re-running the generator is idempotent and quiet. */
export function writeIfChanged(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (existsSync(path)) {
    const old = readFileSync(path);
    if (old.equals(buf)) {
      stats.unchanged++;
      return false;
    }
  }
  writeFileSync(path, buf);
  stats.written++;
  return true;
}

export function encodePng(canvas) {
  const png = new PNG({ width: canvas.w, height: canvas.h, colorType: 6 });
  png.data = Buffer.from(canvas.data);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

export function writePng(path, canvas) {
  return writeIfChanged(path, encodePng(canvas));
}

export function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return Canvas.from(png.width, png.height, png.data);
}

export function writeJson(path, data) {
  return writeIfChanged(path, JSON.stringify(data, null, 2) + '\n');
}

export function writeText(path, text) {
  return writeIfChanged(path, text);
}

/**
 * Hand-drawn replacement art: art/overrides/<group>/<name>.png replaces the generated sprite
 * of the same name. Returns the override canvas or null.
 */
export function loadOverride(group, name, expected) {
  const file = join(OVERRIDE_DIR, group, `${name}.png`);
  if (!existsSync(file)) return null;
  const c = readPng(file);
  if (expected && (c.w !== expected.w || c.h !== expected.h)) {
    console.warn(`assets: override ${group}/${name}.png is ${c.w}x${c.h}, expected ${expected.w}x${expected.h} - ignored`);
    return null;
  }
  console.log(`assets: using override ${group}/${name}.png`);
  return c;
}
