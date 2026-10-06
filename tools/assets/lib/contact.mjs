// Contact sheets: every sprite upscaled (default 4x) with its name drawn in the built-in pixel font.
// They exist so a human (or Claude) can eyeball the whole art set quickly.

import { Canvas } from './canvas.mjs';
import { P } from './palette.mjs';
import { FONT5, drawText, textWidth } from './font.mjs';

function checker(canvas, x, y, w, h, cell) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dark = (Math.floor(i / cell) + Math.floor(j / cell)) % 2 === 0;
      canvas.px(x + i, y + j, dark ? P.floor0 : P.floor1);
    }
  }
}

/**
 * entries: [{ name, canvas, group? }]. Groups start on a new row with a heading.
 */
export function contactSheet(entries, { title, scale = 4, labelScale = 2, maxWidth = 1600, pad = 10 } = {}) {
  const labelH = FONT5.h * labelScale;
  const cells = entries.map((e) => {
    const sw = e.canvas.w * scale;
    const sh = e.canvas.h * scale;
    const lw = textWidth(e.name, FONT5, labelScale);
    return { e, sw, sh, w: Math.max(sw, lw) + pad, h: sh + labelH + pad + 6 };
  });

  // Layout pass.
  const titleH = title ? FONT5.h * 3 + 16 : 0;
  let x = pad;
  let y = pad + titleH;
  let rowH = 0;
  let group = null;
  const layout = [];
  const headings = [];
  for (const c of cells) {
    const g = c.e.group ?? null;
    if (g !== group) {
      if (x > pad) {
        y += rowH + pad;
        x = pad;
        rowH = 0;
      }
      if (g) {
        headings.push({ text: g, y });
        y += labelH + 8;
      }
      group = g;
    }
    if (x + c.w > maxWidth - pad && x > pad) {
      y += rowH + pad;
      x = pad;
      rowH = 0;
    }
    layout.push({ c, x, y });
    x += c.w + pad;
    rowH = Math.max(rowH, c.h);
  }
  const height = y + rowH + pad;
  const width = maxWidth;

  const sheet = new Canvas(width, height);
  sheet.rect(0, 0, width, height, P.navy);
  if (title) drawText(sheet, title, pad, pad, P.cyan2, FONT5, 3);
  for (const h of headings) drawText(sheet, h.text, pad, h.y, P.mag2, FONT5, labelScale);
  for (const { c, x: cx, y: cy } of layout) {
    checker(sheet, cx, cy, c.sw, c.sh, scale * 2);
    sheet.blit(c.e.canvas.scaled(scale), cx, cy, { blend: true });
    sheet.strokeRect(cx - 1, cy - 1, c.sw + 2, c.sh + 2, P.wall2);
    drawText(sheet, c.e.name, cx, cy + c.sh + 5, P.white, FONT5, labelScale);
  }
  return sheet;
}
