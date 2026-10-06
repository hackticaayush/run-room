// Props from shared/officeLayout.ts: static sprites, state bound sprites (desk screen, mailbox,
// cat, racks...), animations on the shared sim time prop clock, night lighting, the monitor ticker.
// Everything is a pure function of (sim time, world props) so every tab shows the same frame.

import Phaser from 'phaser';
import { PROPS as PLACEMENTS, type PropPlacement } from '@shared/officeLayout';
import { PROP_FRAME_MS, RACK_BLINK_BUSY_MS, RACK_BLINK_IDLE_MS, TILE } from '@shared/constants';
import type { WorldProps } from '@shared/types';
import { BITMAP_FONTS, CURSORS, EMISSIVE, assetUrl } from '../assets/manifest';
import { TEX } from './BootScene';
import { takeTap } from './tap';

export const DEPTH = {
  floorDecal: 2,
  wall: 3,
  objectBase: 10,
  fx: 4000,
  bubbles: 5000,
  glow: 6000,
  debug: 7000,
} as const;

/** Multiplicative tint applied to every non emissive sprite at night. */
export const NIGHT_TINT = EMISSIVE.nightTint;

interface PropView {
  def: PropPlacement;
  sprite: Phaser.GameObjects.Image;
  /** Emissive twin: only the light emitting pixels, drawn just above the sprite. */
  light?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
}

/** Deterministic hash used for flicker patterns (same result on every client). */
export function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export const handCursor = `url("${assetUrl(CURSORS.hand.image)}") ${CURSORS.hand.hotX} ${CURSORS.hand.hotY}, pointer`;
export const arrowCursor = `url("${assetUrl(CURSORS.arrow.image)}") ${CURSORS.arrow.hotX} ${CURSORS.arrow.hotY}, default`;

const GLOWING_FRAMES: ReadonlySet<string> = new Set<string>(EMISSIVE.props.frames);

