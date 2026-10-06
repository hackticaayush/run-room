// Mood faces (16x16): a shaded round face per mood, color coded, with a distinct expression.

import { Canvas } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

const FEATURE_LEGEND = { n: P.outline, W: P.white, C: P.cyan2, c: P.cyan3, g: P.gry2, R: P.red3, Y: P.yel3 };

function face(colors, features) {
  const c = new Canvas(16, 16);
  c.fillEllipse(8, 8, 6.6, 6.6, colors.base);
  // Light from the top-left: highlight crescent and a shaded lower right.
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (c.alpha(x, y) === 0) continue;
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      if (Canvas.inEllipse(x, y, 8, 8, 6.6, 6.6) && !Canvas.inEllipse(x + 1, y + 1, 8, 8, 6.6, 6.6) && dx + dy > 0) c.px(x, y, colors.shade);
      if (dx + dy < -6 && !Canvas.inEllipse(x - 1, y - 1, 8, 8, 6.6, 6.6)) c.px(x, y, colors.light);
    }
  }
  c.px(4, 4, colors.light);
  c.px(5, 3, colors.light);
  c.ascii(features, FEATURE_LEGEND);
  c.outline(P.outline);
  return c;
}

const MOODS = {
  caffeinated: {
    colors: { base: P.org2, light: P.org3, shade: P.org1 },
    features: [
      '................',
      '................',
      '................',
      '................',
      '....WWW..WWW....',
      '....WnW..WnW....',
      '....WWW..WWW....',
      '................',
      '.......nn.......',
      '.......nn.......',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  focused: {
    colors: { base: P.cyan2, light: P.cyan3, shade: P.cyan1 },
    features: [
      '................',
      '................',
      '................',
      '................',
      '....nnn..nnn....',
      '................',
      '....WnW..WnW....',
      '................',
      '................',
      '.....nnnnnn.....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  tired: {
    colors: { base: P.pur2, light: P.pur3, shade: P.pur1 },
    features: [
      '................',
      '................',
      '...........C....',
      '..........CcC...',
      '..........CCC...',
      '....nnn..nnn....',
      '.....n....n.....',
      '................',
      '................',
      '......nnnn......',
      '.....n....n.....',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  hyped: {
    colors: { base: P.grn2, light: P.grn3, shade: P.grn1 },
    features: [
      '................',
      '................',
      '................',
      '.....Y....Y.....',
      '....YYY..YYY....',
      '.....Y....Y.....',
      '................',
      '...nnnnnnnnnn...',
      '....nWWWWWWn....',
      '....nRRRRRRn....',
      '.....nnnnnn.....',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  overheating: {
    colors: { base: P.red2, light: P.red3, shade: P.red1 },
    features: [
      '...g.......g....',
      '..g.g.....g.g...',
      '................',
      '................',
      '....n.n..n.n....',
      '.....n....n.....',
      '....n.n..n.n....',
      '................',
      '................',
      '.....nnnnnn.....',
      '....n......n....',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
};

export const MOOD_NAMES = Object.keys(MOODS);

export function buildMoods() {
  return Object.entries(MOODS).map(([mood, def]) => ({ name: `mood_${mood}`, canvas: face(def.colors, def.features) }));
}
