// Client mirror of the server world. The client NEVER simulates: it only applies server events.
// React reads slices through useWorld(); the Phaser scene reads the same store every frame.

import { useSyncExternalStore } from 'react';
import type { ServerEvent } from '@shared/events';
import { SimClockMirror } from '@shared/clock';
import type {
  AgentId,
  AgentState,
  DialogueInfo,
  FxEvent,
  InputRequest,
  LogEntry,
  ProjectInfo,
  ResultInfo,
  RunState,
  ServerConfig,
  TaskInfo,
  WorldProps,
} from '@shared/types';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface ClientWorld {
  connected: boolean;
  everConnected: boolean;
  clientId: string | null;
  config: ServerConfig | null;
  agents: Record<AgentId, AgentState>;
  agentOrder: AgentId[];
  /** Queued, waiting and active tasks plus the most recent finished ones. */
  tasks: TaskInfo[];
  logs: LogEntry[];
  /** Incremented when the log list is replaced (snapshot or clear) so views can reset. */
  logEpoch: number;
  results: ResultInfo[];
  dialogues: DialogueInfo[];
  fx: FxEvent[];
  world: WorldProps;
  clients: number;
  notices: Notice[];
  /** Saved projects (shared by every viewer). */
  projects: ProjectInfo[];
  /** The current run's monitor state, or the last run's. */
  run: RunState | null;
  /** The running program waits for input (every viewer gets the prompt). */
  input: InputRequest | null;
}

const MAX_LOGS = 600;
const MAX_FINISHED_TASKS = 6;

const emptyWorld: WorldProps = {
  racksBusy: false,
  rackOverheat: null,
  mailbox: 'empty',
  monitorText: '',
  deskScreen: 'off',
  catAwakeUntil: 0,
  lightningAt: -1,
  stats: { tasksDone: 0, tasksFailed: 0, tasksCancelled: 0 },
};

type Listener = () => void;
type EventListener = (event: ServerEvent) => void;

let noticeSeq = 1;

export class WorldStore {
  state: ClientWorld = {
    connected: false,
    everConnected: false,
    clientId: null,
    config: null,
    agents: {},
    agentOrder: [],
    tasks: [],
    logs: [],
    logEpoch: 0,
    results: [],
    dialogues: [],
    fx: [],
    world: emptyWorld,
    clients: 0,
    notices: [],
    projects: [],
    run: null,
    input: null,
  };

  readonly clock = new SimClockMirror();
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ClientWorld => this.state;

  /** Raw event feed for the renderer (FX, sounds, camera reactions). */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private set(patch: Partial<ClientWorld>): void {
    this.state = { ...this.state, ...patch };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  setConnected(connected: boolean): void {
    this.set({ connected, everConnected: this.state.everConnected || connected });
    this.notify();
  }

  pushNotice(level: Notice['level'], text: string): void {
    this.set({ notices: [...this.state.notices, { id: noticeSeq++, level, text }].slice(-5) });
    this.notify();
  }

  dismissNotice(id: number): void {
    this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
    this.notify();
  }

  clearLogs(): void {
    this.set({ logs: [], logEpoch: this.state.logEpoch + 1 });
    this.notify();
  }

  /** Resolves with the first event (from now on) that matches, or null after ms. */
  waitForEvent(pred: (event: ServerEvent) => boolean, ms: number): Promise<ServerEvent | null> {
    return new Promise((resolve) => {
      const off = this.onEvent((e) => {
        if (!pred(e)) return;
        off();
        window.clearTimeout(timer);
        resolve(e);
      });
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, ms);
    });
  }

  /** Simulation time now, as estimated from the last CLOCK sync. */
  simNow(): number {
    return this.clock.now(performance.now());
  }

  apply(events: ServerEvent[]): void {
    for (const e of events) this.applyOne(e);
    this.pruneTransient();
    this.notify();
    for (const e of events) for (const l of this.eventListeners) l(e);
  }