export class PropRenderer {
  readonly views: PropView[] = [];
  private ticker?: Phaser.GameObjects.DynamicBitmapText;
  private tickerText = '';
  private tickerWidth = 0;
  private codeOverlay?: Phaser.GameObjects.Image;
  private night = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onClick: (kind: 'monitor' | 'cat') => void,
  ) {
    for (const def of PLACEMENTS) this.views.push(this.createView(def));
    this.createTicker();
    this.createCodeOverlay();
  }

  private frameSize(name: string): { w: number; h: number } {
    const f = this.scene.textures.getFrame(TEX.props, name);
    return { w: f.width, h: f.height };
  }

  private initialFrame(def: PropPlacement): string {
    switch (def.binding) {
      case 'rack':
        return 'server_rack_0';
      case 'cat':
        return 'cat_sleep';
      case 'deskScreen':
        return 'workstation_desk_off';
      case 'mailbox':
        return 'mail_dropbox';
      case 'neon':
        return 'neon_sign_on';
      case 'monitor':
      case 'hologram':
      case 'rain':
      case 'courier':
      case 'bug':
        return `${def.sprite}_0`;
      default:
        return def.sprite;
    }
  }

  /** Top-left pixel position of a prop sprite. */
  static position(def: PropPlacement, w: number, h: number): { x: number; y: number } {
    if (def.layer === 'wall') return { x: def.x * TILE + (def.ox ?? 0), y: def.y * TILE + (def.oy ?? 0) };
    return {
      x: def.x * TILE + Math.floor((def.w * TILE - w) / 2) + (def.ox ?? 0),
      y: (def.y + def.h) * TILE - h + (def.oy ?? 0),
    };
  }

  static depthOf(def: PropPlacement): number {
    if (def.layer === 'floor') return DEPTH.floorDecal;
    if (def.layer === 'wall') return DEPTH.wall;
    return DEPTH.objectBase + (def.y + def.h) * TILE + (def.depthBias ?? 0);
  }

  private canGlow(def: PropPlacement): boolean {
    for (const name of GLOWING_FRAMES) if (name === def.sprite || name.startsWith(`${def.sprite}_`)) return true;
    return false;
  }

  private createView(def: PropPlacement): PropView {
    const frame = this.initialFrame(def);
    const { w, h } = this.frameSize(frame);
    const pos = PropRenderer.position(def, w, h);
    const depth = PropRenderer.depthOf(def);
    const sprite = this.scene.add.image(pos.x, pos.y, TEX.props, frame).setOrigin(0, 0).setDepth(depth);
    if (def.click) {
      sprite.setInteractive({ cursor: handCursor });
      sprite.on('pointerup', () => {
        if (takeTap()) this.onClick(def.click!);
      });
    }
    const view: PropView = { def, sprite };
    if (this.canGlow(def)) {
      view.light = this.scene.add.image(pos.x, pos.y, TEX.propsEmissive, frame).setOrigin(0, 0).setDepth(depth + 0.1);
    }
    if (def.glow) {
      const g = this.scene.add.image(0, 0, TEX.props, `glow_${def.glow}`).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.2);
      const c = this.glowCenter(def, pos, w, h);
      g.setPosition(c.x, c.y);
      if (def.sprite === 'monitor_wall') g.setScale(2, 1);
      view.glow = g;
    }
    return view;
  }

  private glowCenter(def: PropPlacement, pos: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
    switch (def.sprite) {
      case 'workstation_desk':
        return { x: pos.x + 24, y: pos.y + 8 };
      case 'desk_blue':
      case 'desk_green':
        return { x: pos.x + 16, y: pos.y + 6 };
      case 'server_rack':
        return { x: pos.x + 8, y: pos.y + 14 };
      case 'hologram':
        return { x: pos.x + 8, y: pos.y + 8 };
      default:
        return { x: pos.x + Math.floor(w / 2), y: pos.y + Math.floor(h / 2) };
    }
  }

  private createTicker(): void {
    const mw = this.views.find((v) => v.def.binding === 'monitor');
    if (!mw) return;
    this.ticker = this.scene.add
      .dynamicBitmapText(mw.sprite.x + 3, mw.sprite.y + 16, BITMAP_FONTS.tiny.key, '', BITMAP_FONTS.tiny.size)
      .setDepth(DEPTH.wall + 1)
      .setTint(0x00f0ff);
    this.ticker.setSize(42, 5);
  }

  private createCodeOverlay(): void {
    const ws = this.views.find((v) => v.def.binding === 'deskScreen');
    if (!ws) return;
    // The main screen of the workstation sprite starts at (16, 3). Screens emit light: the
    // overlay is drawn untinted above the emissive twin.
    this.codeOverlay = this.scene.add
      .image(ws.sprite.x + 16, ws.sprite.y + 3, TEX.props, 'screen_code_0')
      .setOrigin(0, 0)
      .setDepth(ws.sprite.depth + 0.15)
      .setVisible(false);
  }

  setNight(night: boolean): void {
    this.night = night;
    for (const v of this.views) this.applyTint(v, false);
  }

  private applyTint(v: PropView, flash: boolean): void {
    if (flash) v.sprite.setTintFill(0xe8f0ff);
    else if (this.night) v.sprite.setTint(NIGHT_TINT);
    else v.sprite.clearTint();
  }

  private setFrame(v: PropView, frame: string): void {
    if (v.sprite.frame.name === frame) return;
    v.sprite.setFrame(frame);
    v.light?.setFrame(frame);
  }

  /** Called every render frame with the mirrored sim time. */
  update(now: number, world: WorldProps, ghostTyping: boolean): void {
    const propFrame = Math.floor(now / PROP_FRAME_MS);
    for (const v of this.views) {
      const d = v.def;
      switch (d.binding) {
        case 'rack': {
          const period = world.racksBusy ? RACK_BLINK_BUSY_MS : RACK_BLINK_IDLE_MS;
          const f = Math.floor((now + (d.rack ?? 0) * 97) / period) % 2;
          const hot = world.rackOverheat === d.rack;
          this.setFrame(v, hot ? `server_rack_hot_${f}` : `server_rack_${f}`);
          if (v.glow) v.glow.setFrame(hot ? 'glow_red' : 'glow_green');
          break;
        }
        case 'monitor':
          this.setFrame(v, `monitor_wall_${Math.floor(now / 600) % 2}`);
          break;
        case 'neon': {
          const flicker = hash(propFrame) % 47 === 0 || hash(propFrame + 1) % 211 === 0;
          this.setFrame(v, flicker ? 'neon_sign_off' : 'neon_sign_on');
          if (v.glow) v.glow.setVisible(!flicker);
          break;
        }
        case 'hologram':
          this.setFrame(v, `hologram_${Math.floor(now / 330) % 2}`);
          break;
        case 'rain': {
          this.setFrame(v, `window_rain_${Math.floor(now / 240) % 2}`);
          const since = now - world.lightningAt;
          const flash = world.lightningAt >= 0 && since >= 0 && (since < 90 || (since > 160 && since < 230));
          this.applyTint(v, flash);
          break;
        }
        case 'courier':
          this.setFrame(v, `robot_courier_${Math.floor(now / 700) % 2}`);
          break;
        case 'bug':
          this.setFrame(v, `bug_${Math.floor(now / 260) % 2}`);
          break;
        case 'cat':
          this.setFrame(v, now < world.catAwakeUntil ? `cat_${Math.floor(now / 420) % 2}` : 'cat_sleep');
          break;
        case 'deskScreen':
          this.setFrame(v, `workstation_desk_${world.deskScreen}`);
          if (v.glow) {
            v.glow.setVisible(world.deskScreen !== 'off');
            v.glow.setFrame(world.deskScreen === 'red' ? 'glow_red' : world.deskScreen === 'blue' ? 'glow_cyan' : 'glow_green');
          }
          break;
        case 'mailbox':
          this.setFrame(v, world.mailbox === 'full' ? 'mail_dropbox_full' : 'mail_dropbox');
          break;
        default:
          break;
      }
      if (v.glow && v.glow.visible) {
        // Screens glow brighter at night; a slow shimmer keeps them alive.
        const shimmer = (hash(propFrame + v.def.x * 31 + v.def.y * 7) % 7) / 100;
        v.glow.setAlpha((this.night ? 0.8 : 0.16) - shimmer);
      }
    }

    if (this.codeOverlay) {
      const show = ghostTyping && world.deskScreen === 'green';
      this.codeOverlay.setVisible(show);
      if (show) this.codeOverlay.setFrame(`screen_code_${Math.floor(now / 180) % 4}`);
    }

    if (this.ticker) {
      const text = (world.monitorText || 'RUN ROOM ONLINE').toUpperCase();
      if (text !== this.tickerText) {
        this.tickerText = text;
        const unit = `${text}  //  `;
        // The tiny font is monospaced, so one repetition is length x advance pixels wide.
        this.tickerWidth = unit.length * BITMAP_FONTS.tiny.advance;
        // Three copies so the 42 px window never runs out of text while scrolling.
        this.ticker.setText(unit.repeat(3));
      }
      this.ticker.scrollX = Math.floor(now / 70) % Math.max(1, this.tickerWidth);
    }
  }
}
