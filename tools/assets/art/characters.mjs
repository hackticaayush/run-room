// Character sheets: 16x24 frames, 6 columns x 5 rows (96x120 px).
//   row 0 walk_down, row 1 walk_left, row 2 walk_right, row 3 walk_up
//     cols 0-3: stand, step A, stand, step B. col 4: blink / idle alt. col 5: unused (blank).
//   row 4 specials: typing_a, typing_b (seated, from behind), cheer_a, cheer_b, facepalm, sleep.
// Art is drawn as fills only; an auto-outline pass adds the 1px dark outline.

import { Canvas } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

export const FRAME_W = 16;
export const FRAME_H = 24;
export const COLS = 6;
export const ROWS = 5;

// ---------------------------------------------------------------------------------------------
// GHOST: hooded hacker, cyan accents.

const GHOST_LEGEND = {
  W: P.hood3,
  L: P.hood2,
  H: P.hood1,
  h: P.hood0,
  n: P.navy,
  c: P.cyan1,
  C: P.cyan2,
  '*': P.cyan3,
  s: P.skin2,
  S: P.skin1,
  k: P.skin0,
  t: P.skin3,
  p: P.gry0,
  q: P.wall1,
  b: P.gry2,
  B: P.white,
  o: P.outline,
  z: P.wall0,
};

const G_DOWN_TOP = [
  '................',
  '................',
  '.....WLLHHH.....',
  '....WLLHHHHh....',
  '...WLHHHHHHHh...',
  '...LHnnnnnnHh...',
  '...LHnSSSSnHh...',
  '...LHc*C*CcHh...',
  '...LHksssskHh...',
  '...LHksSSskHh...',
  '....HHnnnnHh....',
  '...LLHCHHCHHh...',
  '..LLhHCHHCHhHh..',
  '..LLhH*HH*HhHh..',
  '..LLhHHHHHHhHh..',
  '..LLhhhhhhhhHh..',
  '..LLhHHHHHHhHh..',
  '..sShhHHHHhhsS..',
  '....hhhhhhhh....',
];

const G_UP_TOP = [
  '................',
  '................',
  '.....WLLHHH.....',
  '....WLLHHHHh....',
  '...WLHHHHHHHh...',
  '...LHHHHHHHHh...',
  '...LHHHHHHHHh...',
  '...LHHHHHHHHh...',
  '...LHHHHHHHhh...',
  '...LHHHHHHHHh...',
  '....LHHHHHHh....',
  '...LLHHHHHHHh...',
  '..LLhHHHHHHhHh..',
  '..LLhHHCCHHhHh..',
  '..LLhHCHHCHhHh..',
  '..LLhHHCCHHhHh..',
  '..LLhHHHHHHhHh..',
  '..sShhHHHHhhsS..',
  '....hhhhhhhh....',
];

/** Side view (facing left). arm: 'mid' (standing), 'fwd' or 'back' (walk swing). */
function ghostLeftTop(arm) {
  const sleeve = { mid: '....LHLLhHHh....', fwd: '....LLLhHHHh....', back: '....LHHLLhHh....' }[arm];
  const hand = { mid: '....hhsShhhh....', fwd: '...sShhhhhhh....', back: '....hhhhsShh....' }[arm];
  return [
    '................',
    '................',
    '......WLLHh.....',
    '.....WLLHHHh....',
    '....WLHHHHHHh...',
    '...WLLLHHHHHh...',
    '...LnnnHHHHHHh..',
    '..*CnkHHHHHHHh..',
    '..tsSnHHHHHHHh..',
    '...SknHHHHHHh...',
    '....nLHHHHHh....',
    '....LLHCHHHh....',
    '....LHHHHHHh....',
    sleeve,
    sleeve,
    sleeve,
    sleeve,
    hand,
    '.....hhhhhh.....',
  ];
}

const G_LEFT_TOP = ghostLeftTop('mid');

const G_LEGS = {
  down: {
    stand: ['.....pppppp.....', '.....ppqqpp.....', '.....pp..pp.....', '....Bbb..Bbb....'],
    a: ['.....pppppp.....', '.....ppqqpp.....', '.....pp..Bbb....', '....Bbb.........'],
    b: ['.....pppppp.....', '.....ppqqpp.....', '....Bbb..pp.....', '.........Bbb....'],
  },
  up: {
    stand: ['.....pppppp.....', '.....ppqqpp.....', '.....pp..pp.....', '....bbb..bbb....'],
    a: ['.....pppppp.....', '.....ppqqpp.....', '.....pp..bbb....', '....bbb.........'],
    b: ['.....pppppp.....', '.....ppqqpp.....', '....bbb..pp.....', '.........bbb....'],
  },
  left: {
    stand: ['......pppp......', '......ppqp......', '......ppqp......', '....Bbbbbb......'],
    a: ['......pppp......', '.....pp.qq......', '....pp...qq.....', '..Bbbb...bbb....'],
    b: ['......pppp......', '.....qq.pp......', '....qq...pp.....', '..bbbb...Bbb....'],
  },
};