  private upsertTask(task: TaskInfo): void {
    const tasks = this.state.tasks.filter((t) => t.id !== task.id);
    tasks.push(task);
    const live = tasks.filter((t) => t.status === 'queued' || t.status === 'active');
    const finished = tasks
      .filter((t) => !live.includes(t))
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, MAX_FINISHED_TASKS);
    this.set({ tasks: [...live, ...finished] });
  }

  private applyOne(e: ServerEvent): void {
    switch (e.type) {
      case 'HELLO':
        this.set({ clientId: e.payload.clientId, config: e.payload.config });
        break;
      case 'STATE_SNAPSHOT': {
        const p = e.payload;
        this.clock.sync(p.clock, performance.now());
        const agents: Record<AgentId, AgentState> = {};
        for (const a of p.agents) agents[a.agentId] = a;
        this.set({
          agents,
          agentOrder: p.agents.map((a) => a.agentId),
          tasks: p.taskQueue,
          logs: p.logs.slice(-MAX_LOGS),
          logEpoch: this.state.logEpoch + 1,
          results: p.results,
          dialogues: p.dialogues,
          fx: p.fx,
          world: p.world,
          clients: p.clients,
          projects: p.projects,
          run: p.run,
          input: p.run?.waitingInput ?? null,
        });
        break;
      }
      case 'CLOCK':
        this.clock.sync(e.payload, performance.now());
        break;
      case 'AGENT_STATE': {
        const a = e.payload;
        const known = a.agentId in this.state.agents;
        this.set({
          agents: { ...this.state.agents, [a.agentId]: a },
          agentOrder: known ? this.state.agentOrder : [...this.state.agentOrder, a.agentId],
        });
        break;
      }
      case 'AGENT_MOVE': {
        const prev = this.state.agents[e.payload.agentId];
        if (!prev) break;
        const [x, y] = e.payload.path[0] ?? [prev.x, prev.y];
        this.set({
          agents: {
            ...this.state.agents,
            [prev.agentId]: {
              ...prev,
              x,
              y,
              move: { path: e.payload.path, startClock: e.payload.startClock, speed: e.payload.speed },
            },
          },
        });
        break;
      }
      case 'DIALOGUE':
        this.set({ dialogues: [...this.state.dialogues.filter((d) => d.from !== e.payload.from), e.payload] });
        break;
      case 'LOG':
        this.set({ logs: [...this.state.logs, e.payload].slice(-MAX_LOGS) });
        break;
      case 'TASK_UPDATE':
        this.upsertTask(e.payload.task);
        break;
      case 'RESULT':
        this.set({ results: [e.payload, ...this.state.results.filter((r) => r.taskId !== e.payload.taskId)].slice(0, 25) });
        break;
      case 'FX':
        this.set({ fx: [...this.state.fx, e.payload] });
        break;
      case 'AMBIENT':
        this.set({ world: e.payload.world });
        break;
      case 'CLIENTS':
        this.set({ clients: e.payload.count });
        break;
      case 'RUN_STATE':
        this.set({ run: e.payload, input: e.payload.waitingInput ?? (this.state.input?.taskId === e.payload.taskId ? null : this.state.input) });
        break;
      case 'INPUT_REQUEST':
        this.set({ input: e.payload });
        break;
      case 'INPUT_DONE':
        if (this.state.input && this.state.input.taskId === e.payload.taskId && this.state.input.requestId === e.payload.requestId) this.set({ input: null });
        break;
      case 'PROJECTS':
        this.set({ projects: e.payload.projects });
        break;
      case 'NOTICE':
        this.set({ notices: [...this.state.notices, { id: noticeSeq++, ...e.payload }].slice(-5) });
        break;
    }
  }

  /** Drops bubbles and effects that ended (sim time based, identical on every client). */
  private pruneTransient(): void {
    const now = this.simNow();
    const dialogues = this.state.dialogues.filter((d) => d.startClock + d.duration > now - 500);
    const fx = this.state.fx.filter((f) => f.startClock + f.duration > now - 500);
    if (dialogues.length !== this.state.dialogues.length || fx.length !== this.state.fx.length) {
      this.set({ dialogues, fx });
    }
  }
}

export const worldStore = new WorldStore();

export function useWorld<T>(selector: (s: ClientWorld) => T): T {
  return useSyncExternalStore(worldStore.subscribe, () => selector(worldStore.state));
}
