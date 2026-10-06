// Draws the agents from server state. Position = sampleMove(move, simNow), the same function the
// server uses, so every tab shows the agents at the same spot at the same moment. Frames are
// picked from the animations registered from characters.json, indexed by distance or sim time.

import type Phaser from 'phaser';
import { STATIONS, type StationId } from '@shared/officeLayout';
import { sampleMove } from '@shared/motion';
import { TILE, WALK_FRAME_TILES } from '@shared/constants';
import type { AgentId, AgentState } from '@shared/types';
import { AGENT_DEFS } from '@shared/agents';
import { animKey, emissiveKey, TEX } from './BootScene';
import { DEPTH, NIGHT_TINT, handCursor } from './PropRenderer';
import { takeTap } from './tap';

interface AgentView {
  id: AgentId;
  sheet: string;
  sprite: Phaser.GameObjects.Sprite;
  light: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  carry: Phaser.GameObjects.Image;
  dust: Phaser.GameObjects.Image;
}

export interface AgentScreenPos {
  x: number;
  /** Top of the sprite (for bubbles). */
  top: number;
  /** Feet. */
  y: number;
}

export class AgentRenderer {
  private readonly views = new Map<AgentId, AgentView>();
  private readonly frameCache = new Map<string, number[]>();
  private readonly fpsCache = new Map<string, number>();
  readonly positions = new Map<AgentId, AgentScreenPos>();
  private night = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onClick: (id: AgentId) => void,
  ) {}

  setNight(night: boolean): void {
    this.night = night;
    for (const v of this.views.values()) {
      if (night) v.sprite.setTint(NIGHT_TINT);
      else v.sprite.clearTint();
    }
  }

  /** The followed agent's sprite (camera target). */
  spriteOf(id: AgentId): Phaser.GameObjects.Sprite | null {
    return this.views.get(id)?.sprite ?? null;
  }

  private frames(sheet: string, anim: string): number[] {
    const key = animKey(sheet, anim);
    let list = this.frameCache.get(key);
    if (!list) {
      const a = this.scene.anims.get(key);
      list = a ? a.frames.map((f) => Number(f.textureFrame)) : [0];
      this.frameCache.set(key, list);
      this.fpsCache.set(key, a?.frameRate ?? 6);
    }
    return list;
  }

  private fps(sheet: string, anim: string): number {
    this.frames(sheet, anim);
    return this.fpsCache.get(animKey(sheet, anim)) ?? 6;
  }

  private ensure(state: AgentState): AgentView {
    let v = this.views.get(state.agentId);
    if (v) return v;
    const def = AGENT_DEFS.find((d) => d.id === state.agentId);
    const sheet = def?.sprite ?? state.agentId;
    const sprite = this.scene.add.sprite(0, 0, sheet, 0).setOrigin(0.5, 1);
    sprite.setInteractive({ cursor: handCursor });
    sprite.on('pointerup', () => {
      if (takeTap()) this.onClick(state.agentId);
    });
    const light = this.scene.add.sprite(0, 0, emissiveKey(sheet), 0).setOrigin(0.5, 1);
    const shadow = this.scene.add.image(0, 0, TEX.fx, 'shadow').setOrigin(0.5, 0.5).setDepth(DEPTH.floorDecal + 0.5);
    const carry = this.scene.add.image(0, 0, TEX.fx, 'file_sprite').setOrigin(0.5, 1).setVisible(false);
    const dust = this.scene.add.image(0, 0, TEX.fx, 'dust_puff_0').setOrigin(0.5, 1).setVisible(false).setDepth(DEPTH.floorDecal + 0.6);
    v = { id: state.agentId, sheet, sprite, light, shadow, carry, dust };
    if (this.night) sprite.setTint(NIGHT_TINT);
    this.views.set(state.agentId, v);
    return v;
  }

  update(now: number, agents: Record<AgentId, AgentState>): void {
    for (const state of Object.values(agents)) this.draw(this.ensure(state), state, now);
  }

  private draw(v: AgentView, a: AgentState, now: number): void {
    const s = a.move ? sampleMove(a.move, now, a.facing) : null;
    const walking = s !== null && !s.done;
    const tx = s ? s.x : a.x;
    const ty = s ? s.y : a.y;
    let px = tx * TILE + TILE / 2;
    let py = (ty + 1) * TILE;
    const station = a.station ? STATIONS[a.station as StationId] : undefined;
    const posed = !walking && station && 'pose' in station && (a.anim === 'typing' || a.anim === 'seated' || a.anim === 'sleep');
    if (posed && station && 'pose' in station) {
      px += station.pose.dx;
      py += station.pose.dy;
    }

    let frame: number;
    if (walking && s) {
      const list = this.frames(v.sheet, `walk_${s.facing}`);
      frame = list[Math.floor(s.distance / WALK_FRAME_TILES) % list.length];
    } else {
      const anim = a.anim === 'walk' || a.anim === 'idle' ? `idle_${a.facing}` : a.anim;
      const list = this.frames(v.sheet, anim);
      const fps = this.fps(v.sheet, anim);
      // Offset by agent so two idle agents do not blink in unison.
      const offset = v.id.length * 431;
      frame = list[Math.floor(((now + offset) / 1000) * fps) % list.length];
    }

    const rx = Math.round(px);
    const ry = Math.round(py);
    const depth = DEPTH.objectBase + (ty + 1) * TILE + 0.5;
    v.sprite.setPosition(rx, ry).setFrame(frame).setDepth(depth);
    v.light.setPosition(rx, ry).setFrame(frame).setDepth(depth + 0.1);
    v.shadow.setPosition(rx, Math.round((ty + 1) * TILE) - 1).setVisible(!posed);

    // Carried item bobs above the head.
    if (a.carrying) {
      const name = a.carrying === 'file' ? 'file_sprite' : a.carrying === 'coffee' ? 'coffee_cup' : `packet_${Math.floor(now / 200) % 2}`;
      const bob = Math.floor(now / 260) % 2;
      v.carry.setFrame(name).setPosition(rx, ry - 24 - bob).setDepth(depth + 0.2).setVisible(true);
    } else v.carry.setVisible(false);

    // Dust puff at the start of every walk (deterministic: derived from the move itself).
    if (a.move && now - a.move.startClock >= 0 && now - a.move.startClock < 320) {
      const [sx, sy] = a.move.path[0];
      const f = now - a.move.startClock < 160 ? 'dust_puff_0' : 'dust_puff_1';
      v.dust.setFrame(f).setPosition(Math.round(sx * TILE + TILE / 2), Math.round((sy + 1) * TILE)).setVisible(true);
    } else v.dust.setVisible(false);

    this.positions.set(v.id, { x: rx, y: ry, top: ry - 22 });
  }
}
