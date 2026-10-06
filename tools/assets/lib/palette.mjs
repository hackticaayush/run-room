// The ONE palette for every generated asset. No color may appear outside this module.
// Ramps run dark (0) to light (3). Light comes from the top-left.

export const P = {
  // Base
  clear: null,
  outline: '#05070d',
  navy: '#0b0f1a',

  // Floor ramp (brief: #141a2e / #1c2442)
  floor0: '#0f1426',
  floor1: '#141a2e',
  floor2: '#1c2442',
  floor3: '#262f55',

  // Wall ramp (brief: #1a2038 / #10142a / #2a3260)
  wall0: '#10142a',
  wall1: '#1a2038',
  wall2: '#2a3260',
  wall3: '#3a4682',
  wall4: '#4f5ca6',

  // Neon cyan (brief: #00f0ff)
  cyan0: '#06303d',
  cyan1: '#00788a',
  cyan2: '#00f0ff',
  cyan3: '#b0fcff',

  // Neon magenta (brief: #ff2bd6)
  mag0: '#3d0a35',
  mag1: '#a0157f',
  mag2: '#ff2bd6',
  mag3: '#ffa8ef',

  // Purple (brief: #8a4dff)
  pur0: '#22134a',
  pur1: '#4f2aa0',
  pur2: '#8a4dff',
  pur3: '#c4a3ff',

  // Matrix green (brief: #39ff14)
  grn0: '#0c3307',
  grn1: '#1f8a0c',
  grn2: '#39ff14',
  grn3: '#b8ffa3',

  // Orange (brief: #ff9f1c)
  org0: '#4a2604',
  org1: '#b5650c',
  org2: '#ff9f1c',
  org3: '#ffd291',

  // Red (brief: #ff3355)
  red0: '#450b17',
  red1: '#a31d38',
  red2: '#ff3355',
  red3: '#ff9fad',

  // Yellow (brief: #ffe14d)
  yel0: '#453a07',
  yel1: '#b39614',
  yel2: '#ffe14d',
  yel3: '#fff4b8',

  // Screen blue (for the blue desk screen variant)
  blu0: '#0b1a4d',
  blu1: '#1d3fae',
  blu2: '#3f73ff',
  blu3: '#a6c0ff',

  // Neutral metal / white (brief: #e8f0ff)
  gry0: '#353e5e',
  gry1: '#5d6890',
  gry2: '#9aa5c8',
  white: '#e8f0ff',

  // Skin (brief: #e0ac8c)
  skin0: '#7d4f3d',
  skin1: '#b47a62',
  skin2: '#e0ac8c',
  skin3: '#f2cbb0',

  // Ghost's hoodie
  hood0: '#221e3d',
  hood1: '#363061',
  hood2: '#4f478c',
  hood3: '#6e65b8',

  // Leaves
  leaf0: '#0e2a1a',
  leaf1: '#1b5131',
  leaf2: '#2c8549',
  leaf3: '#62c977',

  // Brown (pots, cardboard, coffee, crates)
  brn0: '#26170f',
  brn1: '#4d2f1e',
  brn2: '#7d5131',
  brn3: '#b6834f',

  // Translucent helpers (shadows and hologram light). Still palette entries.
  shadow: '#05070d70',
  shadowSoft: '#05070d40',
  holo: '#00f0ff80',
  holoDim: '#00f0ff40',
  nightTint: '#0b0f1ab0',
  glowCyan: '#00f0ff38',
  glowGreen: '#39ff1430',
  glowMagenta: '#ff2bd638',
  glowRed: '#ff335538',
  glowYellow: '#ffe14d38',
};

/** Neon hues and their glow rings, used by every neon element. */
export const NEON = {
  cyan: { core: P.cyan3, tube: P.cyan2, glow: P.cyan1, halo: P.cyan0 },
  magenta: { core: P.mag3, tube: P.mag2, glow: P.mag1, halo: P.mag0 },
  green: { core: P.grn3, tube: P.grn2, glow: P.grn1, halo: P.grn0 },
  yellow: { core: P.yel3, tube: P.yel2, glow: P.yel1, halo: P.yel0 },
  red: { core: P.red3, tube: P.red2, glow: P.red1, halo: P.red0 },
  purple: { core: P.pur3, tube: P.pur2, glow: P.pur1, halo: P.pur0 },
  orange: { core: P.org3, tube: P.org2, glow: P.org1, halo: P.org0 },
};

const ALLOWED = new Set(Object.values(P).filter(Boolean).map((c) => c.toLowerCase()));

/** True when a color string belongs to the palette. Used by the generator self-check. */
export function inPalette(color) {
  return color == null || ALLOWED.has(String(color).toLowerCase());
}