/** Ghost seated at the desk, seen from behind. Elbows bob up and down by one pixel. */
function ghostTyping(elbow) {
  const leftUp = elbow === 'left';
  return [
    '................',
    '................',
    '................',
    '................',
    leftUp ? '.....WLLHHH.....' : '......WLLHHH....',
    leftUp ? '....WLLHHHHh....' : '.....WLLHHHHh...',
    '...WLHHHHHHHh...',
    '...LHHHHHHHHh...',
    '...LHHHHHHHHh...',
    '...LHHHHHHHhh...',
    '...LHHHHHHHHh...',
    '....LHHHHHHh....',
    '..LLLHHHHHHHhh..',
    leftUp ? '.LLLhHHCCHHhhh..' : '..LLhHHCCHHhhhh.',
    '.LLhhHCHHCHhhhh.',
    leftUp ? '..LhhHHCCHHhhhh.' : '.LLhhHHCCHHhhh..',
    '...hhHHHHHHhh...',
    '....hhhhhhhh....',
  ];
}

function ghostCheer(high) {
  const top = high
    ? [
        '..sS........sS..',
        '..LL........Hh..',
        '..LL.WLLHHH.Hh..',
        '..LLWLLHHHHhHh..',
        '..LLLHHHHHHHHh..',
        '...LHnnnnnnHh...',
        '...LHnSSSSnHh...',
        '...LHc*C*CcHh...',
        '...LHksssskHh...',
        '...LHkSooSkHh...',
        '....HHnnnnHh....',
        '...LLHCHHCHHh...',
        '....hHCHHCHh....',
        '....hHHHHHHh....',
        '....hH*HH*Hh....',
        '....hhhhhhhh....',
        '....hHHHHHHh....',
        '....hhHHHHhh....',
        '....hhhhhhhh....',
      ]
    : [
        '................',
        '.sS..........sS.',
        '.LL..WLLHHH..Hh.',
        '..LLWLLHHHHhHh..',
        '...LLHHHHHHHh...',
        '...LHnnnnnnHh...',
        '...LHnSSSSnHh...',
        '...LHc*C*CcHh...',
        '...LHksssskHh...',
        '...LHksSSskHh...',
        '....HHnnnnHh....',
        '...LLHCHHCHHh...',
        '....hHCHHCHh....',
        '....hHHHHHHh....',
        '....hH*HH*Hh....',
        '....hhhhhhhh....',
        '....hHHHHHHh....',
        '....hhHHHHhh....',
        '....hhhhhhhh....',
      ];
  return top;
}

const G_FACEPALM = [
  '................',
  '................',
  '................',
  '.....WLLHHH.....',
  '....WLLHHHHh....',
  '...WLHHHHHHHh...',
  '...LHnnnnnnHh...',
  '...LHtssSSnHh...',
  '...LHsssSSnHh...',
  '...LHLLssSkHh...',
  '...LLLLnnnHh....',
  '..LLLLCHHCHHh...',
  '..LLhHCHHCHhHh..',
  '...hhHHHHHHhHh..',
  '....hH*HH*HhHh..',
  '....hhhhhhhhHh..',
  '....hHHHHHHhHh..',
  '....hhHHHHhhsS..',
  '....hhhhhhhh....',
];

const G_SLEEP = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......WLLHH.....',
  '.....WLLHHHh....',
  '....WLHHHHHHh...',
  '....LHHHHHHHh...',
  '....LHnnnnnHh...',
  '....LHnzzznHh...',
  '...LLHnnnnnHhh..',
  '..LLhHCHHCHhHh..',
  '..LLhHHHHHHhHh..',
  '..LLhH*HH*HhHh..',
  '..sShhhhhhhhsS..',
  '....hhhhhhhh....',
  '....pppppppp....',
  '...ppppqqpppp...',
  '...Bbb....Bbb...',
];

// ---------------------------------------------------------------------------------------------
// BYTE: small robot intern, yellow accents, antenna and headset.

