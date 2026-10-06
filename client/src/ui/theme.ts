// Installs manifest driven CSS variables (chrome images, slice sizes, cursors) and offers
// helpers to build 9-slice styles. Every asset URL here comes from assets/manifest.ts.

import type { CSSProperties } from 'react';
import { CHROME, CURSORS, assetUrl, type ChromeName } from '../assets/manifest';

/** Default HUD scale: one sprite pixel = 2 CSS pixels. Always an integer. */
export const UI_SCALE = 2;

let installed = false;

export function installTheme(root: HTMLElement = document.documentElement): void {
  if (installed) return;
  installed = true;
  for (const [name, c] of Object.entries(CHROME)) {
    root.style.setProperty(`--chrome-${name}`, `url("${assetUrl(c.image)}")`);
    root.style.setProperty(`--slice-${name}`, String(c.slice.top));
  }
  const a = CURSORS.arrow;
  const h = CURSORS.hand;
  root.style.setProperty('--cursor-arrow', `url("${assetUrl(a.image)}") ${a.hotX} ${a.hotY}, default`);
  root.style.setProperty('--cursor-hand', `url("${assetUrl(h.image)}") ${h.hotX} ${h.hotY}, pointer`);
}

/** Inline 9-slice style for a chrome image at an integer scale. */
export function chromeStyle(name: ChromeName, scale: number = UI_SCALE): CSSProperties {
  const c = CHROME[name];
  const s = c.slice;
  const widths = `${s.top * scale}px ${s.right * scale}px ${s.bottom * scale}px ${s.left * scale}px`;
  return {
    borderStyle: 'solid',
    borderWidth: widths,
    borderImageSource: `url("${assetUrl(c.image)}")`,
    borderImageSlice: `${s.top} ${s.right} ${s.bottom} ${s.left} fill`,
    borderImageWidth: widths,
    borderImageRepeat: 'stretch',
    imageRendering: 'pixelated',
  };
}

/** Plain (non 9-slice) image of a chrome entry, e.g. the checkbox sprites. */
export function chromeImage(name: ChromeName, scale: number = UI_SCALE): CSSProperties {
  const c = CHROME[name];
  return {
    width: c.width * scale,
    height: c.height * scale,
    backgroundImage: `url("${assetUrl(c.image)}")`,
    backgroundSize: `${c.width * scale}px ${c.height * scale}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    display: 'inline-block',
    flex: 'none',
  };
}
