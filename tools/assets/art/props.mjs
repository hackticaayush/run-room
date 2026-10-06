// Props atlas. 3/4 top-down view, light from the top-left, 1px dark outline.
// Animation frames are separate sprites named name_0, name_1, ...

import { Canvas, fromAscii } from '../lib/canvas.mjs';
import { P, NEON } from '../lib/palette.mjs';

const SCREEN = {
  green: { bg: P.grn0, line: P.grn2, dim: P.grn1, hot: P.grn3 },
  red: { bg: P.red0, line: P.red2, dim: P.red1, hot: P.red3 },
  blue: { bg: P.blu1, line: P.blu3, dim: P.blu2, hot: P.white },
  off: { bg: P.navy, line: P.wall1, dim: P.wall0, hot: P.gry0 },
};

/** Fills a screen rectangle with readable fake content for the given state. */
function screenContent(c, x, y, w, h, kind, rng) {
  const s = SCREEN[kind];
  c.rect(x, y, w, h, s.bg);
  if (kind === 'off') {
    // Dead screen: just a glare streak.
    c.line(x + 1, y + h - 2, x + 3, y + h - 4, P.wall1);
    c.px(x + 1, y + 1, P.wall1);
    return;
  }
  if (kind === 'red') {
    // Error: a warning block plus broken lines.
    for (let row = y + 1; row < y + h - 1; row += 2) {
      const len = rng.int(2, w - 3);
      c.hline(x + 1, x + len, row, rng.chance(0.3) ? s.hot : s.dim);
    }
    const bx = x + Math.floor(w / 2) - 2;
    const by = y + Math.floor(h / 2) - 2;
    c.rect(bx, by, 5, 4, s.line);
    c.vline(bx + 2, by + 1, by + 1, s.bg);
    c.px(bx + 2, by + 3, s.bg);
    return;
  }
  for (let row = y + 1; row < y + h - 1; row += 2) {
    const indent = rng.int(0, 2);
    const len = rng.int(2, Math.max(3, w - 2 - indent));
    c.hline(x + 1 + indent, Math.min(x + w - 2, x + indent + len), row, rng.chance(0.25) ? s.hot : s.line);
  }
  c.px(x + w - 2, y + h - 2, s.hot);
}

/** A desktop monitor whose bezel top-left is at (x, y). Screen size sw x sh. */
function monitor(c, x, y, sw, sh, kind, rng) {
  const w = sw + 4;
  const h = sh + 4;
  c.rect(x, y, w, h, P.gry0);
  c.hline(x, x + w - 1, y, P.gry1);
  c.vline(x, y, y + h - 1, P.gry1);
  c.hline(x, x + w - 1, y + h - 1, P.wall1);
  screenContent(c, x + 2, y + 2, sw, sh, kind, rng);
  // Glow ring just inside the bezel for lit screens.
  if (kind !== 'off') {
    const g = SCREEN[kind].dim;
    c.hline(x + 1, x + w - 2, y + 1, g);
    c.hline(x + 1, x + w - 2, y + h - 2, g);
    c.vline(x + 1, y + 1, y + h - 2, g);
    c.vline(x + w - 2, y + 1, y + h - 2, g);
  }
  // Stand
  const cx = x + Math.floor(w / 2) - 1;
  c.rect(cx, y + h, 2, 2, P.gry0);
  c.hline(cx - 2, cx + 3, y + h + 2, P.gry1);
}

function deskBody(c, x0, x1, top, depth, front, legsY) {
  // Desk surface (seen from above), front face, legs.
  c.rect(x0, top, x1 - x0 + 1, depth, P.wall2);
  c.hline(x0, x1, top, P.wall3);
  c.vline(x0, top, top + depth - 1, P.wall3);
  c.hline(x0, x1, top + depth - 1, P.wall1);
  c.rect(x0, top + depth, x1 - x0 + 1, front, P.wall1);
  c.hline(x0, x1, top + depth, P.wall0);
  c.rect(x0 + 1, legsY, 2, 2, P.wall0);
  c.rect(x1 - 2, legsY, 2, 2, P.wall0);
}

function desk(kind, rng) {
  const c = new Canvas(32, 24);
  deskBody(c, 1, 30, 12, 6, 4, 22);
  // Drawer
  c.strokeRect(19, 18, 10, 4, P.wall0);
  c.hline(22, 25, 20, P.gry1);
  // Keyboard and mouse
  c.rect(10, 14, 12, 2, P.gry0);
  for (let x = 11; x < 21; x += 2) c.px(x, 14, P.gry1);
  c.hline(10, 21, 16, P.wall1);
  c.px(24, 15, P.gry2);
  c.px(24, 16, P.gry1);
  // Mug
  c.rect(3, 12, 3, 3, P.white);
  c.px(6, 13, P.white);
  c.hline(3, 5, 12, P.brn1);
  c.px(5, 14, P.gry2);
  // Monitor
  monitor(c, 9, 1, 10, 7, kind, rng);
  c.outline(P.outline);
  return c;
}

