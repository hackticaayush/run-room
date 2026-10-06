// 32x32 portraits for the roster cards. Built from shapes (ellipses and rects), then outlined
// and placed on a small scanline backdrop.

import { Canvas } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

function backdrop(tint) {
  const c = new Canvas(32, 32);
  c.rect(0, 0, 32, 32, P.navy);
  for (let y = 1; y < 32; y += 3) for (let x = 0; x < 32; x += 2) c.px(x + (y % 2), y, tint);
  return c;
}

function ghostFigure() {
  const f = new Canvas(32, 32);
  // Shoulders.
  f.fillEllipse(16, 35, 15, 11, P.hood1);
  f.fillEllipse(11, 31, 6, 5, P.hood2);
  f.fillEllipse(23, 33, 6, 5, P.hood0);
  // Hood.
  f.fillEllipse(16, 14, 10.5, 12, P.hood1);
  f.fillEllipse(13.5, 10, 6, 6.5, P.hood2);
  f.fillEllipse(19, 16, 8, 9, P.hood1);
  // Rim light on the left of the hood.
  for (let y = 4; y < 22; y++) {
    for (let x = 0; x < 32; x++) {
      if (Canvas.inEllipse(x, y, 16, 14, 10.5, 12) && !Canvas.inEllipse(x - 1, y, 16, 14, 10.5, 12)) {
        f.px(x, y, P.hood3);
        break;
      }
    }
  }
  // Hood opening and face.
  f.fillEllipse(16, 16.5, 6.5, 8, P.navy);
  f.fillEllipse(16, 18, 5, 6.5, P.skin2);
  f.hline(12, 20, 12, P.skin0);
  f.hline(11, 21, 13, P.skin1);
  f.px(11, 17, P.skin1);
  f.px(21, 17, P.skin1);
  // Visor with glints.
  f.rect(11, 14, 11, 3, P.cyan2);
  f.hline(11, 21, 16, P.cyan1);
  f.px(13, 14, P.cyan3);
  f.px(14, 14, P.cyan3);
  f.px(18, 14, P.cyan3);
  f.px(19, 14, P.cyan3);
  // Nose shadow and mouth.
  f.px(16, 19, P.skin1);
  f.hline(15, 18, 21, P.skin1);
  f.hline(13, 19, 23, P.skin1);
  // Drawstrings.
  f.vline(13, 25, 29, P.cyan2);
  f.vline(19, 25, 29, P.cyan2);
  f.px(13, 30, P.cyan3);
  f.px(19, 30, P.cyan3);
  f.outline(P.outline);
  return f;
}

function byteFigure() {
  const f = new Canvas(32, 32);
  // Body top (shoulders) at the bottom of the frame.
  f.rect(7, 27, 18, 5, P.gry2);
  f.hline(7, 24, 27, P.white);
  f.rect(12, 28, 8, 2, P.yel2);
  // Neck.
  f.rect(14, 24, 4, 3, P.gry0);
  // Head: rounded box.
  f.rect(5, 7, 22, 17, P.gry2);
  f.hline(6, 25, 6, P.gry2);
  f.hline(6, 25, 24, P.gry1);
  f.vline(5, 7, 23, P.white);
  f.hline(6, 25, 7, P.white);
  f.vline(26, 7, 23, P.gry1);
  f.rect(6, 22, 20, 2, P.gry1);
  // Visor with eyes.
  f.rect(8, 10, 16, 10, P.navy);
  f.hline(8, 23, 10, P.wall1);
  f.rect(11, 13, 3, 3, P.yel2);
  f.rect(18, 13, 3, 3, P.yel2);
  f.px(11, 13, P.yel3);
  f.px(18, 13, P.yel3);
  f.hline(14, 17, 18, P.yel1);
  // Headset: band and ear cups, mic boom.
  f.hline(6, 25, 5, P.yel2);
  f.hline(7, 24, 4, P.yel1);
  f.rect(2, 11, 3, 8, P.yel2);
  f.vline(2, 11, 18, P.yel3);
  f.rect(27, 11, 3, 8, P.yel1);
  f.vline(27, 11, 18, P.yel2);
  f.line(28, 19, 24, 23, P.yel2);
  f.rect(22, 22, 2, 2, P.yel3);
  // Antenna.
  f.vline(16, 1, 3, P.gry1);
  f.rect(15, 0, 3, 2, P.yel2);
  f.px(15, 0, P.yel3);
  f.outline(P.outline);
  return f;
}

export function buildPortraits() {
  const ghost = backdrop(P.cyan0);
  ghost.blit(ghostFigure(), 0, 0);
  const byte = backdrop(P.yel0);
  byte.blit(byteFigure(), 0, 0);
  return [
    { name: 'portrait_ghost', canvas: ghost },
    { name: 'portrait_byte', canvas: byte },
  ];
}