const BYTE_LEGEND = {
  w: P.white,
  g: P.gry2,
  G: P.gry1,
  d: P.gry0,
  n: P.navy,
  Y: P.yel3,
  y: P.yel2,
  j: P.yel1,
  c: P.cyan2,
  o: P.outline,
  z: P.wall0,
};

const B_DOWN_TOP = [
  '.......Yy.......',
  '.......yj.......',
  '.......dG.......',
  '....yyyyyyyy....',
  '...wwggggggGG...',
  '.YywnnnnnnnnGyj.',
  '.yywnYYnnYYnGyj.',
  '.yywnyynnyynGyj.',
  '.yjwnnnjjnnnGjj.',
  '...wggggggGGGy..',
  '....GGGGGGGG.Y..',
  '.......dd.......',
  '....wwggggGG....',
  '..gGwgyyyygGgG..',
  '..gGwgjjjjgGgG..',
  '..gGwggggggGgG..',
  '..yjGGGGGGGGyj..',
];

const B_UP_TOP = [
  '.......Yy.......',
  '.......yj.......',
  '.......dG.......',
  '....yyyyyyyy....',
  '...wwggggggGG...',
  '.YywggggggggGyj.',
  '.yywggggggggGyj.',
  '.yywgggddgggGyj.',
  '.yjwgggddgggGjj.',
  '...wggggggGGG...',
  '....GGGGGGGG....',
  '.......dd.......',
  '....wwggggGG....',
  '..gGwgjyyjgGgG..',
  '..gGwgyccygGgG..',
  '..gGwgjyyjgGgG..',
  '..yjGGGGGGGGyj..',
];

const B_LEFT_TOP = [
  '........Yy......',
  '........yj......',
  '........dG......',
  '.....yyyyyy.....',
  '....wwgggggG....',
  '...nnnnnggyyG...',
  '...YYnnnggYjG...',
  '...yynnnggyjG...',
  '...nnjnnggjjG...',
  '...yywgggggGG...',
  '..Y.GGGGGGGG....',
  '........dd......',
  '.....wwgggG.....',
  '.....wgyygGG....',
  '.....wgjjgGG....',
  '.....wgggGGG....',
  '......GyjGG.....',
];

const B_LEGS = {
  down: {
    stand: ['.....dd..dd.....', '....yyy..yyy....'],
    a: ['.....dd..yyy....', '....yyy.........'],
    b: ['....yyy..dd.....', '.........yyy....'],
  },
  up: {
    stand: ['.....dd..dd.....', '....jjj..jjj....'],
    a: ['.....dd..jjj....', '....jjj.........'],
    b: ['....jjj..dd.....', '.........jjj....'],
  },
  left: {
    stand: ['......ddd.......', '....yyyyy.......'],
    a: ['.....dd.dd......', '...yyy..jjj.....'],
    b: ['.....dd.dd......', '...jjj..yyy.....'],
  },
};

function byteTyping(armUp) {
  const leftUp = armUp === 'left';
  return [
    '................',
    '................',
    '................',
    '.......Yy.......',
    '.......yj.......',
    '.......dG.......',
    '....yyyyyyyy....',
    '...wwggggggGG...',
    '.YywggggggggGyj.',
    '.yywgggddgggGyj.',
    '.yjwgggddgggGjj.',
    '...wggggggGGG...',
    '....GGGGGGGG....',
    '.......dd.......',
    leftUp ? '.gG.wwggggGG....' : '....wwggggGG.gG.',
    leftUp ? '.gGGwgjyyjgGgG..' : '..gGwgjyyjgGGgG.',
    leftUp ? '..yjwgyccygGgG..' : '..gGwgyccygGyj..',
    '..gGwgjyyjgGyj..',
    '...GGGGGGGGGG...',
  ];
}

function byteCheer(high) {
  return high
    ? [
        '..yj...Yy...yj..',
        '..Gg...yj...gG..',
        '..Gg...dG...gG..',
        '..Ggyyyyyyyygg..',
        '..GwwggggggGGG..',
        '.YywnnnnnnnnGyj.',
        '.yywnnYnnYnnGyj.',
        '.yywnYnYYnYnGyj.',
        '.yjwnnnjjnnnGjj.',
        '...wggggggGGGy..',
        '....GGGGGGGG.Y..',
        '.......dd.......',
        '....wwggggGG....',
        '....wgyyyygG....',
        '....wgjjjjgG....',
        '....wggggggG....',
        '....GGGGGGGG....',
      ]
    : [
        '.......Yy.......',
        '.yj....yj....yj.',
        '.gG....dG....Gg.',
        '..gGyyyyyyyyGg..',
        '...wwggggggGG...',
        '.YywnnnnnnnnGyj.',
        '.yywnnYnnYnnGyj.',
        '.yywnYnYYnYnGyj.',
        '.yjwnnnjjnnnGjj.',
        '...wggggggGGGy..',
        '....GGGGGGGG.Y..',
        '.......dd.......',
        '....wwggggGG....',
        '....wgyyyygG....',
        '....wgjjjjgG....',
        '....wggggggG....',
        '....GGGGGGGG....',
      ];
}

