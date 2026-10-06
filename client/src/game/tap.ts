// Clicks on the office canvas. The canvas does not swallow the mouse wheel or touch swipes (they
// scroll the page, see createGame), so a press only counts as a click when it is a real tap: it
// starts on the canvas, ends where it started, the browser did not take it over to scroll, and
// the page was not still gliding from a fling when it began. A finger that starts a swipe on
// Ghost scrolls the page instead of opening his card.

import type Phaser from 'phaser';

/** How far (CSS px) a press may move and still count as a tap. */
const TAP_SLOP_PX = 10;
/** A press this soon (ms) after the page scrolled only stops the glide; it is not a tap. */
const GLIDE_MS = 120;

let start: { x: number; y: number } | null = null;
let armed = false;
let lastPageScroll = -Infinity;

/**
 * True when the press that just ended was a tap. A click handler calls it once per release; it
 * also disarms, so the mouse events a browser emulates after a touch tap cannot click twice.
 */
export function takeTap(): boolean {
  const ok = armed;
  armed = false;
  return ok;
}

/**
 * Watches presses on the game canvas (inside `host`) and keeps Phaser's idea of where the canvas
 * is on the page up to date while the page scrolls, so pointer positions stay right. Phaser itself
 * only refreshes it on window resize and on a slow timer. Returns a function that stops watching.
 */
export function watchTaps(game: Phaser.Game, host: HTMLElement): () => void {
  const opts = { capture: true, passive: true } as const;
  const down = (e: PointerEvent) => {
    start = { x: e.clientX, y: e.clientY };
    armed = e.target instanceof Node && host.contains(e.target) && performance.now() - lastPageScroll > GLIDE_MS;
  };
  const move = (e: PointerEvent) => {
    if (armed && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) armed = false;
  };
  // The browser fires pointercancel when it takes a touch over to scroll or zoom.
  const cancel = () => {
    armed = false;
  };
  let frame = 0;
  const scrolled = (e: Event) => {
    // Only scrolling that moves the canvas counts (the page), not a panel such as the terminal.
    const target = e.target;
    if (target !== document && !(target instanceof Node && target.contains(host))) return;
    lastPageScroll = performance.now();
    armed = false;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      game.scale?.updateBounds();
    });
  };
  document.addEventListener('pointerdown', down, opts);
  document.addEventListener('pointermove', move, opts);
  document.addEventListener('pointercancel', cancel, opts);
  document.addEventListener('scroll', scrolled, opts);
  return () => {
    document.removeEventListener('pointerdown', down, opts);
    document.removeEventListener('pointermove', move, opts);
    document.removeEventListener('pointercancel', cancel, opts);
    document.removeEventListener('scroll', scrolled, opts);
    if (frame) cancelAnimationFrame(frame);
  };
}
