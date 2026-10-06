// Idle life when no task needs the agents, plus ambient world events.
// Ghost (hacker): command center feeds, coffee, server checks, whiteboard, wandering, naps.
// He never sits at his PC when idle: the PC is only used for tasks, so "Ghost at the PC" always
// means a task is being worked on.
// Byte (assistant): patrols, waters plants, pets the cat, sorts mail, recharges, brings coffee.

import { STATIONS, type StationId } from '../../shared/officeLayout';
import { TILE } from '../../shared/constants';
import type { AmbientKind } from '../../shared/events';
import type { FxType, LogChannel, LogLevel, WorldProps } from '../../shared/types';
import type { Action, Agent } from './Agent';
import type { Rng } from './rng';

export interface BehaviorHost {
  now(): number;
  rng: Rng;
  hacker: Agent;
  assistant: Agent;
  world: WorldProps;
  setWorld(patch: Partial<WorldProps>, kind: AmbientKind): void;
  log(level: LogLevel, source: string, text: string, channel?: LogChannel): void;
  fx(type: FxType, x: number, y: number, opts?: { toX?: number; toY?: number; duration?: number }): void;
  isWalkable(x: number, y: number): boolean;
  taskActive(): boolean;
}

const CAT_PX = { x: 18 * TILE + 8, y: 17 * TILE + 4 };

export class IdleBehaviors {
  private lastCoffeeRun = -Infinity;
  private nextZ = 0;
  private nextLightning: number;
  private nextCatNap: number;
  private nextOverheat: number;

  constructor(private readonly host: BehaviorHost) {
    const now = host.now();
    this.nextLightning = now + host.rng.range(15000, 40000);
    this.nextCatNap = now + host.rng.range(40000, 90000);
    this.nextOverheat = now + host.rng.range(240000, 420000);
  }

  update(): void {
    const { hacker, assistant } = this.host;
    for (const a of [hacker, assistant]) {
      if (a.reserved || a.busy) continue;
      const errand = a.errands.shift();
      if (errand) {
        a.plan(errand);
        continue;
      }
      a.plan(a.def.idle === 'hacker' ? this.hackerPlan(a) : this.assistantPlan(a));
    }
    this.ambient();
  }

  // --- Ghost -------------------------------------------------------------------------------------

  private hackerPlan(ghost: Agent): Action[] {
    const r = this.host.rng;
    if (ghost.energy < 25) {
      return [
        { kind: 'say', text: 'Need... five... minutes.', duration: 1800 },
        { kind: 'goto', station: 'COUCH', activity: 'TO COUCH' },
        {
          kind: 'do',
          state: 'sleeping',
          anim: 'sleep',
          activity: 'NAP',
          duration: 6000,
          until: () => ghost.energy >= 85,
          maxDuration: 60000,
          facing: 'down',
          onStart: () => this.host.log('info', 'GHOST', 'GHOST: power nap on the couch', 'chat'),
        },
        { kind: 'do', state: 'idle', anim: 'idle', activity: 'STRETCH', duration: 800, facing: 'down' },
      ];
    }
    const choice = r.weighted<string>([
      ['feeds', 4],
      ['coffee', ghost.energy < 80 ? 3 : 1],
      ['servers', 2],
      ['whiteboard', 2],
      ['wander', 2],
      ['vending', 1],
    ]);
    switch (choice) {
      case 'feeds':
        return [
          { kind: 'goto', station: 'COMMAND_SCREEN', activity: 'TO COMMAND' },
          { kind: 'do', state: 'researching', anim: 'idle', activity: 'CHECK FEEDS', duration: r.int(4000, 9000), facing: 'up' },
        ];
      case 'coffee':
        return [
          { kind: 'goto', station: 'COFFEE', activity: 'COFFEE RUN' },
          { kind: 'do', state: 'drinking_coffee', anim: 'idle', activity: 'BREW COFFEE', duration: 2200, facing: 'up' },
          {
            kind: 'do',
            state: 'drinking_coffee',
            anim: 'idle',
            activity: 'SIP COFFEE',
            duration: 2600,
            facing: 'down',
            onEnd: () => {
              ghost.changeEnergy(18);
              ghost.holdMood('caffeinated', 40000);
            },
          },
        ];
      case 'servers':
        return [
          { kind: 'goto', station: 'SERVER_CHECK', activity: 'TO SERVERS' },
          { kind: 'do', state: 'researching', anim: 'idle', activity: 'CHECK RACKS', duration: r.int(3500, 6500), facing: 'up' },
          ...(r.chance(0.4) ? [{ kind: 'say', text: r.pick(['Temps nominal.', 'Fans OK.', 'Blinky lights: good.']), duration: 1600 } as Action] : []),
        ];
      case 'whiteboard':
        return [
          { kind: 'goto', station: 'WHITEBOARD', activity: 'TO LAB' },
          { kind: 'do', state: 'researching', anim: 'idle', activity: 'SKETCH PLAN', duration: r.int(3000, 5000), facing: 'up' },
        ];
      case 'vending':
        return [
          { kind: 'goto', station: 'VENDING', activity: 'SNACK RUN' },
          { kind: 'do', state: 'idle', anim: 'idle', activity: 'SNACK BREAK', duration: 2200, facing: 'up', onEnd: () => ghost.changeEnergy(8) },
        ];
      default: {
        const spot = r.pick<StationId>(['COMMAND_SCREEN', 'CORRIDOR_MID', 'LAB_BENCH', 'CORRIDOR_W', 'COMMAND_SIDE']);
        return [
          { kind: 'goto', station: spot, activity: 'WANDER' },
          { kind: 'do', state: 'idle', anim: 'idle', activity: 'THINKING', duration: r.int(1800, 3600) },
        ];
      }
    }
  }

