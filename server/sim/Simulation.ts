// THE HEART. One authoritative simulation: clock, agents, task queue, world props, logs.
// Each tick: process commands from all clients, pump the running program's I/O, update the task
// director and idle behaviors, update agents, collect the events of the tick and flush them to
// EVERY client as one frame. It never stops; late joiners get a STATE_SNAPSHOT.

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { makeEvent, type AmbientKind, type ClientCommand, type ServerEvent } from '../../shared/events';
import {
  APP_VERSION,
  CLOCK_SYNC_MS,
  LOG_BACKLOG,
  MAX_FILE_BYTES,
  MAX_PER_FILE_BYTES,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  PROP_FRAME_MS,
  RESULT_BACKLOG,
} from '../../shared/constants';
import { normalizeSetupLines, parseCommand, parseSetup, targetLabel, type ParsedCommand } from '../../shared/commands';
import { propFrameAt } from '../../shared/clock';
import { AGENT_DEFS, ASSISTANT_ID, HACKER_ID } from '../../shared/agents';
import type { StationId } from '../../shared/officeLayout';
import { Pathfinder } from '../../shared/pathfinding';
import {
  TASK_STEPS,
  type AgentId,
  type BubbleKind,
  type ClockInfo,
  type CodeKind,
  type DialogueInfo,
  type FxEvent,
  type FxType,
  type LogChannel,
  type LogEntry,
  type LogLevel,
  type MoveState,
  type Priority,
  type ResultInfo,
  type ServerConfig,
  type TaskInfo,
  type TaskStep,
  type WorldProps,
} from '../../shared/types';
import { Agent, type AgentHost } from './Agent';
import { IdleBehaviors } from './behaviors';
import { createRng, type Rng } from './rng';
import { TaskDirector, type QueuedTask } from './TaskDirector';
import type { EventSource, LifecycleSink, TaskInput } from './sources';
import type { TaskRunner } from '../runners/TaskRunner';
import type { ProjectStore } from '../projects';
import type { StoredCode } from '../upload';

/** Turns an upload id into stored code (UploadStore implements it). */
export interface CodeResolver {
  resolve(uploadId: string): StoredCode | null;
}

export interface SimulationOptions {
  tickRate?: number;
  /** Multiplies real time before the speed setting. Tests use it to fast forward. */
  timeScale?: number;
  seed?: number;
  /** The real work (default: none, set by the server: PythonRunner). */
  runner?: TaskRunner;
  uploads?: CodeResolver;
  projects?: ProjectStore;
  /** Running code is switched on (RUNROOM_RUN is not "off"). Default true. */
  runEnabled?: boolean;
  /** Idle behaviors and ambient events (tests switch them off for determinism). */
  idle?: boolean;
}

export type FlushHandler = (broadcast: ServerEvent[], direct: Map<string, ServerEvent[]>) => void;

const PRIORITY_RANK: Record<Priority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
const MAX_QUEUE = 25;
const KEEP_FINISHED = 6;
const GUEST_ONLY = 'you are watching as a guest: enter the admin password for full access (press ADMIN in the top bar)';

/** Where agents go when an external EventSource reports a step. */
const STEP_STATIONS: Record<TaskStep, { ghost?: StationId; byte?: StationId }> = {
  INTAKE: { byte: 'MAIL_DROP', ghost: 'DESK_GHOST' },
  HANDOVER: { byte: 'DESK_SIDE', ghost: 'DESK_GHOST' },
  SETUP: { byte: 'SERVER_CHECK', ghost: 'DESK_GHOST' },
  RUN: { ghost: 'DESK_GHOST', byte: 'DESK_SIDE' },
  DELIVER: { ghost: 'COMMAND_SCREEN', byte: 'MAIL_DROP' },
  COOLDOWN: { ghost: 'COFFEE' },
};

const NULL_RUNNER: TaskRunner = {
  name: 'none',
  async *setup() {
    yield { kind: 'error', text: 'no runner configured' };
    yield { kind: 'setup_done', ok: false, failed: 'setup', exitCode: null };
  },
  async *run() {
    yield { kind: 'error', text: 'no runner configured' };
  },
};

