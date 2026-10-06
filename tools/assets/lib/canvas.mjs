// Tiny pixel drawing library. No anti-aliasing, no gradients: every write sets exact pixels.
// Colors are palette hex strings ('#rrggbb' or '#rrggbbaa'); null means transparent.

import { inPalette } from './palette.mjs';

const cache = new Map();

/** Parses a palette hex string into [r, g, b, a]. */
export function rgba(color) {
  if (color == null) return null;
  if (Array.isArray(color)) return color;
  let v = cache.get(color);
  if (v) return v;
  const s = color.replace('#', '');
  v = [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255,
  ];
  cache.set(color, v);
  return v;
}

/** When true, drawing with a color that is not in the palette throws. */
export const settings = { strictPalette: true };

function check(color) {
  if (settings.strictPalette && typeof color === 'string' && !inPalette(color)) {
    throw new Error(`color ${color} is not in the palette module`);
  }
}

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  static from(w, h, data) {
    const c = new Canvas(w, h);
    c.data.set(data);
    return c;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Sets one pixel (overwrite, no blending). null clears it. */
  px(x, y, color) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return this;
    check(color);
    const i = (y * this.w + x) * 4;
    const c = rgba(color);
    if (!c) {
      this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0;
      return this;
    }
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
    return this;
  }

  /** Sets a pixel only where the canvas is currently transparent. */
  pxUnder(x, y, color) {
    if (this.inside(x, y) && this.alpha(x, y) === 0) this.px(x, y, color);
    return this;
  }

  /** Copies an existing [r, g, b, a] pixel value (taken from another canvas) without re-checking it. */
  setRaw(x, y, value) {
    if (!this.inside(x, y)) return this;
    const i = (y * this.w + x) * 4;
    this.data[i] = value[0];
    this.data[i + 1] = value[1];
    this.data[i + 2] = value[2];
    this.data[i + 3] = value[3];
    return this;
  }

  get(x, y) {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  alpha(x, y) {
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  /** Filled rectangle. */
  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
    return this;
  }

  /** 1px rectangle outline. */
  strokeRect(x, y, w, h, color) {
    this.hline(x, x + w - 1, y, color);
    this.hline(x, x + w - 1, y + h - 1, color);
    this.vline(x, y, y + h - 1, color);
    this.vline(x + w - 1, y, y + h - 1, color);
    return this;
  }

  hline(x0, x1, y, color) {
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = a; x <= b; x++) this.px(x, y, color);
    return this;
  }

  vline(x, y0, y1, color) {
    const [a, b] = y0 <= y1 ? [y0, y1] : [y1, y0];
    for (let y = a; y <= b; y++) this.px(x, y, color);
    return this;
  }

  /** Bresenham line. */
  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** True when pixel (x, y) lies inside the ellipse (pixel centers are tested). */
  static inEllipse(x, y, cx, cy, rx, ry) {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1.0001;
  }

  /** Filled ellipse. cx, cy may be fractional (use .0 for odd, .5 offsets for even sizes). */
  fillEllipse(cx, cy, rx, ry, color) {
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (Canvas.inEllipse(x, y, cx, cy, rx, ry)) this.px(x, y, color);
    }
    return this;
  }

  /** 1px ellipse outline: the filled pixels that touch a non-filled 4-neighbour. */
  ellipse(cx, cy, rx, ry, color) {
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    const inE = (x, y) => Canvas.inEllipse(x, y, cx, cy, rx, ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inE(x, y)) continue;
        if (!inE(x - 1, y) || !inE(x + 1, y) || !inE(x, y - 1) || !inE(x, y + 1)) this.px(x, y, color);
      }
    }
    return this;
  }

  /** 4-connected flood fill of the region that has the same RGBA as (x, y). */
  floodFill(x, y, color) {
    if (!this.inside(x, y)) return this;
    const target = this.get(x, y).join(',');
    const repl = rgba(color);
    if (repl && repl.join(',') === target) return this;
    const stack = [[x, y]];
    const seen = new Uint8Array(this.w * this.h);
    while (stack.length) {
      const [px, py] = stack.pop();
      if (!this.inside(px, py)) continue;
      const k = py * this.w + px;
      if (seen[k]) continue;
      seen[k] = 1;
      if (this.get(px, py).join(',') !== target) continue;
      this.px(px, py, color);
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    return this;
  }

  /**
   * ASCII art to pixels. rows: array of equal length strings. legend maps a character to a
   * palette color. '.' and ' ' are transparent (left untouched). Unknown characters throw.
   */
  ascii(rows, legend, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        if (!(ch in legend)) throw new Error(`ascii art: no legend entry for "${ch}" (row ${y})`);
        this.px(ox + x, oy + y, legend[ch]);
      }
    }
    return this;
  }

  /** Copies src onto this canvas. Transparent src pixels are skipped; with blend, alpha is composited. */
  blit(src, dx, dy, opts = {}) {
    const { flipX = false, flipY = false, blend = false } = opts;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const sy = flipY ? src.h - 1 - y : y;
        const si = (sy * src.w + sx) * 4;
        const a = src.data[si + 3];
        if (a === 0) continue;
        const tx = dx + x;
        const ty = dy + y;
        if (!this.inside(tx, ty)) continue;
        const ti = (ty * this.w + tx) * 4;
        if (!blend || a === 255) {
          this.data[ti] = src.data[si];
          this.data[ti + 1] = src.data[si + 1];
          this.data[ti + 2] = src.data[si + 2];
          this.data[ti + 3] = a;
          continue;
        }
        const fa = a / 255;
        const ba = this.data[ti + 3] / 255;
        const oa = fa + ba * (1 - fa);
        for (let k = 0; k < 3; k++) {
          const fc = src.data[si + k];
          const bc = this.data[ti + k];
          this.data[ti + k] = Math.round((fc * fa + bc * ba * (1 - fa)) / (oa || 1));
        }
        this.data[ti + 3] = Math.round(oa * 255);
      }
    }
    return this;
  }

  clone() {
    return Canvas.from(this.w, this.h, this.data);
  }

  /** Mirror horizontally (returns a new canvas). */
  mirrorH() {
    const c = new Canvas(this.w, this.h);
    c.blit(this, 0, 0, { flipX: true });
    return c;
  }

  /** Palette swap: map of palette hex -> palette hex. Returns a new canvas. */
  recolor(map) {
    const c = this.clone();
    const pairs = Object.entries(map).map(([from, to]) => [rgba(from), to]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const p = this.get(x, y);
        if (p[3] === 0) continue;
        for (const [f, to] of pairs) {
          if (f[0] === p[0] && f[1] === p[1] && f[2] === p[2] && f[3] === p[3]) {
            c.px(x, y, to);
            break;
          }
        }
      }
    }
    return c;
  }

  /** Adds a 1px outline (4-neighbourhood) around opaque pixels, in place. */
  outline(color, { diagonal = false, minAlpha = 200 } = {}) {
    const src = this.clone();
    const solid = (x, y) => src.alpha(x, y) >= minAlpha;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.alpha(x, y) !== 0) continue;
        let hit = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
        if (!hit && diagonal) hit = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
        if (hit) this.px(x, y, color);
      }
    }
    return this;
  }

  /** Replaces every pixel equal to `from` with `to`, in place. */
  replace(from, to) {
    const f = rgba(from);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const p = this.get(x, y);
        if (p[0] === f[0] && p[1] === f[1] && p[2] === f[2] && p[3] === f[3]) this.px(x, y, to);
      }
    }
    return this;
  }

  crop(x, y, w, h) {
    const c = new Canvas(w, h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!this.inside(x + i, y + j)) continue;
        const si = ((y + j) * this.w + (x + i)) * 4;
        const ti = (j * w + i) * 4;
        for (let k = 0; k < 4; k++) c.data[ti + k] = this.data[si + k];
      }
    }
    return c;
  }

  /** Returns a copy moved by (dx, dy); pixels shifted out are lost. */
  shifted(dx, dy) {
    const c = new Canvas(this.w, this.h);
    c.blit(this, dx, dy);
    return c;
  }

  /** Integer nearest-neighbour upscale. */
  scaled(n) {
    const c = new Canvas(this.w * n, this.h * n);
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const si = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4;
        const ti = (y * c.w + x) * 4;
        for (let k = 0; k < 4; k++) c.data[ti + k] = this.data[si + k];
      }
    }
    return c;
  }

  /** Bounding box of opaque pixels, or null when empty. */
  bounds() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) === 0) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Lists every distinct RGBA value used (for palette audits). */
  colors() {
    const set = new Set();
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] === 0) continue;
      set.add(this.data.slice(i, i + 4).join(','));
    }
    return set;
  }
}

/** Convenience: build a canvas from ASCII rows and a legend. */
export function fromAscii(rows, legend) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = new Canvas(w, rows.length);
  c.ascii(rows, legend);
  return c;
}
