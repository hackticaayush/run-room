// Emissive masks: copies of sprites that keep only the pixels that emit light (screens, LEDs,
// neon, lit windows, visors). At night the game darkens every sprite with a tint and draws the
// emissive copy on top, so screens stay bright while the room goes dark.

import { Canvas, rgba } from './canvas.mjs';
import { P, NEON } from './palette.mjs';

const key = (c) => rgba(c).join(',');

/**
 * Rule: { colors?: palette colors to keep, rects?: [x, y, w, h][] regions to keep, all?: true }.
 * A pixel is kept when it is opaque, inside a rect (if rects are given) and its color is listed
 * (if colors are given).
 */
export function maskCanvas(canvas, rule) {
  const out = new Canvas(canvas.w, canvas.h);
  if (!rule) return out;
  const colorSet = rule.colors ? new Set(rule.colors.map(key)) : null;
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      const p = canvas.get(x, y);
      if (p[3] === 0) continue;
      if (rule.rects && !rule.rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh)) continue;
      if (colorSet && !colorSet.has(p.join(','))) continue;
      out.setRaw(x, y, p);
    }
  }
  return out;
}

/** Masks a region of a packed atlas canvas in place (used to derive the emissive atlas). */
export function maskRegion(atlasCanvas, rect, rule) {
  const sub = atlasCanvas.crop(rect.x, rect.y, rect.w, rect.h);
  const masked = maskCanvas(sub, rule);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) atlasCanvas.setRaw(rect.x + x, rect.y + y, masked.get(x, y));
  }
  return masked.bounds() !== null;
}

const LEDS = [P.grn2, P.grn3, P.cyan1, P.cyan2, P.cyan3, P.org2, P.red1, P.red2, P.red3];
const neon = (hue) => Object.values(NEON[hue]);
const LIT_WINDOWS = [P.yel2, P.yel3, P.org2, P.cyan2, P.mag2, P.white, P.blu3, P.blu2, P.blu1];

/** Emissive rule for a prop sprite name (null = nothing glows). */
export function propRule(name) {
  if (/^desk_(green|red|blue)$/.test(name)) return { rects: [[10, 2, 12, 9]] };
  if (/^workstation_desk(_(green|red|blue))?$/.test(name)) {
    return { rects: [[15, 2, 18, 12], [3, 7, 10, 8], [35, 7, 10, 8], [16, 22, 14, 1], [4, 15, 3, 2]] };
  }
  if (/^workstation_desk_off$/.test(name)) return { rects: [[16, 22, 14, 1], [4, 15, 3, 2]] };
  if (/^screen_code_/.test(name)) return { all: true };
  if (/^server_rack/.test(name)) return { colors: LEDS };
  if (/^monitor_wall_/.test(name)) return { rects: [[2, 3, 44, 18]] };
  if (name === 'neon_sign_on') return { colors: neon('magenta') };
  if (name === 'vending_machine') return { rects: [[2, 4, 12, 19]], colors: [P.mag1, P.mag2, P.mag3, P.cyan1, P.cyan2, P.yel2, P.grn2, P.org2, P.red2, P.white] };
  if (/^hologram_/.test(name)) return { all: true };
  if (/^window_rain_/.test(name)) return { colors: LIT_WINDOWS };
  if (name === 'coffee_machine') return { colors: [P.cyan1, P.cyan2, P.red2] };
  if (/^mail_dropbox/.test(name)) return { colors: [P.cyan1, P.yel2] };
  if (/^robot_courier_/.test(name)) return { colors: [P.cyan1, P.cyan2, P.cyan3] };
  if (name === 'charger_pad') return { colors: [P.yel1, P.yel2, P.yel3] };
  if (name === 'chair') return { colors: [P.cyan2] };
  return null;
}

/** Emissive rule for a tile name. */
export function tileRule(name) {
  if (name.startsWith('wall_neon_cyan')) return { colors: neon('cyan') };
  if (name.startsWith('wall_neon_magenta')) return { colors: neon('magenta') };
  if (name === 'floor_neon') return { colors: neon('cyan') };
  if (name.startsWith('window_night')) return { colors: LIT_WINDOWS };
  if (name === 'door') return { colors: [P.grn2, P.grn0] };
  if (name === 'door_side') return { colors: [P.grn1, P.grn2] };
  if (name.startsWith('wall_face') || name.startsWith('wall_neon')) return { colors: [P.cyan0] };
  return null;
}

/** Emissive rules for the character sheets: Ghost's visor and strings, Byte's eyes. */
export const CHARACTER_RULES = {
  ghost: { colors: [P.cyan1, P.cyan2, P.cyan3] },
  byte: { colors: [P.yel3] },
};

/** Normalises the "all" flag: maskCanvas treats a rule without colors / rects as keep-all. */
export function normalise(rule) {
  if (!rule) return null;
  if (rule.all) return {};
  return rule;
}