function workstation(kind, rng) {
  const c = new Canvas(48, 32);
  deskBody(c, 1, 46, 17, 7, 5, 29);
  // Drawers
  c.strokeRect(3, 25, 9, 4, P.wall0);
  c.hline(6, 8, 27, P.gry1);
  c.strokeRect(36, 25, 9, 4, P.wall0);
  c.hline(39, 41, 27, P.gry1);
  // Side monitors (smaller, toned down)
  monitor(c, 2, 6, 8, 6, kind === 'off' ? 'off' : 'blue', rng);
  monitor(c, 34, 6, 8, 6, kind === 'off' ? 'off' : kind === 'red' ? 'red' : 'green', rng);
  // Main monitor
  monitor(c, 14, 1, 16, 10, kind, rng);
  // RGB keyboard with cyan underglow
  c.rect(16, 20, 14, 2, P.gry0);
  for (let x = 17; x < 29; x += 2) c.px(x, 20, P.gry1);
  c.hline(16, 29, 22, P.cyan1);
  c.px(32, 21, P.gry2);
  c.px(32, 22, P.gry1);
  // Energy drink can and a small lamp
  c.rect(41, 16, 2, 4, P.mag2);
  c.px(41, 16, P.mag3);
  c.hline(41, 42, 15, P.gry2);
  c.vline(5, 17, 19, P.gry1);
  c.rect(4, 15, 3, 2, P.cyan2);
  c.px(4, 15, P.cyan3);
  c.outline(P.outline);
  return c;
}

/** Scrolling code overlay for the main workstation screen (16x10). */
function screenCode(frameIndex, rng) {
  const c = new Canvas(16, 10);
  const lines = [];
  const r = rng.fork('code');
  for (let i = 0; i < 12; i++) lines.push({ indent: r.int(0, 3), len: r.int(3, 11), hot: r.chance(0.2) });
  for (let row = 0; row < 5; row++) {
    const l = lines[(row + frameIndex) % lines.length];
    const y = 1 + row * 2;
    c.hline(1 + l.indent, Math.min(14, 1 + l.indent + l.len), y, l.hot ? P.grn3 : P.grn2);
  }
  // Blinking cursor on even frames.
  if (frameIndex % 2 === 0) c.rect(13, 7, 2, 2, P.grn3);
  return c;
}

function chair() {
  const c = fromAscii(
    [
      '................',
      '....LLLLLLLh....',
      '...LLlllllllh...',
      '...LCCCCCCCCh...',
      '...Lllllllllh...',
      '...Llllllllhh...',
      '...Llllllllhh...',
      '...Lhhhhhhhhh...',
      '..SSSSSSSSSSSs..',
      '..sssssssssssd..',
      '.......dd.......',
      '.......dd.......',
      '...ddddddddddd..',
      '...d....d....d..',
      '...o....o....o..',
      '................',
    ],
    { L: P.wall3, l: P.wall2, h: P.wall1, C: P.cyan2, S: P.wall3, s: P.wall1, d: P.gry0, o: P.outline },
  );
  c.outline(P.outline);
  return c;
}

function serverRack(frameIndex, hot, rng) {
  const c = new Canvas(16, 32);
  // Top surface (3/4 view) and front face.
  c.rect(1, 1, 14, 3, P.wall2);
  c.hline(1, 14, 1, P.wall3);
  c.rect(1, 4, 14, 27, P.wall0);
  c.vline(1, 4, 30, P.wall2);
  c.vline(14, 4, 30, P.wall1);
  c.hline(1, 14, 4, P.wall1);
  // Server units with LEDs.
  const r = rng.fork(`rack${frameIndex}${hot}`);
  for (let u = 0; u < 5; u++) {
    const y = 6 + u * 4;
    c.hline(3, 12, y, P.gry0);
    c.rect(3, y + 1, 10, 2, P.navy);
    c.hline(8, 11, y + 1, P.gry0);
    c.hline(8, 11, y + 2, P.wall1);
    for (let k = 0; k < 2; k++) {
      const on = r.chance(hot ? 0.8 : 0.6);
      const col = hot ? (r.chance(0.6) ? P.red2 : P.org2) : r.pick([P.grn2, P.grn2, P.cyan2, P.org2]);
      c.px(4 + k * 2, y + 1, on ? col : hot ? P.red0 : P.grn0);
    }
    if (r.chance(0.5)) c.px(5, y + 2, hot ? P.red1 : P.cyan1);
  }
  // Vent grille at the bottom.
  for (let y = 27; y <= 29; y += 2) c.hline(3, 12, y, hot ? P.red1 : P.gry0);
  // Status strip on top.
  c.hline(4, 11, 2, hot ? P.red2 : frameIndex ? P.cyan1 : P.cyan2);
  c.outline(P.outline);
  return c;
}

