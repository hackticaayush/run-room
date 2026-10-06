// FX from server events. Each effect is a pure function of (sim time - startClock) and its id,
// so every tab shows identical particles. Sprites come from a preallocated pool (no per frame
// allocation in the hot loop).

import type Phaser from 'phaser';
import type { FxEvent } from '@shared/types';
import { TEX } from './BootScene';
import { DEPTH, hash } from './PropRenderer';

const POOL = 160;

function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

export class FxRenderer {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < POOL; i++) this.pool.push(this.make());
  }

  private make(): Phaser.GameObjects.Image {
    return this.scene.add.image(0, 0, TEX.fx, 'spark').setVisible(false).setDepth(DEPTH.fx);
  }

  private put(frame: string, x: number, y: number, alpha = 1): void {
    if (this.used >= this.pool.length) this.pool.push(this.make());
    const img = this.pool[this.used++];
    img.setFrame(frame).setPosition(Math.round(x), Math.round(y)).setAlpha(alpha).setVisible(true);
  }

  update(now: number, list: readonly FxEvent[]): void {
    this.used = 0;
    for (const f of list) {
      const t = now - f.startClock;
      if (t < 0 || t > f.duration) continue;
      this.draw(f, t, t / f.duration);
    }
    for (let i = this.used; i < this.pool.length; i++) {
      if (this.pool[i].visible) this.pool[i].setVisible(false);
    }
  }

  private draw(f: FxEvent, t: number, k: number): void {
    const fade = k > 0.75 ? (1 - k) / 0.25 : 1;
    switch (f.type) {
      case 'heart':
        this.put('heart', f.x, f.y - 14 * k, fade);
        break;
      case 'z':
        this.put('z', f.x + 5 * k, f.y - 12 * k, fade);
        break;
      case 'exclaim':
        this.put('exclaim', f.x, f.y - (t < 140 ? 3 : 0));
        break;
      case 'spark':
        if (Math.floor(t / 70) % 2 === 0) this.put('spark', f.x, f.y - 4 * k);
        break;
      case 'packet':
      case 'file_sprite':
      case 'mail_drop': {
        const frame = f.type === 'packet' ? `packet_${Math.floor(t / 100) % 2}` : f.type;
        if (f.toX !== undefined && f.toY !== undefined) {
          const p = f.type === 'mail_drop' ? k * k : easeInOut(k);
          const arc = f.type === 'mail_drop' ? 0 : Math.sin(p * Math.PI) * 10;
          this.put(frame, f.x + (f.toX - f.x) * p, f.y + (f.toY - f.y) * p - arc);
        } else {
          this.put(frame, f.x, f.y - 6 * k, fade);
        }
        break;
      }
      case 'smoke':
        for (let i = 0; i < 4; i++) {
          const ti = t - i * 260;
          if (ti < 0 || ti > 900) continue;
          const kk = ti / 900;
          const sway = Math.sin(ti / 160 + i) * 2;
          this.put(`smoke_${Math.min(2, Math.floor(kk * 3))}`, f.x + (i - 1.5) * 2 + sway, f.y - 16 * kk, 1 - kk * 0.6);
        }
        break;
      case 'siren':
        this.put(`siren_${Math.floor(t / 150) % 2}`, f.x, f.y);
        break;
      case 'coin_xp':
        this.put('coin_xp', f.x, f.y - 16 * easeInOut(Math.min(1, k * 1.4)), fade);
        break;
      case 'confetti': {
        const seed = hash(Number(f.id.replace(/\D/g, '')) || 1);
        const ts = t / 1000;
        for (let j = 0; j < 28; j++) {
          const h = hash(seed + j * 7919);
          const angle = -Math.PI / 2 + ((h % 1000) / 1000 - 0.5) * 2.2;
          const speed = 55 + (h % 47);
          const x = f.x + Math.cos(angle) * speed * ts;
          const y = f.y + Math.sin(angle) * speed * ts + 90 * ts * ts;
          this.put(`confetti_${j % 4}`, x, y, fade);
        }
        break;
      }
      case 'matrix':
        for (let c = 0; c < 3; c++) this.put(`matrix_${(Math.floor(t / 120) + c) % 4}`, f.x - 8 + c * 8, f.y, fade);
        break;
      case 'dust_puff':
        this.put(`dust_puff_${t < f.duration / 2 ? 0 : 1}`, f.x, f.y);
        break;
    }
  }
}
