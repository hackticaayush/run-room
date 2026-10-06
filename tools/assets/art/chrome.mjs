// UI chrome as 9-slice sprites. Hard 1px pixel borders, chamfered (never rounded) corners,
// neon cyan / magenta accents, dark navy fill. Each entry documents its slice margins.

import { Canvas } from '../lib/canvas.mjs';
import { P } from '../lib/palette.mjs';

function chamfer(c) {
  // Knock out the four corner pixels for a hard pixel-art corner.
  c.px(0, 0, null);
  c.px(c.w - 1, 0, null);
  c.px(0, c.h - 1, null);
  c.px(c.w - 1, c.h - 1, null);
}

function corners(c, color, len = 3, inset = 1) {
  const r = c.w - 1 - inset;
  const b = c.h - 1 - inset;
  c.hline(inset, inset + len - 1, inset, color);
  c.vline(inset, inset, inset + len - 1, color);
  c.hline(r - len + 1, r, inset, color);
  c.vline(r, inset, inset + len - 1, color);
  c.hline(inset, inset + len - 1, b, color);
  c.vline(inset, b - len + 1, b, color);
  c.hline(r - len + 1, r, b, color);
  c.vline(r, b - len + 1, b, color);
}

function panelFrame() {
  const c = new Canvas(16, 16);
  c.rect(0, 0, 16, 16, P.navy);
  c.strokeRect(0, 0, 16, 16, P.outline);
  c.strokeRect(1, 1, 14, 14, P.cyan1);
  c.strokeRect(2, 2, 12, 12, P.wall1);
  corners(c, P.cyan2, 3, 1);
  chamfer(c);
  return { canvas: c, slice: 5 };
}

function modalFrame() {
  const c = new Canvas(24, 24);
  c.rect(0, 0, 24, 24, P.navy);
  c.strokeRect(0, 0, 24, 24, P.outline);
  c.strokeRect(1, 1, 22, 22, P.mag1);
  c.strokeRect(2, 2, 20, 20, P.outline);
  c.strokeRect(3, 3, 18, 18, P.cyan1);
  c.strokeRect(4, 4, 16, 16, P.wall1);
  corners(c, P.mag2, 4, 1);
  corners(c, P.cyan2, 2, 3);
  chamfer(c);
  return { canvas: c, slice: 7 };
}

function button(state) {
  const c = new Canvas(16, 16);
  const s = {
    up: { face: P.wall2, light: P.wall4, dark: P.wall0, accent: P.cyan1, border: P.outline },
    hover: { face: P.wall3, light: P.cyan3, dark: P.wall1, accent: P.cyan2, border: P.cyan2 },
    down: { face: P.wall1, light: P.wall0, dark: P.wall3, accent: P.cyan2, border: P.cyan1 },
    disabled: { face: P.gry0, light: P.gry0, dark: P.wall1, accent: P.wall1, border: P.outline },
  }[state];
  c.rect(0, 0, 16, 16, s.face);
  c.strokeRect(0, 0, 16, 16, s.border);
  c.hline(1, 14, 1, s.light);
  c.vline(1, 1, 13, s.light);
  c.hline(1, 14, 13, s.dark);
  c.vline(14, 1, 13, s.dark);
  c.hline(1, 14, 14, s.accent);
  chamfer(c);
  return { canvas: c, slice: 4 };
}

function inputFrame() {
  const c = new Canvas(12, 12);
  c.rect(0, 0, 12, 12, P.navy);
  c.strokeRect(0, 0, 12, 12, P.outline);
  c.hline(1, 10, 1, P.wall0);
  c.vline(1, 1, 10, P.wall0);
  c.hline(1, 10, 10, P.cyan1);
  c.vline(10, 1, 10, P.wall2);
  chamfer(c);
  return { canvas: c, slice: 3 };
}

function progressEmpty() {
  const c = new Canvas(10, 10);
  c.rect(0, 0, 10, 10, P.navy);
  c.strokeRect(0, 0, 10, 10, P.outline);
  c.strokeRect(1, 1, 8, 8, P.wall2);
  c.hline(2, 7, 2, P.outline);
  chamfer(c);
  return { canvas: c, slice: 3 };
}

function progressFill() {
  const c = new Canvas(6, 6);
  c.rect(0, 0, 6, 6, P.cyan2);
  c.hline(0, 5, 0, P.cyan3);
  c.hline(0, 5, 5, P.cyan1);
  c.vline(0, 0, 5, P.cyan1);
  c.vline(5, 0, 5, P.cyan1);
  return { canvas: c, slice: 1 };
}

