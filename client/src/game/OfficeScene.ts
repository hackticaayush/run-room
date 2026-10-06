// The office canvas. Pure renderer: everything shown is derived from the world store
// (server events) and the mirrored sim clock. No simulation happens here.

import Phaser from 'phaser';
import { MAP_H, MAP_W } from '@shared/officeLayout';
import { TILE } from '@shared/constants';
import { HACKER_ID } from '@shared/agents';
import type { AgentId } from '@shared/types';
import { worldStore } from '../net/store';
import { getSettings, subscribeSettings, type Settings } from '../settings';
import { bridge, followState } from './bridge';
import { buildDebugOverlay, buildMap, type MapLayers } from './MapRenderer';
import { NIGHT_TINT, PropRenderer, arrowCursor } from './PropRenderer';
import { AgentRenderer } from './AgentRenderer';
import { FxRenderer } from './FxRenderer';
import { BubbleRenderer } from './BubbleRenderer';

export class OfficeScene extends Phaser.Scene {
  private props!: PropRenderer;
  private agents!: AgentRenderer;
  private fx!: FxRenderer;
  private bubbles!: BubbleRenderer;
  private map!: MapLayers;
  private debug!: Phaser.GameObjects.Container;
  private unsubs: (() => void)[] = [];
  private following: AgentId | null = null;

  constructor() {
    super('office');
  }

  create(): void {
    this.map = buildMap(this);
    this.props = new PropRenderer(this, (kind) => {
      if (kind === 'monitor') bridge.emit('monitorClicked', undefined);
      else bridge.emit('catClicked', undefined);
    });
    this.agents = new AgentRenderer(this, (id) => bridge.emit('agentClicked', id));
    this.fx = new FxRenderer(this);
    this.bubbles = new BubbleRenderer(this);
    this.debug = buildDebugOverlay(this);
    this.input.setDefaultCursor(arrowCursor);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    cam.setRoundPixels(true);

    this.applySettings(getSettings());
    this.unsubs.push(subscribeSettings(() => this.applySettings(getSettings())));
    this.unsubs.push(bridge.on('follow', (id) => this.setFollow(id)));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
    bridge.emit('ready', undefined);
  }

  private applySettings(s: Settings): void {
    this.props.setNight(s.night);
    this.agents.setNight(s.night);
    if (s.night) this.map.base.setTint(NIGHT_TINT);
    else this.map.base.clearTint();
    this.debug.setVisible(s.debugGrid);
    if (!s.follow && this.following) this.setFollow(null);
  }

  /** Follow an agent at 2x camera zoom (integer), or show the whole office. */
  private setFollow(id: AgentId | null): void {
    const cam = this.cameras.main;
    this.following = id && getSettings().follow ? id : null;
    followState.agentId = this.following;
    const sprite = this.following ? this.agents.spriteOf(this.following) : null;
    if (sprite) {
      cam.setZoom(2);
      cam.startFollow(sprite, true, 1, 1, 0, 12);
    } else {
      cam.stopFollow();
      cam.setZoom(1);
      cam.centerOn((MAP_W * TILE) / 2, (MAP_H * TILE) / 2);
    }
  }

  override update(): void {
    const now = worldStore.simNow();
    const st = worldStore.state;
    this.agents.update(now, st.agents);
    const ghost = st.agents[HACKER_ID];
    const ghostTyping = ghost !== undefined && ghost.anim === 'typing' && ghost.station === 'DESK_GHOST' && !ghost.move;
    this.props.update(now, st.world, ghostTyping);
    this.fx.update(now, st.fx);
    this.bubbles.update(now, st.dialogues, this.agents.positions);
    // A follow request may arrive before the agent sprite exists.
    if (this.following && !this.agents.spriteOf(this.following)) this.setFollow(this.following);
  }
}
