// Hosts the Phaser canvas at the largest integer zoom that fits, centered and letterboxed,
// with the CSS night and CRT overlays on top. Wide layout: whole CSS pixels per art pixel.
// Narrow layout (tablets, phones): whole DEVICE pixels per art pixel, sized to the screen width
// and the window height, and the office area then hugs the canvas.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type Phaser from 'phaser';
import { createGame, deviceZoom, integerZoom, BASE_H, BASE_W } from '../game/createGame';
import { useSettings } from '../settings';
import './office.css';

/** The top bar and the panel tabs stay visible above and below the office on narrow screens. */
const NARROW_CHROME_PX = 96;

function fitZoom(wrap: HTMLElement): number {
  const r = wrap.getBoundingClientRect();
  if (!wrap.closest('.is-narrow')) return integerZoom(r.width, r.height);
  return deviceZoom(r.width, Math.max(160, window.innerHeight - NARROW_CHROME_PX), window.devicePixelRatio || 1);
}

export function OfficeView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [zoom, setZoom] = useState(2);
  const settings = useSettings();

  useEffect(() => {
    if (!hostRef.current) return;
    const z = wrapRef.current ? fitZoom(wrapRef.current) : 2;
    const game = createGame(hostRef.current, z);
    gameRef.current = game;
    setZoom(z);
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const refit = () => {
      const z = fitZoom(el);
      setZoom((prev) => {
        if (prev !== z) gameRef.current?.scale.setZoom(z);
        return z;
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    // The narrow layout also depends on the window height and on rotating the phone.
    window.addEventListener('resize', refit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refit);
    };
  }, []);

  const stageStyle = { width: BASE_W * zoom, height: BASE_H * zoom, '--zoom': `${zoom}px` } as CSSProperties;

  return (
    <div className="office-view" ref={wrapRef}>
      <div className="office-stage" style={stageStyle} data-zoom={zoom} data-small={zoom < 2 ? '' : undefined}>
        <div ref={hostRef} className="office-canvas-host" />
        {settings.night && <div className="office-overlay office-night" />}
        {settings.crt && <div className="office-overlay office-crt" />}
      </div>
    </div>
  );
}