function monitorWall(frameIndex) {
  const c = new Canvas(48, 24);
  c.rect(1, 1, 46, 21, P.wall1);
  c.hline(1, 46, 1, P.wall3);
  c.vline(1, 1, 21, P.wall3);
  // Three screens.
  const screens = [2, 17, 32];
  for (const sx of screens) {
    c.rect(sx, 3, 14, 11, P.navy);
    c.strokeRect(sx, 3, 14, 11, P.cyan0);
  }
  // Screen 1: bar graph.
  const bars = frameIndex ? [3, 6, 4, 8, 5, 7] : [5, 4, 7, 5, 8, 4];
  bars.forEach((h, i) => {
    c.vline(4 + i * 2, 12 - h + 1, 12, P.cyan2);
    c.px(4 + i * 2, 12 - h + 1, P.cyan3);
  });
  // Screen 2: waveform.
  const wave = frameIndex ? [8, 7, 5, 4, 5, 7, 9, 10, 9, 7, 6, 5] : [5, 6, 8, 9, 8, 6, 5, 4, 5, 7, 9, 9];
  wave.forEach((v, i) => c.px(18 + i, v, P.mag2));
  c.hline(18, 29, 11, P.mag0);
  // Screen 3: green load bars with labels.
  const loads = frameIndex ? [9, 5, 11, 7] : [7, 10, 6, 9];
  loads.forEach((l, i) => {
    c.hline(34, 34 + l, 5 + i * 2, P.grn2);
    c.px(34 + l, 5 + i * 2, P.grn3);
  });
  // Ticker strip: the game scrolls live text here with the generated 3x5 bitmap font.
  c.rect(2, 15, 44, 6, P.navy);
  c.hline(2, 45, 15, P.cyan0);
  // Status LEDs.
  c.px(42, 17, frameIndex ? P.grn2 : P.grn1);
  c.px(44, 17, frameIndex ? P.org1 : P.org2);
  c.outline(P.outline);
  return c;
}

function coffeeMachine() {
  const c = fromAscii(
    [
      '................',
      '....bbBBb.......',
      '..wgggggggggG...',
      '..wggggggggGG...',
      '..wgnnnnnnnGG...',
      '..wgnCcnnRnGG...',
      '..wgnnnnnnnGG...',
      '..wggggggggGG...',
      '..wgdddddddGG...',
      '..wgd.....dGG...',
      '..wgd.....dGG...',
      '..wgd.WWw.dGG...',
      '..wgd.Wbw.dGG...',
      '..wgdddddddGG...',
      '..wGGGGGGGGGG...',
      '..1111111111....',
      '..1222222221....',
      '..1222222221....',
      '..1220002221....',
      '..1222222221....',
      '..1222222221....',
      '..1111111111....',
      '..0........0....',
      '................',
    ],
    {
      b: P.brn2,
      B: P.brn3,
      w: P.white,
      g: P.gry2,
      G: P.gry1,
      d: P.gry0,
      n: P.navy,
      C: P.cyan2,
      c: P.cyan1,
      R: P.red2,
      W: P.white,
      '0': P.wall0,
      '1': P.wall1,
      '2': P.wall2,
    },
  );
  c.outline(P.outline);
  return c;
}

function couch() {
  const c = fromAscii(
    [
      '................................',
      '..LLLLLLLLLLLLLLLLLLLLLLLLLLLh..',
      '.LlllllllllllllhLllllllllllllhh.',
      '.Llllllllllllllhllllllllllllhhh.',
      '.Llllllllllllllhllllllllllllhhh.',
      '.LLhhhhhhhhhhhhhhhhhhhhhhhhhhhh.',
      '.LLLLLLLLLLLLLLhLLLLLLLLLLLLLhh.',
      '.LLlllllllllllhhLllllllllllllhh.',
      '.LLlllllllllllhhlllllllllllllhh.',
      '.LLlllllllllllhhlllllllllllllhh.',
      '.LLhhhhhhhhhhhhhhhhhhhhhhhhhhhh.',
      '.LLddddddddddddddddddddddddddhh.',
      '.hhddddddddddddddddddddddddddhh.',
      '..dddddddddddddddddddddddddddd..',
      '..o.........................o...',
      '................................',
    ],
    { L: P.pur3, l: P.pur2, h: P.pur1, d: P.pur0, o: P.outline },
  );
  c.outline(P.outline);
  return c;
}