const B_FACEPALM = [
  '.......Yy.......',
  '.......yj.......',
  '.......dG.......',
  '....yyyyyyyy....',
  '...wwggggggGG...',
  '.Yywnnnnnnnngyj.',
  '.yywnyjGGnnnGyj.',
  '.yywnyjgGnnnGyj.',
  '.yjwnnGgGnnnGjj.',
  '...wggGgggGGGy..',
  '....GgGGGGGG.Y..',
  '...gG..dd.......',
  '...gGwwggggGG...',
  '....GwgyyyygGgG.',
  '.....wgjjjjgGgG.',
  '.....wggggggGgG.',
  '.....GGGGGGGGyj.',
];

const B_SLEEP = [
  '................',
  '................',
  '................',
  '................',
  '.......zd.......',
  '.......dG.......',
  '....jjjjjjjj....',
  '...wwggggggGG...',
  '.jjwnnnnnnnnGjj.',
  '.jjwnnnnnnnnGjj.',
  '.jjwnjjnnjjnGjj.',
  '.jjwnnnnnnnnGjj.',
  '...wggggggGGG...',
  '....GGGGGGGG....',
  '.......dd.......',
  '..gGwwggggGGgG..',
  '..gGwgjjjjgGgG..',
  '..jjGGGGGGGGjj..',
  '....dd....dd....',
  '...jjj....jjj...',
];

// ---------------------------------------------------------------------------------------------

/** Draws rows into a fresh 16x24 frame, outlines it and bottom-aligns it so feet touch row 22. */
function frame(rows, legend, { bob = 0, align = true } = {}) {
  const c = new Canvas(FRAME_W, FRAME_H);
  c.ascii(rows, legend);
  let out = c;
  if (align) {
    const b = c.bounds();
    if (b) out = c.shifted(0, FRAME_H - 2 - (b.y + b.h - 1) - bob);
  }
  out.outline(P.outline);
  return out;
}

/** Mirrors a left facing frame and swaps lit / shaded ramps so the light stays top-left. */
function mirrorLit(canvas, swaps) {
  return canvas.mirrorH().recolor(swaps);
}

/**
 * One walk row: stand, step A, stand, step B, blink, blank.
 * tops is either one set of upper body rows or { stand, a, b } for arm swing.
 */
function walkRows(tops, legs, legend, blinkTop, { bob = false } = {}) {
  const t = Array.isArray(tops) ? { stand: tops, a: tops, b: tops } : tops;
  const make = (top, legRows, b = 0) => frame([...top, ...legRows], legend, { bob: b });
  return [
    make(t.stand, legs.stand),
    make(t.a, legs.a, bob ? 1 : 0),
    make(t.stand, legs.stand),
    make(t.b, legs.b, bob ? 1 : 0),
    blinkTop ? frame([...blinkTop, ...legs.stand], legend) : make(t.stand, legs.stand),
    new Canvas(FRAME_W, FRAME_H),
  ];
}

function blinkGhost(top) {
  // Visor dims for a frame (reads as a blink).
  return top.map((r) => r.replace('c*C*Cc', 'cCcCcc'));
}

function blinkByte(top) {
  return top.map((r) => r.replace('nYYnnYYn', 'nnnnnnnn').replace('nyynnyyn', 'njjnnjjn'));
}

function seatedFrame(rows, legend) {
  // Seated frames keep their authored vertical position (the chair covers the lower body).
  const c = new Canvas(FRAME_W, FRAME_H);
  c.ascii(rows, legend, 0, FRAME_H - 2 - rows.length + 1);
  c.outline(P.outline);
  return c;
}