function tab(active) {
  const c = new Canvas(16, 16);
  if (active) {
    c.rect(0, 0, 16, 16, P.navy);
    c.vline(0, 0, 15, P.outline);
    c.vline(15, 0, 15, P.outline);
    c.hline(0, 15, 0, P.outline);
    c.hline(1, 14, 1, P.cyan2);
    c.vline(1, 1, 15, P.cyan2);
    c.vline(14, 1, 15, P.cyan2);
    c.hline(2, 13, 2, P.cyan0);
    c.px(0, 0, null);
    c.px(15, 0, null);
  } else {
    c.rect(0, 0, 16, 16, P.wall0);
    c.strokeRect(0, 0, 16, 16, P.outline);
    c.hline(1, 14, 1, P.wall2);
    c.vline(1, 1, 13, P.wall2);
    c.vline(14, 1, 13, P.wall1);
    c.hline(0, 15, 14, P.cyan1);
    c.hline(0, 15, 15, P.outline);
    c.px(0, 0, null);
    c.px(15, 0, null);
  }
  return { canvas: c, slice: 4 };
}

function tooltipFrame() {
  const c = new Canvas(10, 10);
  c.rect(0, 0, 10, 10, P.navy);
  c.strokeRect(0, 0, 10, 10, P.outline);
  c.strokeRect(1, 1, 8, 8, P.yel1);
  chamfer(c);
  return { canvas: c, slice: 3 };
}

function scrollThumb() {
  const c = new Canvas(8, 12);
  c.rect(0, 0, 8, 12, P.cyan1);
  c.strokeRect(0, 0, 8, 12, P.outline);
  c.vline(1, 1, 10, P.cyan2);
  c.hline(1, 6, 1, P.cyan3);
  c.vline(6, 1, 10, P.cyan0);
  c.hline(1, 6, 10, P.cyan0);
  chamfer(c);
  return { canvas: c, slice: 3 };
}

function scrollTrack() {
  const c = new Canvas(8, 12);
  c.rect(0, 0, 8, 12, P.wall0);
  c.strokeRect(0, 0, 8, 12, P.outline);
  c.vline(3, 2, 9, P.navy);
  c.vline(4, 2, 9, P.navy);
  return { canvas: c, slice: 3 };
}

function checkbox(on) {
  const c = new Canvas(12, 12);
  c.rect(0, 0, 12, 12, P.navy);
  c.strokeRect(0, 0, 12, 12, P.outline);
  c.hline(1, 10, 1, P.wall3);
  c.vline(1, 1, 10, P.wall3);
  c.hline(1, 10, 10, P.wall1);
  c.vline(10, 1, 10, P.wall1);
  if (on) {
    const pts = [
      [3, 6],
      [4, 7],
      [5, 8],
      [6, 7],
      [7, 6],
      [8, 5],
      [8, 4],
      [3, 5],
      [4, 6],
      [5, 7],
      [6, 6],
      [7, 5],
    ];
    for (const [x, y] of pts) c.px(x, y, P.grn2);
    c.px(8, 3, P.grn3);
  }
  chamfer(c);
  return { canvas: c, slice: 4 };
}

function bubble(thought) {
  const c = new Canvas(12, 12);
  c.rect(1, 1, 10, 10, P.white);
  c.strokeRect(0, 0, 12, 12, P.outline);
  if (thought) {
    // Softer two-pixel chamfer and a gray inner rim.
    c.px(1, 1, P.outline);
    c.px(10, 1, P.outline);
    c.px(1, 10, P.outline);
    c.px(10, 10, P.outline);
    c.hline(2, 9, 10, P.gry2);
  } else {
    c.hline(1, 10, 10, P.gry2);
  }
  chamfer(c);
  return { canvas: c, slice: 4 };
}

export function buildChrome() {
  const items = {
    panel_frame: panelFrame(),
    button_up: button('up'),
    button_down: button('down'),
    button_hover: button('hover'),
    button_disabled: button('disabled'),
    input_frame: inputFrame(),
    progress_bar_empty: progressEmpty(),
    progress_bar_fill: progressFill(),
    tab_active: tab(true),
    tab_inactive: tab(false),
    modal_frame: modalFrame(),
    tooltip_frame: tooltipFrame(),
    scroll_thumb: scrollThumb(),
    scroll_track: scrollTrack(),
    checkbox_off: checkbox(false),
    checkbox_on: checkbox(true),
    bubble_speech: bubble(false),
    bubble_thought: bubble(true),
  };
  return Object.entries(items).map(([name, { canvas, slice }]) => ({
    name,
    canvas,
    slice: { top: slice, right: slice, bottom: slice, left: slice },
  }));
}