function plant() {
  const c = fromAscii(
    [
      '................',
      '.......L........',
      '......LLl.......',
      '..ll..LLl..L....',
      '.lLLl.lLl.LLl...',
      '.lLLLllLlLLLl...',
      '..lLLLlLLLLl.l..',
      '...llLLLLLll.Ll.',
      '.Ll..lLLLl..LLl.',
      '.lLLl.lLl..LLl..',
      '..lLLLlLlLLLl...',
      '...llLLLLLLl....',
      '.....lLLLl......',
      '......ldl.......',
      '......ddd.......',
      '....BBBBBBB.....',
      '....bBBBBBb.....',
      '....bbbbbbn.....',
      '.....bbbbbn.....',
      '.....bbbbbn.....',
      '.....bbbbbn.....',
      '......bbbn......',
      '................',
      '................',
    ],
    { L: P.leaf3, l: P.leaf2, d: P.leaf1, B: P.brn3, b: P.brn2, n: P.brn1 },
  );
  c.outline(P.outline);
  return c;
}

function pizzaBox() {
  const c = fromAscii(
    [
      '................',
      '.BBBBBBBBBBBBB..',
      '.bbbbOOOOObbbb..',
      '.bbbbbYrYbbbbb..',
      '.bbbbbbYbbbbbb..',
      '.nnnnnnnnnnnnn..',
      '.BnnnnnnnnnnnB..',
      '.BnOOOOOOOOOnB..',
      '.BnOYYrYYYYOnB..',
      '.BnOYYYYYrYOnB..',
      '.BnOYrYY..YOnB..',
      '.BnOYYYY..YOnB..',
      '.BnOYYYrYYYOnB..',
      '.BnOOOOOOOOOnB..',
      '.BBBBBBBBBBBBB..',
      '................',
    ],
    { B: P.brn3, b: P.brn2, n: P.brn1, R: P.red2, O: P.org1, Y: P.yel2, r: P.red1 },
  );
  // The missing slice shows the box floor.
  c.px(8, 10, P.brn1);
  c.px(9, 10, P.brn1);
  c.px(8, 11, P.brn1);
  c.px(9, 11, P.brn1);
  c.outline(P.outline);
  return c;
}

function cat(frameIndex) {
  const tailUp = [
    '................',
    '.......O.O......',
    '......OOOOO.....',
    '......OgOgO..t..',
    '......OOpOO..t..',
    '.......WWW..t...',
    '......OOWOO.t...',
    '.....OOOOOOOt...',
    '.....OOdOOOO....',
    '.....OOOdOOO....',
    '.....OWOOOWO....',
    '......W...W.....',
    '................',
    '................',
    '................',
    '................',
  ];
  const tailSwish = [
    '................',
    '.......O.O......',
    '......OOOOO.....',
    '......OgOgO.....',
    '......OOpOO.....',
    '.......WWW......',
    '......OOWOO.....',
    '.....OOOOOOO....',
    '.....OOdOOOO..t.',
    '.....OOOdOOOtt..',
    '.....OWOOOWOt...',
    '......W...W.....',
    '................',
    '................',
    '................',
    '................',
  ];
  const c = fromAscii(frameIndex ? tailSwish : tailUp, {
    O: P.org2,
    d: P.org1,
    t: P.org1,
    W: P.white,
    g: P.grn2,
    p: P.red3,
  });
  c.outline(P.outline);
  return c.shifted(0, 4);
}

function catSleep() {
  const c = fromAscii(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '...O.O..........',
      '..OOOOO.ddd.....',
      '..OoOoOOOOOdd...',
      '..OOpOOOOOOOdd..',
      '..WWWOOOOOOOOd..',
      '...WttttOOOOOd..',
      '....tttttttdd...',
      '................',
      '................',
    ],
    { O: P.org2, d: P.org1, t: P.org3, W: P.white, o: P.outline, p: P.red3 },
  );
  c.outline(P.outline);
  return c;
}

function roundTable() {
  const c = new Canvas(32, 32);
  // Pedestal and base.
  c.fillEllipse(16, 28.5, 8, 2.5, P.wall0);
  c.rect(13, 18, 6, 10, P.wall1);
  c.vline(13, 18, 27, P.wall2);
  // Table edge (thickness) then the top surface.
  c.fillEllipse(16, 13, 15, 8, P.wall0);
  c.fillEllipse(16, 11, 15, 8, P.wall2);
  c.ellipse(16, 11, 15, 8, P.cyan1);
  c.fillEllipse(12, 8, 7, 3, P.wall3);
  // Holo projector disc.
  c.fillEllipse(16, 11, 3, 1.5, P.cyan1);
  c.px(15, 11, P.cyan2);
  c.px(16, 11, P.cyan3);
  c.outline(P.outline);
  return c;
}