export function buildGhost() {
  const L = GHOST_LEGEND;
  const down = walkRows(G_DOWN_TOP, G_LEGS.down, L, blinkGhost(G_DOWN_TOP));
  const left = walkRows(
    { stand: G_LEFT_TOP, a: ghostLeftTop('fwd'), b: ghostLeftTop('back') },
    G_LEGS.left,
    L,
    G_LEFT_TOP.map((r) => r.replace('*C', 'cC')),
  );
  const swaps = { [P.hood2]: P.hood0, [P.hood0]: P.hood2, [P.hood3]: P.hood1 };
  const right = left.map((f) => mirrorLit(f, swaps));
  const up = walkRows(G_UP_TOP, G_LEGS.up, L, null);
  const special = [
    seatedFrame(ghostTyping('left'), L),
    seatedFrame(ghostTyping('right'), L),
    frame([...ghostCheer(false), ...G_LEGS.down.stand], L),
    frame([...ghostCheer(true), ...G_LEGS.down.stand], L, { bob: 1 }),
    frame([...G_FACEPALM, ...G_LEGS.down.stand], L),
    frame(G_SLEEP, L),
  ];
  return [down, left, right, up, special];
}

export function buildByte() {
  const L = BYTE_LEGEND;
  const down = walkRows(B_DOWN_TOP, B_LEGS.down, L, blinkByte(B_DOWN_TOP), { bob: true });
  const left = walkRows(B_LEFT_TOP, B_LEGS.left, L, B_LEFT_TOP.map((r) => r.replace('YY', 'jj').replace('yy', 'jj')), { bob: true });
  const swaps = { [P.white]: P.gry1, [P.gry1]: P.white };
  const right = left.map((f) => mirrorLit(f, swaps));
  const up = walkRows(B_UP_TOP, B_LEGS.up, L, null, { bob: true });
  const special = [
    seatedFrame(byteTyping('left'), L),
    seatedFrame(byteTyping('right'), L),
    frame([...byteCheer(false), ...B_LEGS.down.stand], L),
    frame([...byteCheer(true), ...B_LEGS.down.stand], L, { bob: 1 }),
    frame([...B_FACEPALM, ...B_LEGS.down.stand], L),
    frame(B_SLEEP, L),
  ];
  return [down, left, right, up, special];
}

/** Assembles a 96x120 sheet from rows of frames. */
export function sheetFromRows(rows) {
  const sheet = new Canvas(COLS * FRAME_W, ROWS * FRAME_H);
  rows.forEach((row, r) => row.forEach((f, c) => sheet.blit(f, c * FRAME_W, r * FRAME_H)));
  return sheet;
}

/** characters.json: frame size, row meaning and named animations (frame indices into the sheet). */
export function charactersJson() {
  const idx = (row, col) => row * COLS + col;
  const walk = (row) => [idx(row, 0), idx(row, 1), idx(row, 2), idx(row, 3)];
  return {
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    columns: COLS,
    rows: ROWS,
    sheetWidth: COLS * FRAME_W,
    sheetHeight: ROWS * FRAME_H,
    rowNames: ['walk_down', 'walk_left', 'walk_right', 'walk_up', 'special'],
    specialColumns: ['typing_a', 'typing_b', 'cheer_a', 'cheer_b', 'facepalm', 'sleep'],
    anchor: { x: 0.5, y: 23 / 24 },
    animations: {
      walk_down: { frames: walk(0), fps: 8, repeat: -1 },
      walk_left: { frames: walk(1), fps: 8, repeat: -1 },
      walk_right: { frames: walk(2), fps: 8, repeat: -1 },
      walk_up: { frames: walk(3), fps: 8, repeat: -1 },
      // A short blink (one frame) every ~2.5 s.
      idle_down: { frames: [...Array(15).fill(idx(0, 0)), idx(0, 4)], fps: 6, repeat: -1 },
      idle_left: { frames: [...Array(15).fill(idx(1, 0)), idx(1, 4)], fps: 6, repeat: -1 },
      idle_right: { frames: [...Array(15).fill(idx(2, 0)), idx(2, 4)], fps: 6, repeat: -1 },
      idle_up: { frames: [idx(3, 0)], fps: 1, repeat: -1 },
      typing: { frames: [idx(4, 0), idx(4, 1)], fps: 6, repeat: -1 },
      // Sitting still at the PC (reading the brief or a file): the first typing frame, held.
      seated: { frames: [idx(4, 0)], fps: 1, repeat: -1 },
      cheer: { frames: [idx(4, 2), idx(4, 3)], fps: 5, repeat: -1 },
      facepalm: { frames: [idx(4, 4)], fps: 1, repeat: -1 },
      sleep: { frames: [idx(4, 5)], fps: 1, repeat: -1 },
    },
    characters: {
      ghost: { image: 'ghost.png', name: 'GHOST', role: 'HACKER' },
      byte: { image: 'byte.png', name: 'BYTE', role: 'ASSISTANT' },
    },
  };
}