interface ResolvedCode {
  workDir: string;
  venvDir: string;
  codeName: string;
  codeKind: CodeKind;
  fileCount: number;
  projectId: string | null;
  projectName: string | null;
  savedSetup: string[] | null;
  savedRun: string | null;
  setupDone: boolean;
}

/** True when rel is an existing file or folder inside dir. */
function existsInside(dir: string, rel: string): boolean {
  const root = resolve(dir);
  const abs = resolve(root, rel);
  return abs.startsWith(root + sep) && existsSync(abs);
}

export class Simulation implements AgentHost {
  readonly tickRate: number;
  readonly timeScale: number;
  readonly runEnabled: boolean;
  readonly runner: TaskRunner;
  readonly rng: Rng;
  readonly pathfinder = new Pathfinder();
  /** e.g. "Python 3.12.0", filled in by the server once it found an interpreter. */
  python: string | null = null;
  /** An admin password is set, so full access needs logging in (set by the server). */
  passwordRequired = false;
  worldClock = 0;
  speed = 1;
  paused = false;

  readonly agents = new Map<AgentId, Agent>();
  world: WorldProps = {
    racksBusy: false,
    rackOverheat: null,
    mailbox: 'empty',
    monitorText: 'RUN ROOM ONLINE',
    // Ghost's PC is dark unless he is sitting at it for a task.
    deskScreen: 'off',
    catAwakeUntil: 0,
    lightningAt: -1,
    stats: { tasksDone: 0, tasksFailed: 0, tasksCancelled: 0 },
  };
  readonly tasks: QueuedTask[] = [];
  readonly logs: LogEntry[] = [];
  readonly results: ResultInfo[] = [];
  readonly dialogues: DialogueInfo[] = [];
  readonly fxList: FxEvent[] = [];
  readonly director: TaskDirector;
  readonly behaviors: IdleBehaviors | null;
  readonly projects: ProjectStore | null;

  private readonly uploads: CodeResolver | null;
  private timer: NodeJS.Timeout | null = null;
  private lastReal = 0;
  private lastClockSync = 0;
  private readonly commands: { clientId: string; command: ClientCommand }[] = [];
  private outbox: ServerEvent[] = [];
  private direct = new Map<string, ServerEvent[]>();
  private readonly flushHandlers: FlushHandler[] = [];
  private readonly dirtyAgents = new Set<AgentId>();
  private readonly canRun = new Map<string, boolean>();
  private clientCount = 0;
  private logSeq = 1;
  private fxSeq = 1;
  private dialogueSeq = 1;
  private taskSeq = 1;
  private external: EventSource | null = null;

  constructor(options: SimulationOptions = {}) {
    this.tickRate = options.tickRate ?? 60;
    this.timeScale = options.timeScale ?? 1;
    this.runEnabled = options.runEnabled ?? true;
    this.runner = options.runner ?? NULL_RUNNER;
    this.uploads = options.uploads ?? null;
    this.projects = options.projects ?? null;
    this.rng = createRng(options.seed ?? Date.now() & 0xffffffff);
    for (const def of AGENT_DEFS) this.agents.set(def.id, new Agent(def, this));
    // Hosts read the live world through a getter, so they always see the latest object.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sim = this;
    this.director = new TaskDirector({
      now: () => this.worldClock,
      hacker: this.hacker,
      assistant: this.assistant,
      get world() {
        return sim.world;
      },
      setWorld: (patch, kind) => this.setWorld(patch, kind),
      log: (level, source, text, channel) => this.log(level, source, text, channel),
      fx: (type, x, y, opts) => this.fx(type, x, y, opts),
      bubble: (agentId, text, kind, duration) => this.say(agentId, null, text, kind, duration, true),
      taskChanged: (task) => this.taskChanged(task),
      publishResult: (result) => this.publishResult(result),
      takeNextTask: () => this.takeNextTask(),
      runner: this.runner,
      runState: (state) => this.emit(makeEvent('RUN_STATE', state)),
      inputRequest: (req) => this.emit(makeEvent('INPUT_REQUEST', req)),
      inputDone: (done) => this.emit(makeEvent('INPUT_DONE', done)),
      setupFinished: (task, setup, ok) => {
        if (!task.projectId || !this.projects) return;
        this.projects.markSetup(task.projectId, setup, ok);
        this.emitProjects();
      },
      runFinished: (task, result) => {
        if (!task.projectId || !this.projects) return;
        this.projects.markRun(task.projectId, { taskId: task.id, ok: result.ok, exitCode: result.exitCode });
        this.emitProjects();
      },
    });
    this.behaviors =
      options.idle === false
        ? null
        : new IdleBehaviors({
            now: () => this.worldClock,
            rng: this.rng,
            hacker: this.hacker,
            assistant: this.assistant,
            get world() {
              return sim.world;
            },
            setWorld: (patch, kind) => this.setWorld(patch, kind),
            log: (level, source, text, channel) => this.log(level, source, text, channel),
            fx: (type, x, y, opts) => this.fx(type, x, y, opts),
            isWalkable: (x, y) => this.pathfinder.isWalkable(x, y),
            taskActive: () => this.director.active !== null,
          });
    this.log('info', 'SYSTEM', `RUN ROOM simulation online (${this.tickRate} ticks/s)`);
  }