function hologram(frameIndex) {
  const c = new Canvas(16, 24);
  // Light cone.
  for (let y = 14; y <= 22; y++) {
    const half = Math.round((22 - y) * 0.5) + 1;
    for (let x = 8 - half; x <= 7 + half; x++) if ((x + y) % 2 === 0) c.px(x, y, P.holoDim);
  }
  // Wireframe globe.
  c.ellipse(8, 8, 6, 6, P.cyan2);
  c.ellipse(8, 8, 6, 2, P.holo);
  c.hline(3, 12, 8, P.holo);
  const lon = frameIndex ? 2 : 4;
  c.ellipse(8, 8, lon, 6, P.holo);
  c.px(5, 4, P.cyan3);
  // Scanline flicker.
  if (frameIndex) c.hline(2, 13, 11, null);
  return c;
}

function neonSign(on) {
  const c = new Canvas(25, 11);
  c.rect(0, 0, 25, 11, P.navy);
  c.strokeRect(0, 0, 25, 11, P.wall1);
  const letters = {
    G: ['.##.', '#...', '#...', '#.##', '#..#', '#..#', '.##.'],
    H: ['#..#', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
    O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
    S: ['.###', '#...', '#...', '.##.', '...#', '...#', '###.'],
    T: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.'],
  };
  const n = NEON.magenta;
  const tube = new Canvas(25, 11);
  let x = 2;
  for (const ch of 'GHOST') {
    const rows = letters[ch];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') tube.px(x + rx, 2 + ry, on ? n.tube : P.gry0);
    });
    x += rows[0].length + 1;
  }
  if (on) {
    // A dim glow ring (darker tint) around every tube pixel, then a few hot cores.
    const glowRing = tube.clone();
    glowRing.outline(n.halo, { diagonal: false });
    c.blit(glowRing, 0, 0);
    c.px(3, 2, n.core);
    c.px(8, 5, n.core);
    c.px(13, 2, n.core);
    c.px(19, 2, n.core);
    c.px(22, 2, n.core);
  } else {
    c.blit(tube, 0, 0);
  }
  // Mounting brackets.
  c.px(1, 5, P.gry1);
  c.px(23, 5, P.gry1);
  return c;
}

function posterSkull() {
  const c = fromAscii(
    [
      '................',
      '.MMMMMMMMMMMMMM.',
      '.MppppppppppppM.',
      '.Mpp..WWWW..ppM.',
      '.Mp..WWWWWW..pM.',
      '.Mp.WWnnWnnW.pM.',
      '.Mp.WWnnWnnW.pM.',
      '.Mp.WWWWnWWW.pM.',
      '.Mp..WWWWWW..pM.',
      '.Mpp..WnWnW.ppM.',
      '.Mppp.WWWWW.ppM.',
      '.MppppppppppppM.',
      '.MpCCCpCCCpCCpM.',
      '.MppppppppppppM.',
      '.MMMMMMMMMMMMMM.',
      '................',
    ],
    { M: P.mag1, p: P.pur0, W: P.white, n: P.pur0, C: P.cyan2 },
  );
  c.outline(P.outline);
  return c;
}

function vendingMachine(rng) {
  const c = new Canvas(16, 32);
  c.rect(1, 1, 14, 30, P.wall2);
  c.hline(1, 14, 1, P.wall4);
  c.rect(1, 2, 14, 2, P.wall3);
  c.vline(1, 1, 30, P.wall3);
  c.vline(14, 1, 30, P.wall1);
  // Glowing header.
  c.rect(2, 4, 12, 3, P.mag1);
  c.hline(3, 12, 5, P.mag2);
  c.px(4, 5, P.mag3);
  c.px(9, 5, P.mag3);
  // Glass with shelves of cans.
  c.rect(2, 8, 9, 15, P.navy);
  const r = rng.fork('vending');
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 9 + shelf * 4;
    for (let k = 0; k < 4; k++) {
      const col = r.pick([P.cyan2, P.mag2, P.yel2, P.grn2, P.org2, P.red2]);
      c.vline(3 + k * 2, y, y + 1, col);
      c.px(3 + k * 2, y, P.white);
    }
    c.hline(2, 10, y + 2, P.gry0);
  }
  c.vline(2, 8, 22, P.cyan1);
  // Side panel: coin slot and buttons.
  c.rect(11, 8, 3, 15, P.wall1);
  c.px(12, 9, P.outline);
  c.px(12, 10, P.outline);
  for (let k = 0; k < 4; k++) c.px(12, 13 + k * 2, [P.grn2, P.yel2, P.red2, P.cyan2][k]);
  // Pickup slot and base.
  c.rect(3, 24, 9, 3, P.outline);
  c.hline(3, 11, 24, P.wall1);
  c.rect(1, 28, 14, 3, P.wall1);
  c.outline(P.outline);
  return c;
}

