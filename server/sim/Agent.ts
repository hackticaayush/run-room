// One simulated agent: a finite state machine driven by a queue of actions.
// Pure server side. Every visible change is announced through the AgentHost (events).

import { levelForXp, type AgentDef } from '../../shared/agents';
import { STATIONS, type StationId } from '../../shared/officeLayout';
import { moveDuration, nextPointIndex, sampleMove } from '../../shared/motion';
import type {
  AgentAction,
  AgentId,
  AgentState,
  AgentStateName,
  AnimName,
  BubbleKind,
  CarryItem,
  Facing,
  Mood,
  MoveState,
  PathPoint,
} from '../../shared/types';
import { canTransition } from './fsm';

export type Action =
  | { kind: 'goto'; station?: StationId; tile?: { x: number; y: number }; facing?: Facing; activity?: string }
  | {
      kind: 'do';
      state: AgentStateName;
      anim: AnimName;
      activity: string;
      /** Minimum time in sim ms. */
      duration: number;
      /** Optional extra condition: the action ends once duration passed AND until() is true. */
      until?: () => boolean;
      /** Hard cap in sim ms when until() never becomes true. */
      maxDuration?: number;
      facing?: Facing;
      onStart?: () => void;
      onEnd?: () => void;
    }
  | { kind: 'say'; text: string; bubble?: BubbleKind; duration?: number; to?: AgentId | null; wait?: boolean }
  | { kind: 'call'; fn: () => void }
  | { kind: 'wait'; until: () => boolean; maxDuration?: number; state?: AgentStateName; anim?: AnimName; activity?: string };

export interface AgentHost {
  now(): number;
  findPath(from: { x: number; y: number }, to: { x: number; y: number }): PathPoint[] | null;
  agentChanged(agent: Agent): void;
  agentMoved(agent: Agent, move: MoveState): void;
  say(from: AgentId, to: AgentId | null, text: string, kind: BubbleKind, duration: number): void;
  levelUp(agent: Agent): void;
}

interface Running {
  action: Action;
  startedAt: number;
  /** For goto: when the walk ends. */
  arriveAt?: number;
}

const HISTORY = 10;

export class Agent {
  readonly id: AgentId;
  readonly def: AgentDef;
  state: AgentStateName = 'idle';
  activity = 'IDLE';
  station: StationId | null;
  x: number;
  y: number;
  facing: Facing;
  anim: AnimName = 'idle';
  carrying: CarryItem | null = null;
  energy = 100;
  xp = 0;
  level = 1;
  mood: Mood;
  taskId: string | null = null;
  move: MoveState | null = null;
  history: AgentAction[] = [];
  /** True while the task director owns this agent (idle behaviors pause). */
  reserved = false;
  /** Errands (e.g. bring coffee) waiting until the agent is free. */
  errands: Action[][] = [];
  /** Count of state changes the FSM rejected (rerouted through idle). */
  invalidTransitions = 0;

  private queue: Action[] = [];
  private running: Running | null = null;
  private moodHold: { mood: Mood; until: number } | null = null;
  private lastEnergySent = 100;
  private lastEnergyAt = 0;

  constructor(
    def: AgentDef,
    private readonly host: AgentHost,
  ) {
    this.id = def.id;
    this.def = def;
    const home = STATIONS[def.home];
    this.x = home.x;
    this.y = home.y;
    this.facing = home.facing;
    this.station = def.home;
    this.mood = def.startMood;
  }