  get hacker(): Agent {
    return this.agents.get(HACKER_ID)!;
  }

  get assistant(): Agent {
    return this.agents.get(ASSISTANT_ID)!;
  }

  config(clientId?: string): ServerConfig {
    const admin = clientId ? (this.canRun.get(clientId) ?? false) : false;
    return {
      version: APP_VERSION,
      runEnabled: this.runEnabled,
      canRun: this.runEnabled && admin,
      role: admin ? 'admin' : 'guest',
      passwordRequired: this.passwordRequired,
      python: this.python,
      limits: {
        maxFileBytes: MAX_FILE_BYTES,
        maxProjectBytes: MAX_PROJECT_BYTES,
        maxProjectFiles: MAX_PROJECT_FILES,
        maxPerFileBytes: MAX_PER_FILE_BYTES,
      },
      tickRate: this.tickRate,
      propFrameMs: PROP_FRAME_MS,
    };
  }

  /** Whether a viewer has admin (full) access and may run code (set by the server per connection). */
  setClientPermissions(clientId: string, canRun: boolean): void {
    this.canRun.set(clientId, canRun);
  }

  onFlush(handler: FlushHandler): void {
    this.flushHandlers.push(handler);
  }

  start(): void {
    if (this.timer) return;
    this.lastReal = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(250, now - this.lastReal);
      this.lastReal = now;
      this.step(dt);
    }, 1000 / this.tickRate);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.external?.stop();
    const active = this.director.activeTaskId;
    if (active) this.director.stop(active);
  }

  enqueueCommand(clientId: string, command: ClientCommand): void {
    this.commands.push({ clientId, command });
  }

  setClientCount(count: number): void {
    this.clientCount = count;
    this.emit(makeEvent('CLIENTS', { count }));
  }

  clientLeft(clientId: string): void {
    this.canRun.delete(clientId);
  }

  clockInfo(): ClockInfo {
    // Between ticks (e.g. a snapshot for a new viewer) extrapolate from the last tick so the
    // pair (worldClock, serverTime) is exact. Manual stepping (tests) has no running loop.
    const sinceTick = this.timer && !this.paused ? (performance.now() - this.lastReal) * this.timeScale * this.speed : 0;
    return {
      worldClock: this.worldClock + Math.max(0, sinceTick),
      speed: this.speed,
      paused: this.paused,
      serverTime: Date.now(),
      propAnimFrame: propFrameAt(this.worldClock),
    };
  }

  // --- the loop --------------------------------------------------------------------------------

  /** Advances the simulation by dtReal real milliseconds and flushes the events of this tick. */
  step(dtReal: number): void {
    this.processCommands();
    // The running program's output and input prompts keep flowing even while paused.
    if (!this.external) this.director.pumpIo();
    const dt = this.paused ? 0 : dtReal * this.timeScale * this.speed;
    if (dt > 0) {
      this.worldClock += dt;
      if (!this.external) this.director.update(dt);
      this.behaviors?.update();
      for (const a of this.agents.values()) a.update(dt);
      this.pruneTransient();
    }
    this.lastClockSync += dtReal;
    if (this.lastClockSync >= CLOCK_SYNC_MS) {
      this.lastClockSync = 0;
      this.emit(makeEvent('CLOCK', this.clockInfo()));
    }
    for (const id of this.dirtyAgents) this.emit(makeEvent('AGENT_STATE', this.agents.get(id)!.toState()));
    this.dirtyAgents.clear();
    this.flush();
  }

  // --- AgentHost --------------------------------------------------------------------------------

  now(): number {
    return this.worldClock;
  }

  findPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    return this.pathfinder.find(from, to);
  }

  agentChanged(agent: Agent): void {
    this.dirtyAgents.add(agent.id);
  }

  agentMoved(agent: Agent, move: MoveState): void {
    this.emit(makeEvent('AGENT_MOVE', { agentId: agent.id, path: move.path, startClock: move.startClock, speed: move.speed }));
    this.dirtyAgents.add(agent.id);
  }

  /** A speech or thought bubble. Speech is echoed into the terminal unless quiet. */
  say(from: AgentId, to: AgentId | null, text: string, kind: BubbleKind, duration: number, quiet = false): void {
    const d: DialogueInfo = { id: `d${this.dialogueSeq++}`, from, to, text, duration, kind, startClock: this.worldClock };
    const i = this.dialogues.findIndex((x) => x.from === from);
    if (i >= 0) this.dialogues.splice(i, 1);
    this.dialogues.push(d);
    this.emit(makeEvent('DIALOGUE', d));
    if (kind === 'speech' && !quiet) {
      const name = this.agents.get(from)?.def.name ?? from.toUpperCase();
      this.log('info', name, `${name}: "${text}"`, 'chat');
    }
  }

  levelUp(agent: Agent): void {
    const p = agent.position();
    this.fx('spark', p.x * 16 + 8, p.y * 16 - 10, { duration: 900 });
    this.log('success', agent.def.name, `${agent.def.name} reached LEVEL ${agent.level}`, 'chat');
  }

  // --- world helpers -----------------------------------------------------------------------------

  setWorld(patch: Partial<WorldProps>, kind: AmbientKind): void {
    this.world = { ...this.world, ...patch };
    this.emit(makeEvent('AMBIENT', { type: kind, world: this.world }));
  }

  log(level: LogLevel, source: string, text: string, channel: LogChannel = 'system'): void {
    const entry: LogEntry = { id: this.logSeq++, level, source, text: text.slice(0, 2000), timestamp: Date.now(), channel };
    this.logs.push(entry);
    if (this.logs.length > LOG_BACKLOG) this.logs.splice(0, this.logs.length - LOG_BACKLOG);
    this.emit(makeEvent('LOG', entry));
  }

  fx(type: FxType, x: number, y: number, opts: { toX?: number; toY?: number; duration?: number } = {}): void {
    const ev: FxEvent = {
      id: `f${this.fxSeq++}`,
      type,
      x: Math.round(x),
      y: Math.round(y),
      ...(opts.toX !== undefined ? { toX: Math.round(opts.toX), toY: Math.round(opts.toY ?? y) } : {}),
      startClock: this.worldClock,
      duration: opts.duration ?? 1000,
    };
    this.fxList.push(ev);
    this.emit(makeEvent('FX', ev));
  }

  private pruneTransient(): void {
    const now = this.worldClock;
    for (let i = this.dialogues.length - 1; i >= 0; i--) {
      if (this.dialogues[i].startClock + this.dialogues[i].duration < now) this.dialogues.splice(i, 1);
    }
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      if (this.fxList[i].startClock + this.fxList[i].duration < now) this.fxList.splice(i, 1);
    }
  }

  // --- tasks --------------------------------------------------------------------------------------

  private taskChanged(task: TaskInfo): void {
    this.emit(
      makeEvent('TASK_UPDATE', {
        taskId: task.id,
        status: task.status,
        stepIndex: task.stepIndex,
        steps: task.steps,
        progress: task.progress,
        task: { ...task, stepProgress: [...task.stepProgress], setup: [...task.setup] },
      }),
    );
    if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') this.trimFinished();
  }

  private trimFinished(): void {
    const finished = this.tasks.filter((t) => ['done', 'failed', 'cancelled'].includes(t.info.status));
    const excess = finished.length - KEEP_FINISHED;
    if (excess <= 0) return;
    finished
      .sort((a, b) => (a.info.finishedAt ?? 0) - (b.info.finishedAt ?? 0))
      .slice(0, excess)
      .forEach((t) => this.tasks.splice(this.tasks.indexOf(t), 1));
  }

  private publishResult(result: ResultInfo): void {
    this.results.unshift(result);
    if (this.results.length > RESULT_BACKLOG) this.results.length = RESULT_BACKLOG;
    this.emit(makeEvent('RESULT', result));
  }

  /** Next queued task: HIGH before NORMAL before LOW, FIFO within a priority. */
  private takeNextTask(): QueuedTask | null {
    const queued = this.tasks.filter((t) => t.info.status === 'queued');
    if (!queued.length) return null;
    queued.sort((a, b) => PRIORITY_RANK[a.info.priority] - PRIORITY_RANK[b.info.priority] || a.info.createdAt - b.info.createdAt);
    return queued[0];
  }

  private liveTasks(): QueuedTask[] {
    return this.tasks.filter((t) => t.info.status === 'queued' || t.info.status === 'active');
  }

  private mayRun(clientId: string | undefined): string | null {
    if (!this.runEnabled) return 'running code is switched off on this server (RUNROOM_RUN=off)';
    if (clientId !== undefined && !this.canRun.get(clientId)) return GUEST_ONLY;
    return null;
  }

  /** Admin (full access). In open mode every connection is admin; a true guest is not. */
  private isAdmin(clientId: string): boolean {
    return this.canRun.get(clientId) ?? false;
  }

  private codeFromProject(projectId: string): ResolvedCode | null {
    const p = this.projects?.get(projectId);
    if (!p) return null;
    return {
      workDir: p.filesDir,
      venvDir: p.venvDir,
      codeName: p.name,
      codeKind: p.kind,
      fileCount: p.fileCount,
      projectId: p.id,
      projectName: p.name,
      savedSetup: p.setup,
      savedRun: p.run,
      setupDone: p.setupDone,
    };
  }

  private codeFromUpload(up: StoredCode): ResolvedCode {
    return {
      workDir: up.filesDir,
      venvDir: up.venvDir,
      codeName: up.name,
      codeKind: up.kind,
      fileCount: up.fileCount,
      projectId: null,
      projectName: null,
      savedSetup: null,
      savedRun: null,
      setupDone: false,
    };
  }

  /** Parses and checks setup and run commands against the code folder. */
  private checkCommands(workDir: string, codeName: string, setupLines: string[], runText: string): { setup: ParsedCommand[]; run: ParsedCommand } | { error: string } {
    const setup = parseSetup(setupLines);
    if ('error' in setup) return { error: setup.error };
    const run = parseCommand(runText, 'run');
    if ('error' in run) return { error: `run command: ${run.error}` };
    if (run.target?.mode === 'file' && !existsInside(workDir, run.target.path)) {
      return { error: `there is no ${run.target.path} in ${codeName}: check the run command` };
    }
    return { setup, run };
  }

  /** Entry point for every TaskSource (the WebSocket RUN box uses it too). */
  submitTask(input: TaskInput): { taskId: string; projectId: string | null } | { error: string } {
    const denied = this.mayRun(input.clientId);
    if (denied) return { error: denied };
    if (this.liveTasks().length >= MAX_QUEUE) return { error: `queue full (${MAX_QUEUE} runs)` };

    let code: ResolvedCode | null;
    let upload: StoredCode | null = null;
    if (input.source.kind === 'upload') {
      upload = this.uploads?.resolve(input.source.uploadId) ?? null;
      if (!upload) return { error: 'the uploaded code is gone, pick it again' };
      code = this.codeFromUpload(upload);
    } else {
      code = this.codeFromProject(input.source.projectId);
      if (!code) return { error: 'that saved project does not exist any more' };
    }

    const setupLines = input.setup !== undefined ? normalizeSetupLines(input.setup) : (code.savedSetup ?? []);
    const runText = (input.run ?? code.savedRun ?? '').trim();
    if (!runText) return { error: 'type the run command, e.g. python main.py' };
    const checked = this.checkCommands(code.workDir, code.codeName, setupLines, runText);
    if ('error' in checked) return checked;

    if (input.saveAs && upload) {
      if (!this.projects) return { error: 'saving projects is not available on this server' };
      const saved = this.projects.create({
        name: input.saveAs,
        kind: upload.kind,
        sourceDir: upload.filesDir,
        entry: upload.entry,
        fileCount: upload.fileCount,
        totalBytes: upload.totalBytes,
        setup: setupLines,
        run: checked.run.text,
        overwrite: input.overwrite,
      });
      if ('error' in saved) return saved;
      this.log('info', 'SYSTEM', `saved project "${saved.name}" (${saved.fileCount} file(s))`);
      this.emitProjects();
      code = this.codeFromProject(saved.id)!;
    }

    const sameAsSaved = code.savedSetup !== null && JSON.stringify(setupLines) === JSON.stringify(code.savedSetup);
    const setupCached = Boolean(code.projectId && setupLines.length > 0 && sameAsSaved && code.setupDone && !input.forceSetup);
    const id = `T${String(this.taskSeq++).padStart(3, '0')}`;
    const info: TaskInfo = {
      id,
      title: `RUN ${targetLabel(checked.run)}`.slice(0, 60),
      priority: input.priority,
      status: 'queued',
      stepIndex: 0,
      steps: [...TASK_STEPS],
      progress: 0,
      stepProgress: TASK_STEPS.map(() => 0),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      note: 'IN QUEUE',
      codeName: code.codeName,
      codeKind: code.codeKind,
      fileCount: code.fileCount,
      projectId: code.projectId,
      projectName: code.projectName,
      setup: setupLines,
      setupCached,
      run: checked.run.text,
      exitCode: null,
      runner: null,
    };
    this.tasks.push({ info, workDir: code.workDir, venvDir: code.venvDir, setup: setupCached ? [] : checked.setup, run: checked.run });
    this.taskChanged(info);
    this.log('info', 'SYSTEM', `queued ${id} [${info.priority}]: ${checked.run.text} (${code.codeName})`);
    return { taskId: id, projectId: code.projectId };
  }

  /** Saves an upload with its commands as a project, without running it. */
  saveProject(clientId: string | undefined, p: { uploadId: string; name: string; setup: string[]; run: string; overwrite?: boolean }): { projectId: string } | { error: string } {
    const denied = this.mayRun(clientId);
    if (denied) return { error: denied };
    if (!this.projects) return { error: 'saving projects is not available on this server' };
    const up = this.uploads?.resolve(p.uploadId);
    if (!up) return { error: 'the uploaded code is gone, pick it again' };
    const setupLines = normalizeSetupLines(p.setup);
    const checked = this.checkCommands(up.filesDir, up.name, setupLines, p.run);
    if ('error' in checked) return checked;
    const saved = this.projects.create({
      name: p.name,
      kind: up.kind,
      sourceDir: up.filesDir,
      entry: up.entry,
      fileCount: up.fileCount,
      totalBytes: up.totalBytes,
      setup: setupLines,
      run: checked.run.text,
      overwrite: p.overwrite,
    });
    if ('error' in saved) return saved;
    this.log('info', 'SYSTEM', `saved project "${saved.name}" (${saved.fileCount} file(s))`);
    this.emitProjects();
    return { projectId: saved.id };
  }

  updateProject(clientId: string | undefined, p: { projectId: string; name?: string; setup?: string[]; run?: string }): { ok: true } | { error: string } {
    const denied = this.mayRun(clientId);
    if (denied) return { error: denied };
    const current = this.projects?.get(p.projectId);
    if (!this.projects || !current) return { error: 'that project does not exist any more' };
    const setupLines = p.setup !== undefined ? normalizeSetupLines(p.setup) : current.setup;
    const checked = this.checkCommands(current.filesDir, current.name, setupLines, p.run ?? current.run);
    if ('error' in checked) return checked;
    const r = this.projects.update(p.projectId, { name: p.name, setup: p.setup !== undefined ? setupLines : undefined, run: p.run !== undefined ? checked.run.text : undefined });
    if ('error' in r) return r;
    this.emitProjects();
    return { ok: true };
  }

  deleteProject(clientId: string | undefined, projectId: string): { ok: true } | { error: string } {
    const denied = this.mayRun(clientId);
    if (denied) return { error: denied };
    if (this.liveTasks().some((t) => t.info.projectId === projectId)) return { error: 'that project is queued or running: stop it first' };
    const p = this.projects?.get(projectId);
    if (!this.projects || !p) return { error: 'that project does not exist any more' };
    this.projects.remove(projectId);
    this.log('info', 'SYSTEM', `deleted project "${p.name}"`);
    this.emitProjects();
    return { ok: true };
  }

  private emitProjects(): void {
    this.emit(makeEvent('PROJECTS', { projects: this.projects?.list() ?? [] }));
  }

  cancelTask(taskId: string): boolean {
    const t = this.tasks.find((x) => x.info.id === taskId);
    if (!t) return false;
    if (t.info.status === 'active') {
      const r = this.director.stop(taskId);
      if (!r) return false;
      if (r === 'stopping') return true;
    } else if (t.info.status === 'queued') {
      t.info.status = 'cancelled';
      t.info.note = 'CANCELLED';
      t.info.finishedAt = Date.now();
      this.taskChanged(t.info);
      this.log('warn', 'SYSTEM', `task ${taskId} removed from the queue`);
    } else {
      return false;
    }
    this.world = { ...this.world, stats: { ...this.world.stats, tasksCancelled: this.world.stats.tasksCancelled + 1 } };
    this.emit(makeEvent('AMBIENT', { type: 'stats', world: this.world }));
    return true;
  }

  // --- commands -----------------------------------------------------------------------------------

  private processCommands(): void {
    while (this.commands.length > 0) {
      const { clientId, command } = this.commands.shift()!;
      this.handle(clientId, command);
    }
  }

  private notice(clientId: string, level: 'info' | 'warn' | 'error', text: string): void {
    this.sendTo(clientId, makeEvent('NOTICE', { level, text }));
  }

  private handle(clientId: string, command: ClientCommand): void {
    // Guests only watch: every command except asking for a fresh snapshot needs admin.
    if (command.type !== 'REQUEST_SNAPSHOT' && !this.isAdmin(clientId)) {
      this.notice(clientId, 'error', GUEST_ONLY);
      return;
    }
    switch (command.type) {
      case 'SUBMIT_TASK': {
        const r = this.submitTask({ ...command.payload, clientId });
        if ('error' in r) this.notice(clientId, 'error', r.error);
        break;
      }
      case 'SAVE_PROJECT': {
        const r = this.saveProject(clientId, command.payload);
        this.notice(clientId, 'error' in r ? 'error' : 'info', 'error' in r ? r.error : `saved "${command.payload.name}"`);
        break;
      }
      case 'UPDATE_PROJECT': {
        const r = this.updateProject(clientId, command.payload);
        if ('error' in r) this.notice(clientId, 'error', r.error);
        break;
      }
      case 'DELETE_PROJECT': {
        const r = this.deleteProject(clientId, command.payload.projectId);
        if ('error' in r) this.notice(clientId, 'error', r.error);
        break;
      }
      case 'PROVIDE_INPUT': {
        const denied = this.mayRun(clientId);
        if (denied) {
          this.notice(clientId, 'error', denied);
          break;
        }
        const p = command.payload;
        const r = this.director.provideInput(clientId, p.taskId, p.requestId, p.value, p.eof === true);
        if ('error' in r) this.notice(clientId, 'warn', r.error);
        break;
      }
      case 'CANCEL_TASK': {
        const denied = this.mayRun(clientId);
        if (denied) {
          this.notice(clientId, 'error', denied);
          break;
        }
        if (!this.cancelTask(command.payload.taskId)) this.notice(clientId, 'warn', `cannot stop ${command.payload.taskId}`);
        break;
      }
      case 'PAUSE':
        if (!this.paused) {
          this.paused = true;
          this.log('info', 'SYSTEM', 'simulation PAUSED (a running program keeps running)');
        }
        this.emit(makeEvent('CLOCK', this.clockInfo()));
        break;
      case 'RESUME':
        if (this.paused) {
          this.paused = false;
          this.log('info', 'SYSTEM', 'simulation RESUMED');
        }
        this.emit(makeEvent('CLOCK', this.clockInfo()));
        break;
      case 'SET_SPEED':
        if (this.speed !== command.payload.multiplier) {
          this.speed = command.payload.multiplier;
          this.log('info', 'SYSTEM', `sim speed ${this.speed}x`);
        }
        this.emit(makeEvent('CLOCK', this.clockInfo()));
        break;
      case 'GIVE_COFFEE': {
        const byte = this.assistant;
        if (!this.behaviors) break;
        const errand = this.behaviors.coffeeErrand(byte, 'request');
        if (!byte.reserved) byte.plan(errand);
        else byte.errands.push(errand);
        this.log('info', 'SYSTEM', `coffee ordered for GHOST${byte.reserved ? ' (BYTE will go after the current errand)' : ''}`);
        break;
      }
      case 'PET_CAT':
        this.behaviors?.wakeCat(6000, 'VIEWER');
        break;
      case 'REQUEST_SNAPSHOT':
        this.sendTo(clientId, ...this.snapshotEvents());
        break;
    }
  }

  // --- external lifecycle driver ------------------------------------------------------------------

  /** Replace the built-in simulated lifecycle with an external EventSource. */
  useEventSource(source: EventSource): void {
    this.external?.stop();
    this.external = source;
    const find = (id: string) => this.tasks.find((t) => t.info.id === id);
    const sink: LifecycleSink = {
      step: (taskId, step, progress = 0) => {
        const t = find(taskId);
        if (!t) return;
        const idx = TASK_STEPS.indexOf(step);
        if (t.info.status === 'queued') {
          t.info.status = 'active';
          t.info.startedAt = Date.now();
        }
        if (idx !== t.info.stepIndex) {
          for (let i = 0; i < idx; i++) t.info.stepProgress[i] = 1;
          const where = STEP_STATIONS[step];
          if (where.ghost) this.hacker.plan([{ kind: 'goto', station: where.ghost }]);
          if (where.byte) this.assistant.plan([{ kind: 'goto', station: where.byte }]);
          this.hacker.reserved = this.assistant.reserved = true;
        }
        t.info.stepIndex = idx;
        t.info.stepProgress[idx] = progress;
        t.info.progress = t.info.stepProgress.reduce((a, b) => a + b, 0) / TASK_STEPS.length;
        this.taskChanged(t.info);
      },
      log: (level, source, text) => this.log(level, source, text, 'runner'),
      say: (agentId, text, kind = 'speech') => this.say(agentId, null, text, kind, Math.max(1800, text.length * 70)),
      result: (r) => {
        const t = find(r.taskId);
        if (t) {
          t.info.status = r.ok ? 'done' : 'failed';
          t.info.progress = 1;
          t.info.finishedAt = Date.now();
          this.taskChanged(t.info);
        }
        this.hacker.reserved = this.assistant.reserved = false;
        this.publishResult({ ...r, createdAt: Date.now() });
      },
    };
    source.start(sink);
    this.log('info', 'SYSTEM', `lifecycle driven by external event source "${source.name}"`);
  }

  // --- snapshot & output ------------------------------------------------------------------------

  snapshotEvents(): ServerEvent[] {
    const live = this.liveTasks();
    const finished = this.tasks.filter((t) => !live.includes(t)).slice(-KEEP_FINISHED);
    return [
      makeEvent('STATE_SNAPSHOT', {
        agents: [...this.agents.values()].map((a) => a.toState()),
        taskQueue: [...live, ...finished].map((t) => ({ ...t.info, stepProgress: [...t.info.stepProgress], setup: [...t.info.setup] })),
        worldClock: this.worldClock,
        propAnimFrame: propFrameAt(this.worldClock),
        clock: this.clockInfo(),
        world: this.world,
        logs: this.logs.slice(-LOG_BACKLOG),
        results: [...this.results],
        dialogues: [...this.dialogues],
        fx: [...this.fxList],
        clients: this.clientCount,
        projects: this.projects?.list() ?? [],
        run: this.director.runState,
      }),
    ];
  }

  private emit(event: ServerEvent): void {
    this.outbox.push(event);
  }

  private sendTo(clientId: string, ...events: ServerEvent[]): void {
    const list = this.direct.get(clientId) ?? [];
    list.push(...events);
    this.direct.set(clientId, list);
  }

  private flush(): void {
    if (this.outbox.length === 0 && this.direct.size === 0) return;
    const out = this.outbox;
    const direct = this.direct;
    this.outbox = [];
    this.direct = new Map();
    for (const h of this.flushHandlers) h(out, direct);
  }
}