function filingCabinet() {
  const c = new Canvas(16, 24);
  c.rect(2, 1, 12, 3, P.gry2);
  c.hline(2, 13, 1, P.white);
  c.rect(2, 4, 12, 19, P.gry1);
  c.vline(2, 4, 22, P.gry2);
  c.vline(13, 4, 22, P.gry0);
  for (let d = 0; d < 3; d++) {
    const y = 5 + d * 6;
    c.strokeRect(3, y, 10, 5, P.gry0);
    c.rect(6, y + 1, 4, 1, P.white);
    c.hline(6, 9, y + 3, P.gry2);
    c.px(6, y + 3, P.white);
  }
  c.outline(P.outline);
  return c;
}

function labBench() {
  const c = new Canvas(32, 16);
  deskBody(c, 1, 30, 1, 8, 4, 13);
  // PCB with traces.
  c.rect(3, 2, 8, 5, P.grn1);
  c.hline(4, 9, 3, P.grn2);
  c.vline(9, 3, 5, P.grn2);
  c.px(5, 5, P.yel2);
  c.px(7, 5, P.gry2);
  // Soldering iron (orange hot tip).
  c.hline(13, 18, 4, P.gry1);
  c.hline(13, 15, 5, P.red1);
  c.px(19, 4, P.org2);
  c.px(20, 4, P.org3);
  // Multimeter.
  c.rect(22, 2, 5, 6, P.yel2);
  c.rect(23, 3, 3, 2, P.navy);
  c.px(24, 3, P.grn2);
  c.px(24, 6, P.outline);
  // Screwdriver.
  c.hline(27, 29, 6, P.gry2);
  c.px(26, 6, P.red2);
  // Drawers.
  c.strokeRect(4, 9, 8, 4, P.wall0);
  c.strokeRect(20, 9, 8, 4, P.wall0);
  c.outline(P.outline);
  return c;
}

function mailDropbox(full) {
  const c = fromAscii(
    [
      '................',
      '......ddd.......',
      '......dGd.......',
      '...LLLLLLLLh....',
      '...LlllllllhR...',
      '...LooooooohR...',
      '...LlllllllhR...',
      '...LlCClllll....',
      '...LlCClllll....',
      '...Lllllllll....',
      '...Llwwwwwll....',
      '...Lllllllll....',
      '...LLLLLLLLh....',
      '...hhhhhhhhh....',
      '...d.......d....',
      '................',
    ],
    { L: P.wall4, l: P.wall3, h: P.wall2, o: P.outline, d: P.gry0, G: P.gry1, C: full ? P.yel2 : P.cyan1, w: P.white, R: full ? P.red2 : P.wall2 },
  );
  if (full) {
    // Envelopes sticking out of the slot, flag up.
    c.rect(5, 4, 3, 2, P.white);
    c.rect(8, 3, 3, 3, P.white);
    c.px(9, 4, P.gry2);
    c.px(6, 4, P.gry2);
    c.vline(13, 1, 4, P.red2);
    c.px(12, 1, P.red2);
  }
  c.outline(P.outline);
  return c;
}

function taskInboxTray() {
  const c = fromAscii(
    [
      '................',
      '................',
      '....yyy.........',
      '...wwwwwwwwww...',
      '...wggggggggw...',
      '..wwwwwwwwwww...',
      '..wgggggggggw...',
      '..LLLLLLLLLLLh..',
      '..LddddddddddhW.',
      '..hhhhhhhhhhhh..',
      '...d........d...',
      '...d........d...',
      '...d........d...',
      '..ddd......ddd..',
      '................',
      '................',
    ],
    { y: P.yel2, w: P.white, g: P.gry2, L: P.wall4, d: P.wall2, h: P.wall1, W: P.cyan2 },
  );
  c.outline(P.outline);
  return c;
}