  // --- Byte --------------------------------------------------------------------------------------

  private assistantPlan(byte: Agent): Action[] {
    const r = this.host.rng;
    const ghost = this.host.hacker;
    const now = this.host.now();
    if (byte.energy < 20) {
      return [
        { kind: 'goto', station: 'BYTE_HOME', activity: 'LOW BATTERY' },
        {
          kind: 'do',
          state: 'sleeping',
          anim: 'sleep',
          activity: 'RECHARGE',
          duration: 4000,
          until: () => byte.energy >= 90,
          maxDuration: 40000,
          facing: 'down',
        },
      ];
    }
    if (ghost.energy < 40 && ghost.state !== 'sleeping' && now - this.lastCoffeeRun > 45000) {
      this.lastCoffeeRun = now;
      return this.coffeeErrand(byte, 'auto');
    }
    const choice = r.weighted<string>([
      ['patrol', 3],
      ['plant', 2],
      ['cat', 2],
      ['home', 2],
      ['mail', 1],
    ]);
    switch (choice) {
      case 'plant': {
        const spot = r.pick<StationId>(['PLANT', 'PLANT_COMMAND']);
        return [
          { kind: 'goto', station: spot, activity: 'TO PLANT' },
          {
            kind: 'do',
            state: 'researching',
            anim: 'idle',
            activity: 'WATER PLANT',
            duration: 2600,
            onEnd: () => {
              const s = STATIONS[spot];
              const dx = s.facing === 'left' ? -TILE : TILE;
              this.host.fx('spark', s.x * TILE + 8 + dx, s.y * TILE - 2, { duration: 700 });
            },
          },
        ];
      }
      case 'cat':
        return [
          { kind: 'goto', station: 'CAT_SPOT', activity: 'TO CAT' },
          {
            kind: 'do',
            state: 'researching',
            anim: 'idle',
            activity: 'PET CAT',
            duration: 2400,
            onStart: () => this.wakeCat(6000, 'BYTE'),
          },
        ];
      case 'home':
        return [
          { kind: 'goto', station: 'BYTE_HOME', activity: 'TO DOCK' },
          { kind: 'do', state: 'idle', anim: 'idle', activity: 'STANDBY', duration: r.int(3500, 7000) },
        ];
      case 'mail':
        return [
          { kind: 'goto', station: 'INBOX', activity: 'TO INBOX' },
          { kind: 'do', state: 'researching', anim: 'typing', activity: 'SORT MAIL', duration: 2400, facing: 'up' },
        ];
      default: {
        const stops = [...Array(r.int(2, 3))].map(() =>
          r.pick<StationId>(['CORRIDOR_W', 'CORRIDOR_MID', 'CORRIDOR_E', 'DOOR', 'MAIL_DROP', 'COMMAND_SIDE']),
        );
        const plan: Action[] = [];
        for (const s of stops) {
          plan.push({ kind: 'goto', station: s, activity: 'PATROL' });
          plan.push({ kind: 'do', state: 'idle', anim: 'idle', activity: 'SCANNING', duration: r.int(700, 1600) });
        }
        return plan;
      }
    }
  }

