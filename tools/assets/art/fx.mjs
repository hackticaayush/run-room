// FX atlas: 8x8 effect sprites (unless noted), animation frames named name_0, name_1, ...

import { Canvas, fromAscii } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

function heart() {
  return fromAscii(
    ['........', '.hh.hh..', 'hHHhHHh.', 'hHwHHHh.', 'hHHHHHh.', '.hHHHh..', '..hHh...', '...h....'],
    { h: P.red1, H: P.red2, w: P.red3 },
  );
}

function zz() {
  const c = fromAscii(['........', '.WWWWW..', '....W...', '...W....', '..W.....', '.WWWWW..', '........', '........'], {
    W: P.cyan3,
  });
  c.outline(P.outline);
  return c;
}

function exclaim() {
  const c = fromAscii(['...yy...', '...yy...', '...yy...', '...yy...', '...jj...', '........', '...yy...', '........'], {
    y: P.yel2,
    j: P.yel1,
  });
  c.outline(P.outline);
  return c;
}

function spark() {
  return fromAscii(['....Y...', '....Y...', '...YWY..', 'YYYWWWYY', '...YWY..', '....Y...', '....Y...', '........'], {
    Y: P.yel2,
    W: P.white,
  });
}

function packet(frameIndex) {
  const rows = frameIndex
    ? ['..qqqq..', '.qcCCcq.', 'qcC**Ccq', 'qC****Cq', 'qC****Cq', 'qcC**Ccq', '.qcCCcq.', '..qqqq..']
    : ['........', '...cc...', '..cCCc..', '.cC**Cc.', '.cC**Cc.', '..cCCc..', '...cc...', '........'];
  return fromAscii(rows, { q: P.cyan0, c: P.cyan1, C: P.cyan2, '*': P.cyan3 });
}

function smoke(frameIndex) {
  const frames = [
    ['........', '........', '........', '........', '...gg...', '..gGGg..', '..gGGg..', '...gg...'],
    ['........', '........', '..gGg...', '.gGHHg..', '.gGHHGg.', '..gGGg..', '...gg...', '........'],
    ['..g.g...', '.g.H.g..', 'g.H.H.g.', '.g.G.g..', 'g...g...', '.g.g....', '........', '........'],
  ];
  return fromAscii(frames[frameIndex], { g: P.gry1, G: P.gry2, H: P.white });
}

function siren(frameIndex) {
  const on = ['r..rr..r', '.r.RR.r.', '..RWWR..', '.RRWWRR.', '.RRRRRR.', 'dddddddd', '.dddddd.', '........'];
  const off = ['........', '........', '..rrrr..', '.rRrrrr.', '.rrrrrr.', 'dddddddd', '.dddddd.', '........'];
  return fromAscii(frameIndex ? off : on, { r: P.red1, R: P.red2, W: P.red3, d: P.gry0 });
}

function coinXp() {
  return fromAscii(['..jjjj..', '.jYYYYj.', 'jYWYYYyj', 'jYYyyYyj', 'jYYyyYyj', 'jYYYYyyj', '.jyyyyj.', '..jjjj..'], {
    j: P.yel1,
    Y: P.yel2,
    W: P.white,
    y: P.yel1,
  });
}

function confetti(color, shade, variant) {
  const shapes = [
    ['........', '........', '...XX...', '..XXx...', '...x....', '........', '........', '........'],
    ['........', '........', '..X.....', '..XX....', '...Xx...', '....x...', '........', '........'],
    ['........', '........', '........', '..XXXx..', '........', '........', '........', '........'],
    ['........', '........', '....X...', '...Xx...', '...X....', '..x.....', '........', '........'],
  ];
  return fromAscii(shapes[variant], { X: color, x: shade });
}

function matrix(frameIndex) {
  const c = new Canvas(8, 8);
  const heads = [0, 5, 2, 7, 3, 6, 1, 4];
  for (let col = 0; col < 8; col += 2) {
    const head = (heads[col] + frameIndex * 2) % 8;
    for (let t = 0; t < 4; t++) {
      const y = (head - t + 8) % 8;
      c.px(col, y, t === 0 ? P.grn3 : t === 1 ? P.grn2 : P.grn1);
    }
  }
  return c;
}

function fileSprite() {
  const c = fromAscii(['.WWWW...', '.WggWW..', '.WWWWWW.', '.WggggW.', '.WWWWWW.', '.WCCggW.', '.WWWWWW.', '........'], {
    W: P.white,
    g: P.gry1,
    C: P.cyan1,
  });
  c.outline(P.outline);
  return c;
}

function dustPuff(frameIndex) {
  const rows = frameIndex
    ? ['........', '........', '........', '.h....h.', 'h.h..h.h', '.h....h.', '........', '........']
    : ['........', '........', '........', '........', '..hHHh..', '.hHHHHh.', '..hhhh..', '........'];
  return fromAscii(rows, { h: P.gry1, H: P.gry2 });
}

function mailDrop() {
  const c = fromAscii(['........', 'WWWWWWW.', 'WgWWWgW.', 'WWgWgWW.', 'WWWgWWW.', 'WWWWWWW.', '........', '........'], {
    W: P.white,
    g: P.gry1,
  });
  c.outline(P.outline);
  return c;
}

function coffeeCup() {
  const c = fromAscii(['..s.s...', '.s.s....', '.WWWWW..', '.WbbbWW.', '.WWWWW.W', '.WWWWWW.', '..WWW...', '........'], {
    s: P.gry2,
    W: P.white,
    b: P.brn2,
  });
  return c;
}

function shadow() {
  const c = new Canvas(12, 5);
  c.fillEllipse(6, 2.5, 6, 2.5, P.shadow);
  return c;
}

function bubbleTailSpeech() {
  // Points down; drawn under a speech bubble.
  return fromAscii(['oWWWWo', '.oWWo.', '..oo..'], { o: P.outline, W: P.white });
}

function bubbleTailThought() {
  return fromAscii(['.oo...', 'oWWo..', '.oo...', '....o.', '...oWo', '....o.'], { o: P.outline, W: P.white });
}

export function buildFx() {
  const fx = [];
  const add = (name, canvas) => fx.push({ name, canvas });
  add('heart', heart());
  add('z', zz());
  add('exclaim', exclaim());
  add('spark', spark());
  for (let i = 0; i < 2; i++) add(`packet_${i}`, packet(i));
  for (let i = 0; i < 3; i++) add(`smoke_${i}`, smoke(i));
  for (let i = 0; i < 2; i++) add(`siren_${i}`, siren(i));
  add('coin_xp', coinXp());
  add('confetti_0', confetti(P.cyan2, P.cyan1, 0));
  add('confetti_1', confetti(P.mag2, P.mag1, 1));
  add('confetti_2', confetti(P.yel2, P.yel1, 2));
  add('confetti_3', confetti(P.grn2, P.grn1, 3));
  for (let i = 0; i < 4; i++) add(`matrix_${i}`, matrix(i));
  add('file_sprite', fileSprite());
  for (let i = 0; i < 2; i++) add(`dust_puff_${i}`, dustPuff(i));
  add('mail_drop', mailDrop());
  add('coffee_cup', coffeeCup());
  add('shadow', shadow());
  add('bubble_tail_speech', bubbleTailSpeech());
  add('bubble_tail_thought', bubbleTailThought());
  return fx;
}