  /** True when the agent is executing or has queued actions. */
  get busy(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  /** Replace whatever the agent is doing with a new plan (a walk in progress is re-routed smoothly). */
  plan(actions: Action[]): void {
    this.queue = [...actions];
    if (this.running && this.running.action.kind === 'do') this.running.action.onEnd?.();
    this.running = null;
  }

  enqueue(actions: Action[]): void {
    this.queue.push(...actions);
  }

  /** Inserts actions to run right after the current one (used by errands that decide late). */
  insertNext(actions: Action[]): void {
    this.queue.unshift(...actions);
  }

  clear(): void {
    this.plan([]);
  }

  addHistory(text: string): void {
    this.history.push({ at: Math.round(this.host.now()), text });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** Changes the FSM state. Invalid transitions are rerouted through idle and counted. */
  setState(state: AgentStateName, anim: AnimName, activity: string): void {
    if (!canTransition(this.state, state)) {
      this.invalidTransitions++;
      this.state = 'idle';
    }
    if (this.state === state && this.anim === anim && this.activity === activity) return;
    this.state = state;
    this.anim = anim;
    this.activity = activity;
    this.host.agentChanged(this);
  }

  setCarrying(item: CarryItem | null): void {
    if (this.carrying === item) return;
    this.carrying = item;
    this.host.agentChanged(this);
  }

  setFacing(f: Facing): void {
    if (this.facing === f) return;
    this.facing = f;
    this.host.agentChanged(this);
  }

  /** Temporary mood (caffeinated / hyped / overheating) for ms of sim time. */
  holdMood(mood: Mood, ms: number): void {
    this.moodHold = { mood, until: this.host.now() + ms };
    this.refreshMood();
  }

  changeEnergy(delta: number): void {
    this.energy = Math.max(0, Math.min(100, this.energy + delta));
  }

  addXp(amount: number): void {
    this.xp += Math.round(amount);
    const lvl = levelForXp(this.xp);
    const up = lvl > this.level;
    this.level = lvl;
    this.host.agentChanged(this);
    if (up) this.host.levelUp(this);
  }

  /** Current tile position, sampled from the walk when moving. */
  position(now = this.host.now()): { x: number; y: number } {
    if (!this.move) return { x: this.x, y: this.y };
    const s = sampleMove(this.move, now, this.facing);
    return { x: s.x, y: s.y };
  }

  toState(): AgentState {
    return {
      agentId: this.id,
      name: this.def.name,
      role: this.def.role,
      state: this.state,
      activity: this.activity,
      station: this.station,
      mood: this.mood,
      energy: Math.round(this.energy),
      xp: this.xp,
      level: this.level,
      x: this.x,
      y: this.y,
      facing: this.facing,
      anim: this.anim,
      carrying: this.carrying,
      taskId: this.taskId,
      move: this.move,
      history: [...this.history],
    };
  }

  private refreshMood(): void {
    const now = this.host.now();
    let mood: Mood;
    if (this.moodHold && now < this.moodHold.until) mood = this.moodHold.mood;
    else {
      this.moodHold = null;
      mood = this.energy < 30 ? 'tired' : this.def.startMood;
    }
    if (mood !== this.mood) {
      this.mood = mood;
      this.host.agentChanged(this);
    }
  }

  /** Energy upkeep per profile. dt in sim ms. */
  private upkeep(dt: number): void {
    const s = dt / 1000;
    const hacker = this.def.idle === 'hacker';
    switch (this.state) {
      case 'sleeping':
        this.changeEnergy((hacker ? 5 : 7) * s);
        break;
      case 'working_at_desk':
        this.changeEnergy(-(hacker ? 0.9 : 0.2) * s);
        break;
      case 'walking':
        this.changeEnergy(-(hacker ? 0.12 : 0.3) * s);
        break;
      case 'researching':
        this.changeEnergy(-0.25 * s);
        break;
      default:
        this.changeEnergy(-(hacker ? 0.05 : 0.03) * s);
    }
    const now = this.host.now();
    const rounded = Math.round(this.energy);
    if (rounded !== this.lastEnergySent && now - this.lastEnergyAt >= 1000) {
      this.lastEnergySent = rounded;
      this.lastEnergyAt = now;
      this.host.agentChanged(this);
    }
    this.refreshMood();
  }

  update(dt: number): void {
    const now = this.host.now();
    this.upkeep(dt);
    for (let guard = 0; guard < 16; guard++) {
      if (!this.running) {
        const next = this.queue.shift();
        if (!next) {
          this.settleIdle();
          return;
        }
        this.start(next, now);
        if (!this.running) continue;
      }
      if (!this.tick(this.running!, now)) return;
      this.finish(this.running!);
      this.running = null;
    }
  }

  /** With nothing left to do the agent stands idle where it is. */
  private settleIdle(): void {
    if (this.move) return;
    if (this.state !== 'idle' || this.anim !== 'idle') this.setState('idle', 'idle', 'IDLE');
  }

  private start(action: Action, now: number): void {
    switch (action.kind) {
      case 'goto': {
        const target = action.station ? STATIONS[action.station] : action.tile!;
        const ok = this.startWalk(target, now);
        this.addHistory(`-> ${action.station ?? `${target.x},${target.y}`}`);
        if (!ok) return; // unreachable target: skip the action
        if (!this.move) {
          // Already standing there: just take the station's facing.
          this.station = action.station ?? null;
          this.facing = action.facing ?? (action.station ? STATIONS[action.station].facing : this.facing);
          this.host.agentChanged(this);
          return;
        }
        this.running = { action, startedAt: now, arriveAt: now + moveDuration(this.move) };
        this.setState('walking', 'walk', action.activity ?? 'WALK');
        return;
      }
      case 'do':
        if (action.facing) this.facing = action.facing;
        this.setState(action.state, action.anim, action.activity);
        this.addHistory(action.activity);
        action.onStart?.();
        this.running = { action, startedAt: now };
        return;
      case 'say': {
        const duration = action.duration ?? Math.max(1800, 900 + action.text.length * 70);
        this.host.say(this.id, action.to ?? null, action.text, action.bubble ?? 'speech', duration);
        this.addHistory(`SAY ${action.text.slice(0, 32)}`);
        if (action.wait) this.running = { action: { ...action, duration }, startedAt: now };
        return;
      }
      case 'call':
        action.fn();
        return;
      case 'wait':
        if (action.state) this.setState(action.state, action.anim ?? 'idle', action.activity ?? 'WAIT');
        this.running = { action, startedAt: now };
        return;
    }
  }

  /** Returns true when the running action is complete. */
  private tick(r: Running, now: number): boolean {
    const a = r.action;
    switch (a.kind) {
      case 'goto':
        return now >= (r.arriveAt ?? now);
      case 'do': {
        const elapsed = now - r.startedAt;
        if (a.maxDuration !== undefined && elapsed >= a.maxDuration) return true;
        if (elapsed < a.duration) return false;
        return a.until ? a.until() : true;
      }
      case 'say':
        return now - r.startedAt >= (a.duration ?? 0);
      case 'wait':
        if (a.maxDuration !== undefined && now - r.startedAt >= a.maxDuration) return true;
        return a.until();
      default:
        return true;
    }
  }

  private finish(r: Running): void {
    const a = r.action;
    if (a.kind === 'goto') {
      if (this.move) {
        const last = this.move.path[this.move.path.length - 1];
        this.x = last[0];
        this.y = last[1];
        this.move = null;
      }
      const target = a.station ? STATIONS[a.station] : null;
      this.station = a.station ?? null;
      this.facing = a.facing ?? target?.facing ?? this.facing;
      this.setState('idle', 'idle', 'IDLE');
      this.host.agentChanged(this);
    } else if (a.kind === 'do') {
      a.onEnd?.();
    }
  }

  /** Starts walking toward a tile. Returns false when the target is unreachable. */
  private startWalk(target: { x: number; y: number }, now: number): boolean {
    let prefix: PathPoint[] = [];
    let from = { x: this.x, y: this.y };
    if (this.move) {
      // Re-route without snapping: keep the current fractional position and finish the step
      // to the next path point first.
      const s = sampleMove(this.move, now, this.facing);
      const idx = nextPointIndex(this.move, now);
      if (idx < this.move.path.length) {
        const next = this.move.path[idx];
        prefix = [[s.x, s.y]];
        from = { x: next[0], y: next[1] };
      } else {
        const last = this.move.path[this.move.path.length - 1];
        from = { x: last[0], y: last[1] };
      }
      this.move = null;
    }
    const path = this.host.findPath(from, target);
    if (!path) return false;
    const full: PathPoint[] = prefix.length ? [prefix[0], ...path] : path;
    this.x = Math.round(from.x);
    this.y = Math.round(from.y);
    this.station = null;
    if (full.length <= 1 || (full.length === 2 && prefix.length && full[0][0] === full[1][0] && full[0][1] === full[1][1])) {
      // Already there.
      this.x = target.x;
      this.y = target.y;
      return true;
    }
    this.move = { path: full, startClock: now, speed: this.def.speed };
    this.host.agentMoved(this, this.move);
    return true;
  }
}