  /** Byte brews a coffee and walks it to wherever Ghost is. reason: 'auto' or 'request'. */
  coffeeErrand(byte: Agent, reason: 'auto' | 'request'): Action[] {
    const ghost = this.host.hacker;
    const chase = (attempt: number): Action => ({
      kind: 'call',
      fn: () => {
        const target = this.besideAgent(ghost, byte);
        if (!target) {
          byte.insertNext([{ kind: 'say', text: 'Cannot reach the boss. Coffee on the desk.', duration: 1800 }]);
          byte.setCarrying(null);
          return;
        }
        byte.insertNext([
          { kind: 'goto', tile: target, activity: 'DELIVER COFFEE' },
          {
            kind: 'call',
            fn: () => {
              const g = ghost.position();
              const close = Math.abs(g.x - byte.x) + Math.abs(g.y - byte.y) <= 1.6;
              if (!close && attempt < 2) {
                byte.insertNext([chase(attempt + 1)]);
                return;
              }
              byte.setFacing(g.x < byte.x ? 'left' : g.x > byte.x ? 'right' : g.y < byte.y ? 'up' : 'down');
              byte.setCarrying(null);
              if (close) {
                ghost.changeEnergy(30);
                ghost.holdMood('caffeinated', 40000);
                const px = g.x * TILE + 8;
                const py = g.y * TILE - 8;
                this.host.fx('heart', px, py, { duration: 1200 });
                this.host.log('info', 'BYTE', 'BYTE: coffee delivered (+30 energy)', 'chat');
                byte.insertNext([{ kind: 'say', text: 'Coffee, boss!', to: ghost.id, duration: 1600 }]);
              }
            },
          },
        ]);
      },
    });
    return [
      ...(reason === 'request' ? [{ kind: 'say', text: 'One coffee, coming up.', duration: 1500 } as Action] : []),
      { kind: 'goto', station: 'COFFEE', activity: 'COFFEE ERRAND' },
      { kind: 'do', state: 'researching', anim: 'typing', activity: 'BREW COFFEE', duration: 1800, facing: 'up' },
      { kind: 'call', fn: () => byte.setCarrying('coffee') },
      chase(0),
    ];
  }

  /** A walkable tile next to `who`, closest to `from`. */
  private besideAgent(who: Agent, from: Agent): { x: number; y: number } | null {
    const p = who.position();
    const gx = Math.round(p.x);
    const gy = Math.round(p.y);
    const options = [
      { x: gx + 1, y: gy },
      { x: gx - 1, y: gy },
      { x: gx, y: gy + 1 },
      { x: gx, y: gy - 1 },
    ].filter((c) => this.host.isWalkable(c.x, c.y));
    if (!options.length) return null;
    options.sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
    return options[0];
  }

  wakeCat(ms: number, by: string): void {
    const now = this.host.now();
    this.host.setWorld({ catAwakeUntil: now + ms }, 'cat');
    this.host.fx('heart', CAT_PX.x, CAT_PX.y - 6, { duration: 1300 });
    // Byte pets the cat often; only viewer pets are worth a log line.
    if (by === 'VIEWER') this.host.log('info', 'VIEWER', 'a viewer pets the cat. Purr.', 'chat');
  }

  // --- Ambient -----------------------------------------------------------------------------------

  private ambient(): void {
    const now = this.host.now();
    const r = this.host.rng;
    if (now >= this.nextZ) {
      this.nextZ = now + 1400;
      for (const a of [this.host.hacker, this.host.assistant]) {
        if (a.state !== 'sleeping') continue;
        const p = a.position();
        const dy = a.station === 'COUCH' ? -14 : 0;
        this.host.fx('z', p.x * TILE + 12, p.y * TILE - 6 + dy, { duration: 1300 });
      }
    }
    if (now >= this.nextLightning) {
      this.nextLightning = now + r.range(30000, 80000);
      this.host.setWorld({ lightningAt: now }, 'lightning');
    }
    if (now >= this.nextCatNap) {
      this.nextCatNap = now + r.range(60000, 120000);
      this.host.setWorld({ catAwakeUntil: now + 5000 }, 'cat');
    }
    if (now >= this.nextOverheat) {
      this.nextOverheat = now + r.range(240000, 480000);
      this.randomOverheat();
    }
  }

  /** Rare idle event: rack 3 runs hot and Ghost goes to cool it down. */
  private randomOverheat(): void {
    const ghost = this.host.hacker;
    if (this.host.taskActive() || ghost.reserved || ghost.state === 'sleeping') return;
    const rack = STATIONS.SERVER_HOT;
    const px = rack.x * TILE + 8;
    const py = (rack.y - 1) * TILE - 4;
    this.host.setWorld({ rackOverheat: 3 }, 'rack_overheat');
    this.host.fx('siren', px, py - 8, { duration: 2000 });
    this.host.fx('smoke', px, py, { duration: 2000 });
    this.host.log('warn', 'SYSTEM', 'rack 3 temperature high');
    ghost.plan([
      { kind: 'say', text: 'Rack 3 is cooking!', duration: 1500 },
      { kind: 'goto', station: 'SERVER_HOT', activity: 'TO SERVERS' },
      {
        kind: 'do',
        state: 'researching',
        anim: 'idle',
        activity: 'COOL RACK',
        duration: 2600,
        facing: 'up',
        onEnd: () => {
          this.host.setWorld({ rackOverheat: null }, 'rack_overheat');
          this.host.fx('spark', px, py, { duration: 700 });
          this.host.log('success', 'GHOST', 'GHOST: rack 3 back to normal', 'chat');
        },
      },
    ]);
  }
}
