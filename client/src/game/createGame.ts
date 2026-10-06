import Phaser from 'phaser';
import { MAP_H, MAP_W } from '@shared/officeLayout';
import { TILE } from '@shared/constants';
import { BootScene } from './BootScene';
import { OfficeScene } from './OfficeScene';
import { watchTaps } from './tap';

export const BASE_W = MAP_W * TILE;
export const BASE_H = MAP_H * TILE;

/** Largest integer zoom that fits the available box (never fractional, never below 1). */
export function integerZoom(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / BASE_W, height / BASE_H)));
}

/**
 * Zoom for narrow screens and phones, in CSS pixels per art pixel: the largest WHOLE number of
 * DEVICE pixels per art pixel that fits. A phone (390 CSS px wide, 3 device px per CSS px) shows
 * the office at 2 device px per art pixel (341 CSS px): crisp, still integer scaling on screen.
 */
export function deviceZoom(width: number, height: number, dpr: number): number {
  const ratio = dpr > 0 ? dpr : 1;
  const k = Math.max(1, Math.floor(Math.min((width * ratio) / BASE_W, (height * ratio) / BASE_H)));
  return k / ratio;
}

export function createGame(parent: HTMLElement, zoom: number): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: BASE_W,
    height: BASE_H,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    backgroundColor: '#0b0f1a',
    banner: false,
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.NONE, zoom },
    render: { pixelArt: true, roundPixels: true, antialias: false, antialiasGL: false, powerPreference: 'low-power' },
    // The office never scrolls or zooms itself, so the mouse wheel and touch swipes over it go to
    // the page (Phaser would cancel them by default and the page could not scroll over the office).
    // Clicks are taps checked by watchTaps.
    input: { mouse: { preventDefaultWheel: false }, touch: { capture: false } },
    scene: [BootScene, OfficeScene],
  });
  const stopTaps = watchTaps(game, parent);
  game.events.once(Phaser.Core.Events.DESTROY, stopTaps);
  return game;
}