function whiteboard() {
  const c = new Canvas(32, 16);
  c.rect(1, 1, 30, 12, P.gry2);
  c.rect(2, 2, 28, 10, P.white);
  // Scribbles: boxes, arrows drawn as plain lines, a red circle.
  c.strokeRect(4, 4, 6, 3, P.cyan1);
  c.strokeRect(14, 3, 6, 3, P.mag1);
  c.strokeRect(14, 8, 6, 3, P.cyan1);
  c.hline(10, 13, 5, P.gry0);
  c.line(20, 4, 24, 6, P.gry0);
  c.line(20, 9, 24, 7, P.gry0);
  c.ellipse(26, 7, 2.5, 2.5, P.red2);
  c.hline(4, 9, 9, P.gry1);
  c.hline(4, 7, 10, P.gry1);
  // Marker tray.
  c.rect(6, 13, 20, 1, P.gry1);
  c.px(9, 12, P.red2);
  c.px(11, 12, P.cyan2);
  c.outline(P.outline);
  return c;
}

function bug(frameIndex) {
  const legs = frameIndex
    ? ['..l..l..', '...gg...', '.lgGGgl.', '..gGGg..', '.lgGGgl.', '..g..g..', '.l....l.', '........']
    : ['.l....l.', '..lggl..', '..gGGg..', '.lgGGgl.', '..gGGg..', '.lg..gl.', '........', '........'];
  const c = fromAscii(legs, { l: P.gry0, g: P.grn1, G: P.grn2 });
  c.outline(P.outline);
  return c;
}

function robotCourier(frameIndex) {
  const c = fromAscii(
    [
      '................',
      '.......a........',
      '.......d........',
      '....bbbbbbb.....',
      '....bBBBBBk.....',
      '....bBBBBBk.....',
      '...wwwwwwwwG....',
      '...wnnnnnnnG....',
      '...wnCnnnCnG....',
      '...wnnnnnnnG....',
      '...wggggggGG....',
      '...GGGGGGGGG....',
      '...dd.....dd....',
      '...dd.....dd....',
      '................',
      '................',
    ],
    { a: frameIndex ? P.cyan1 : P.cyan3, d: P.gry0, b: P.brn3, B: P.brn2, k: P.brn1, n: P.navy, w: P.white, G: P.gry1, g: P.gry2, C: frameIndex ? P.cyan1 : P.cyan2 },
  );
  c.outline(P.outline);
  return c;
}

function windowRain(frameIndex, rng) {
  const c = new Canvas(16, 32);
  c.rect(1, 2, 14, 25, P.wall4);
  c.rect(2, 3, 12, 23, P.navy);
  // Skyline.
  const r = rng.fork('rainwindow');
  let x = 2;
  while (x <= 13) {
    const bw = r.int(2, 3);
    const bh = r.int(5, 12);
    c.rect(x, 25 - bh + 1, Math.min(bw, 14 - x), bh, P.wall0);
    for (let wy = 26 - bh; wy <= 25; wy += 2) {
      for (let wx = x; wx < Math.min(x + bw, 14); wx++) if (r.chance(0.3)) c.px(wx, wy, r.pick([P.yel2, P.org2, P.cyan2, P.mag2]));
    }
    x += bw;
  }
  // Rain streaks.
  for (let i = 0; i < 9; i++) {
    const sx = 2 + ((i * 5 + frameIndex * 3) % 12);
    const sy = 3 + ((i * 7 + frameIndex * 4) % 20);
    c.px(sx, sy, P.blu2);
    if (sy + 1 <= 25) c.px(sx, sy + 1, P.blu1);
  }
  // Cross bars and sill.
  c.vline(8, 3, 25, P.wall2);
  c.hline(2, 13, 14, P.wall2);
  c.hline(1, 14, 27, P.wall4);
  c.hline(1, 14, 28, P.wall2);
  c.outline(P.outline);
  return c;
}

function cablesProp() {
  const c = new Canvas(16, 16);
  c.ellipse(6, 9, 4, 3, P.gry1);
  c.ellipse(6.5, 9.5, 3, 2, P.gry0);
  c.ellipse(10, 10, 4, 2.5, P.pur2);
  c.line(10, 8, 15, 4, P.pur1);
  c.line(2, 9, 0, 13, P.gry1);
  c.px(13, 12, P.cyan2);
  c.px(14, 12, P.gry2);
  c.outline(P.outline);
  return c;
}

function stackedCrates() {
  const c = new Canvas(16, 24);
  // Bottom wooden crate.
  c.rect(1, 12, 14, 10, P.brn2);
  c.hline(1, 14, 12, P.brn3);
  c.hline(1, 14, 16, P.brn1);
  c.vline(1, 12, 21, P.brn3);
  c.vline(14, 12, 21, P.brn1);
  c.line(2, 13, 13, 21, P.brn1);
  // Top plastic hardware crate with a cyan label.
  c.rect(3, 3, 11, 9, P.wall2);
  c.hline(3, 13, 3, P.wall4);
  c.vline(3, 3, 11, P.wall3);
  c.vline(13, 3, 11, P.wall1);
  c.rect(5, 6, 6, 3, P.cyan1);
  c.hline(6, 9, 7, P.cyan3);
  c.outline(P.outline);
  return c;
}

function energyCans() {
  const c = fromAscii(
    [
      '................',
      '................',
      '................',
      '................',
      '..LLL...........',
      '..wMm.LLL.......',
      '..wMm.wCc.......',
      '..wMm.wCc.LLL...',
      '..wMm.wCc.wGe...',
      '..wMm.wCc.wGe...',
      '..MMm.CCc.wGe...',
      '..........GGe...',
      '......yYYyy.....',
      '.....jyYYyj.....',
      '................',
      '................',
    ],
    { L: P.gry2, w: P.white, M: P.mag2, m: P.mag1, C: P.cyan2, c: P.cyan1, G: P.grn2, e: P.grn1, y: P.yel2, Y: P.yel3, j: P.yel1 },
  );
  c.outline(P.outline);
  return c;
}

function chargerPad() {
  const c = new Canvas(16, 16);
  c.fillEllipse(8, 9, 7, 4, P.wall0);
  c.ellipse(8, 9, 7, 4, P.yel1);
  c.ellipse(8, 9, 5, 2.5, P.yel0);
  // Lightning mark drawn as pixels.
  c.px(8, 7, P.yel2);
  c.px(7, 8, P.yel2);
  c.px(8, 8, P.yel2);
  c.px(9, 8, P.yel2);
  c.px(8, 9, P.yel2);
  c.px(7, 10, P.yel2);
  c.px(8, 11, P.yel3);
  return c;
}

/** Soft dithered halo used for night time glows (drawn additively by the game). */
function glow(color, size) {
  const c = new Canvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      if (d < 0.45 || (d < 0.75 && (x + y) % 2 === 0) || (d <= 1 && x % 2 === 0 && y % 2 === 0)) c.px(x, y, color);
    }
  }
  return c;
}

export function buildProps(rng) {
  const props = [];
  const add = (name, canvas, data) => props.push({ name, canvas, data });
  const r = (salt) => rng.fork(salt);

  for (const kind of ['green', 'red', 'blue', 'off']) add(`desk_${kind}`, desk(kind, r(`desk_${kind}`)));
  for (const kind of ['green', 'red', 'blue', 'off']) add(`workstation_desk_${kind}`, workstation(kind, r(`ws_${kind}`)));
  add('workstation_desk', workstation('green', r('ws_green')));
  for (let i = 0; i < 4; i++) add(`screen_code_${i}`, screenCode(i, r('screen_code')));
  add('chair', chair());
  for (let i = 0; i < 2; i++) add(`server_rack_${i}`, serverRack(i, false, rng));
  for (let i = 0; i < 2; i++) add(`server_rack_hot_${i}`, serverRack(i, true, rng));
  for (let i = 0; i < 2; i++) add(`monitor_wall_${i}`, monitorWall(i));
  add('coffee_machine', coffeeMachine());
  add('couch', couch());
  add('plant', plant());
  add('pizza_box', pizzaBox());
  for (let i = 0; i < 2; i++) add(`cat_${i}`, cat(i));
  add('cat_sleep', catSleep());
  add('round_table', roundTable());
  for (let i = 0; i < 2; i++) add(`hologram_${i}`, hologram(i));
  add('neon_sign_on', neonSign(true));
  add('neon_sign_off', neonSign(false));
  add('poster_skull', posterSkull());
  add('vending_machine', vendingMachine(rng));
  add('filing_cabinet', filingCabinet());
  add('lab_bench', labBench());
  add('mail_dropbox', mailDropbox(false));
  add('mail_dropbox_full', mailDropbox(true));
  add('task_inbox_tray', taskInboxTray());
  add('whiteboard', whiteboard());
  for (let i = 0; i < 2; i++) add(`bug_${i}`, bug(i));
  for (let i = 0; i < 2; i++) add(`robot_courier_${i}`, robotCourier(i));
  for (let i = 0; i < 2; i++) add(`window_rain_${i}`, windowRain(i, rng));
  add('cables', cablesProp());
  add('stacked_crates', stackedCrates());
  add('energy_drink_cans', energyCans());
  add('charger_pad', chargerPad());
  add('glow_cyan', glow(P.glowCyan, 24));
  add('glow_green', glow(P.glowGreen, 24));
  add('glow_magenta', glow(P.glowMagenta, 24));
  add('glow_red', glow(P.glowRed, 24));
  return props;
}
