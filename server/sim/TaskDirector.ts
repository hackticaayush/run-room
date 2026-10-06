// Drives one run at a time through the visible lifecycle:
//   INTAKE -> HANDOVER -> SETUP -> RUN -> DELIVER -> COOLDOWN
//
// The PC rule: when a run arrives Ghost first walks to his PC; nothing counts as started until he
// is seated there. Byte brings the code to the PC. Setup commands only start once Byte stands at
// the server racks (he installs the packages there), and the program itself only starts once
// Ghost is seated at the PC. When it ends he stands up, the screen goes dark and he walks to the
// Command Center wall, where the result goes up. He does not come back to the PC for that run.
//
// While the program runs, the runner streams function calls and returns. They become Ghost's
// thought and speech bubbles (throttled), TRACE lines in the terminal and the shared run monitor
// (current function, call stack, return types). When the program asks for input, every viewer
// gets the prompt; the first answer goes to the program's stdin.
//
// Each phase hands both agents a plan that ends by raising a flag; a phase completes when its
// flags are raised plus phase specific conditions (the setup or the program finished).

import { STATIONS, type StationId } from '../../shared/officeLayout';
import { TILE } from '../../shared/constants';
import type { ParsedCommand } from '../../shared/commands';
import { clip, sanitizeDisplay } from '../../shared/display';
import type { AmbientKind } from '../../shared/events';
import {
  TASK_STEPS,
  type AgentId,
  type BubbleKind,
  type FxType,
  type InputRequest,
  type LogChannel,
  type LogLevel,
  type ResultInfo,
  type RunOutcome,
  type RunPhase,
  type RunState,
  type TaskInfo,
  type TaskStep,
  type WorldProps,
} from '../../shared/types';
import type { Agent, Action } from './Agent';
import { InputBridge, type ResultEvent, type RunnerEvent, type RunnerTask, type TaskRunner } from '../runners/TaskRunner';

export interface QueuedTask {
  info: TaskInfo;
  /** Absolute folder with the code (never client supplied). */
  workDir: string;
  venvDir: string;
  /** Setup commands that will run in SETUP ([] = nothing to do). */
  setup: ParsedCommand[];
  run: ParsedCommand;
}

export interface InputDone {
  taskId: string;
  requestId: number;
  by: string | null;
  shown: string | null;
  cancelled: boolean;
}

export interface DirectorHost {
  now(): number;
  hacker: Agent;
  assistant: Agent;
  world: WorldProps;
  setWorld(patch: Partial<WorldProps>, kind: AmbientKind): void;
  log(level: LogLevel, source: string, text: string, channel?: LogChannel): void;
  fx(type: FxType, x: number, y: number, opts?: { toX?: number; toY?: number; duration?: number }): void;
  /** A bubble that is not echoed into the terminal (the TRACE lines carry the details). */
  bubble(agentId: AgentId, text: string, kind: BubbleKind, duration: number): void;
  taskChanged(task: TaskInfo): void;
  publishResult(result: ResultInfo): void;
  takeNextTask(): QueuedTask | null;
  runner: TaskRunner;
  runState(state: RunState): void;
  inputRequest(request: InputRequest): void;
  inputDone(done: InputDone): void;
  /** Bookkeeping for saved projects. */
  setupFinished(task: TaskInfo, setup: string[], ok: boolean): void;
  runFinished(task: TaskInfo, result: ResultInfo): void;
}

const PHASE_TIMEOUT_MS = 90000;
const RUN_MIN_MS = 1500;
/** After an uncaught exception Ghost facepalms at the red screen this long before he gets up. */
const CRASH_BEAT_MS = 2200;
/** Sim ms between Ghost's bubbles while the program runs (and Byte's output read outs). */
const GHOST_BUBBLE_MS = 1700;
const BYTE_BUBBLE_MS = 4500;
const ACTIVITY_MS = 700;
/** Terminal lines per real second (the report has everything). */
const OUTPUT_LINES_PER_SEC = 40;
const TRACE_LINES_PER_SEC = 8;
/** Real ms between RUN_STATE broadcasts. */
const RUN_STATE_EVERY_MS = 200;
const WALL_EVERY_MS = 1500;

/** Time based progress estimates (sim ms) for phases without explicit milestones. */
const ESTIMATE: Record<TaskStep, number> = {
  INTAKE: 7000,
  HANDOVER: 8000,
  SETUP: 30000,
  RUN: 15000,
  DELIVER: 14000,
  COOLDOWN: 9000,
};

const HOT_RACK = 3;

class RunnerHandle {
  readonly buffer: RunnerEvent[] = [];
  finished = false;
  readonly startedReal = performance.now();
  finishedReal = 0;

  constructor(stream: AsyncIterable<RunnerEvent>) {
    void (async () => {
      try {
        for await (const ev of stream) {
          if (this.finished) break;
          this.buffer.push(ev);
        }
      } catch (err) {
        if (!this.finished) this.buffer.push({ kind: 'error', text: `the runner crashed: ${(err as Error).message}` });
      } finally {
        if (!this.finished) {
          this.finished = true;
          this.finishedReal = performance.now();
        }
      }
    })();
  }

  /** Gives up on a runner that ignores its abort signal. */
  forceStop(reason: string): void {
    if (this.finished) return;
    this.buffer.push({ kind: 'error', text: reason });
    this.finished = true;
    this.finishedReal = performance.now();
  }

  get runtimeMs(): number {
    return Math.round((this.finished ? this.finishedReal : performance.now()) - this.startedReal);
  }
}

interface LineWindow {
  start: number;
  count: number;
  dropped: number;
}

interface ActiveTask {
  q: QueuedTask;
  info: TaskInfo;
  phase: TaskStep;
  phaseIndex: number;
  phaseStart: number;
  flags: Set<string>;
  need: string[];
  /** Explicit progress for milestone driven phases (INTAKE). */
  milestone: number;
  abort: AbortController;
  input: InputBridge;
  setupHandle: RunnerHandle | null;
  setupOk: boolean | null;
  setupFailed: string | null;
  setupTail: string[];
  runHandle: RunnerHandle | null;
  runStarted: boolean;
  stopRequested: boolean;
  stopAt: number;
  result: ResultEvent | null;
  run: RunState;
  runDirty: boolean;
  lastRunEmit: number;
  pendingInput: InputRequest | null;
  outputTail: string[];
  outWindow: LineWindow;
  traceWindow: LineWindow;
  ghostBubbleAt: number;
  byteBubbleAt: number;
  /** Sim clock until which each agent's last director bubble is visible. */
  ghostBubbleUntil: number;
  byteBubbleUntil: number;
  activityAt: number;
  wallAt: number;
  wallFn: string;
  lastCall: { fn: string; args: string; at: number } | null;
  lastReturn: { fn: string; type: string; value: string; at: number } | null;
  shownCallAt: number;
  shownReturnAt: number;
  lastBubble: BubbleKind;
  lastOutput: { text: string; at: number } | null;
  shownOutputAt: number;
  published: boolean;
  lastProgressAt: number;
}

const clean = (t: string, max = 300) => sanitizeDisplay(t, max);

/** "<module>" means the top level code of a file. */
function fnLabel(fn: string): string {
  return fn === '<module>' ? 'top level' : fn;
}

export class TaskDirector {
  active: ActiveTask | null = null;
  /** The last run's monitor state, kept for viewers that join later. */
  private lastRun: RunState | null = null;

  constructor(private readonly host: DirectorHost) {}

  get activeTaskId(): string | null {
    return this.active?.info.id ?? null;
  }

  /** The current run's monitor state, or the last one. */
  get runState(): RunState | null {
    return this.active?.run ?? this.lastRun;
  }

  get pendingInput(): InputRequest | null {
    return this.active?.pendingInput ?? null;
  }

  // ---------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) {
      const next = this.host.takeNextTask();
      if (next) this.begin(next);
      return;
    }
    const t = this.active;
    const now = this.host.now();
    if (t.stopRequested && t.runHandle && !t.runHandle.finished && performance.now() - t.stopAt > 15000) {
      t.runHandle.forceStop('the program did not stop in time and was abandoned');
    }
    const busy =
      (t.phase === 'SETUP' && t.setupHandle !== null && !t.setupHandle.finished) ||
      (t.phase === 'RUN' && t.runStarted && !this.runDone(t)) ||
      t.pendingInput !== null;
    const timedOut = !busy && now - t.phaseStart > PHASE_TIMEOUT_MS;
    if (timedOut) this.host.log('warn', 'SYSTEM', `phase ${t.phase} timed out, moving on`);
    if (timedOut || this.phaseDone(t)) {
      this.advance(t);
      return;
    }
    if (now - t.lastProgressAt >= 250 && dt > 0) this.emitProgress(t, now);
  }

  /** Runner I/O: called every tick, also while the simulation is paused. */
  pumpIo(): void {
    const t = this.active;
    if (!t) return;
    if (t.setupHandle) while (t.setupHandle.buffer.length) this.onEvent(t, t.setupHandle.buffer.shift()!, 'setup');
    if (t.runHandle) while (t.runHandle.buffer.length) this.onEvent(t, t.runHandle.buffer.shift()!, 'run');
    this.closeWindow(t.outWindow, (n) => this.host.log('info', 'SYSTEM', `... ${n} more output line(s) not shown here (the result report has them)`, 'stdout'));
    this.closeWindow(t.traceWindow, () => {});
    this.react(t);
    if (t.runDirty && performance.now() - t.lastRunEmit >= RUN_STATE_EVERY_MS) this.emitRun(t);
  }

  /**
   * STOP / CANCEL from a viewer. While the program runs it is killed and the crew finishes the
   * story with a STOPPED report; before that the whole task is cancelled.
   */
  stop(taskId: string): 'stopping' | 'cancelled' | false {
    const t = this.active;
    if (!t || t.info.id !== taskId || t.published) return false;
    if (t.phase === 'RUN' && t.runStarted && !this.runDone(t)) {
      if (!t.stopRequested) {
        t.stopRequested = true;
        t.stopAt = performance.now();
        t.abort.abort();
        this.dropInput(t);
        t.info.note = 'STOPPING';
        this.host.taskChanged(t.info);
        this.speak(t, 'ghost', 'Stopping it.', 'speech', 1600, true);
        this.host.log('warn', 'SYSTEM', `task ${t.info.id}: STOP pressed, killing the program`);
      }
      return 'stopping';
    }
    this.cancelActive(t, 'cancelled');
    return 'cancelled';
  }

  /** Answer to the program's input request. */
  provideInput(clientId: string | null, taskId: string, requestId: number, value: string, eof: boolean): { ok: true } | { error: string } {
    const t = this.active;
    const req = t?.pendingInput;
    if (!t || t.info.id !== taskId || !req || req.requestId !== requestId) return { error: 'that question was already answered' };
    if (!t.input.provide(eof ? null : value)) return { error: 'the program is not running any more' };
    const shown = eof ? '(end of input)' : req.secret ? '*'.repeat(Math.max(3, Math.min(8, value.length))) : clean(value, 200);
    t.pendingInput = null;
    t.run.waitingInput = null;
    t.run.inputs++;
    this.emitRun(t);
    this.host.inputDone({ taskId, requestId, by: clientId, shown, cancelled: false });
    this.host.log('info', 'YOU', `> ${shown}`, 'input');
    t.info.note = t.stopRequested ? 'STOPPING' : 'RUNNING AT PC';
    this.host.taskChanged(t.info);
    const ghost = this.host.hacker;
    ghost.setState('working_at_desk', 'typing', 'RUNNING');
    this.speak(t, 'ghost', eof ? 'End of input.' : `Got it: ${shown}`, 'speech', 1600, true);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------

  private freshRun(t: Pick<ActiveTask, 'info'>, phase: RunPhase, command: string): RunState {
    return {
      taskId: t.info.id,
      codeName: t.info.codeName,
      phase,
      command,
      startedAt: Date.now(),
      finishedAt: null,
      python: null,
      traceMode: '-',
      current: null,
      stack: [],
      lastReturns: [],
      top: [],
      calls: 0,
      returns: 0,
      stdoutLines: 0,
      stderrLines: 0,
      inputs: 0,
      exception: null,
      waitingInput: null,
      exitCode: null,
      outcome: null,
    };
  }

  private begin(q: QueuedTask): void {
    const window = (): LineWindow => ({ start: performance.now(), count: 0, dropped: 0 });
    const t: ActiveTask = {
      q,
      info: q.info,
      phase: 'INTAKE',
      phaseIndex: 0,
      phaseStart: this.host.now(),
      flags: new Set(),
      need: [],
      milestone: 0,
      abort: new AbortController(),
      input: new InputBridge(),
      setupHandle: null,
      setupOk: null,
      setupFailed: null,
      setupTail: [],
      runHandle: null,
      runStarted: false,
      stopRequested: false,
      stopAt: 0,
      result: null,
      run: this.freshRun({ info: q.info }, 'starting', q.run.text),
      runDirty: true,
      lastRunEmit: 0,
      pendingInput: null,
      outputTail: [],
      outWindow: window(),
      traceWindow: window(),
      ghostBubbleAt: 0,
      byteBubbleAt: 0,
      ghostBubbleUntil: 0,
      byteBubbleUntil: 0,
      activityAt: 0,
      wallAt: 0,
      wallFn: '',
      lastCall: null,
      lastReturn: null,
      shownCallAt: -1,
      shownReturnAt: -1,
      lastBubble: 'speech',
      lastOutput: null,
      shownOutputAt: -1,
      published: false,
      lastProgressAt: 0,
    };
    t.info.status = 'active';
    t.info.startedAt = Date.now();
    this.active = t;
    this.emitRun(t);
    this.enter(t, 'INTAKE');
  }

  private advance(t: ActiveTask): void {
    this.exit(t);
    if (this.active !== t) return;
    const nextIndex = t.phaseIndex + 1;
    if (nextIndex >= TASK_STEPS.length) {
      this.finish(t);
      return;
    }
    this.enter(t, TASK_STEPS[nextIndex]);
  }

  private enter(t: ActiveTask, phase: TaskStep): void {
    t.phase = phase;
    t.phaseIndex = TASK_STEPS.indexOf(phase);
    t.phaseStart = this.host.now();
    t.flags = new Set();
    t.need = [];
    t.milestone = 0;
    t.info.stepIndex = t.phaseIndex;
    if (t.info.status === 'active') this.host.log('info', 'SYSTEM', `task ${t.info.id} -> ${phase}`);
    switch (phase) {
      case 'INTAKE':
        this.enterIntake(t);
        break;
      case 'HANDOVER':
        this.enterHandover(t);
        break;
      case 'SETUP':
        this.enterSetup(t);
        break;
      case 'RUN':
        this.enterRun(t);
        break;
      case 'DELIVER':
        this.enterDeliver(t);
        break;
      case 'COOLDOWN':
        this.enterCooldown(t);
        break;
    }
    this.emitProgress(t, this.host.now());
  }

  private exit(t: ActiveTask): void {
    t.info.stepProgress[t.phaseIndex] = 1;
    if (t.phase === 'DELIVER' && !t.published) this.publish(t);
  }

  private finish(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    for (const a of [ghost, byte]) {
      a.reserved = false;
      a.taskId = null;
    }
    t.info.progress = 1;
    this.host.taskChanged(t.info);
    this.lastRun = t.run;
    this.active = null;
  }

  private cancelActive(t: ActiveTask, reason: string): void {
    t.abort.abort();
    this.dropInput(t);
    const { hacker: ghost, assistant: byte } = this.host;
    for (const a of [ghost, byte]) {
      a.plan([]);
      a.setCarrying(null);
      a.reserved = false;
      a.taskId = null;
    }
    ghost.plan([{ kind: 'say', text: 'Scrapping that one.', bubble: 'speech' }]);
    this.host.setWorld({ racksBusy: false, rackOverheat: null, deskScreen: 'off', mailbox: 'empty', monitorText: 'RUN ROOM ONLINE' }, 'racks_busy');
    t.info.status = 'cancelled';
    t.info.note = 'CANCELLED';
    t.info.finishedAt = Date.now();
    this.host.taskChanged(t.info);
    this.host.log('warn', 'SYSTEM', `task ${t.info.id} ${reason}`);
    t.run.phase = 'done';
    t.run.outcome = 'stopped';
    t.run.finishedAt = Date.now();
    this.emitRun(t);
    this.lastRun = t.run;
    this.active = null;
  }

  private dropInput(t: ActiveTask): void {
    const req = t.pendingInput;
    if (!req) return;
    t.pendingInput = null;
    t.run.waitingInput = null;
    t.runDirty = true;
    this.host.inputDone({ taskId: t.info.id, requestId: req.requestId, by: null, shown: null, cancelled: true });
  }

  private runDone(t: ActiveTask): boolean {
    const h = t.runHandle;
    return !h || (h.finished && h.buffer.length === 0);
  }

  private phaseDone(t: ActiveTask): boolean {
    if (!t.need.every((f) => t.flags.has(f))) return false;
    if (t.phase === 'SETUP') return t.q.setup.length === 0 || t.setupOk !== null;
    if (t.phase === 'RUN') return t.setupOk === false || (t.runStarted && this.runDone(t));
    return true;
  }

  private emitProgress(t: ActiveTask, now: number): void {
    t.lastProgressAt = now;
    const elapsed = now - t.phaseStart;
    const creep = (est: number) => 0.9 * (1 - Math.exp(-elapsed / est));
    let p: number;
    if (t.phase === 'INTAKE') {
      // No time based creep: the bar only moves when Byte has the code and Ghost sits at his PC.
      p = t.milestone;
    } else if (t.phase === 'SETUP') {
      p = t.q.setup.length === 0 ? Math.min(1, elapsed / 900) : t.setupHandle ? creep(ESTIMATE.SETUP) : 0;
    } else if (t.phase === 'RUN') {
      // Nothing happens until Ghost is seated and the program started.
      p = t.runStarted ? creep(ESTIMATE.RUN) : 0;
    } else {
      p = Math.min(0.95, elapsed / ESTIMATE[t.phase]);
    }
    t.info.stepProgress[t.phaseIndex] = Math.max(t.info.stepProgress[t.phaseIndex] ?? 0, Math.min(1, p));
    const done = t.info.stepProgress.reduce((a, b) => a + b, 0);
    if (t.info.status === 'active') t.info.progress = Math.min(0.99, done / (TASK_STEPS.length - 1));
    this.host.taskChanged(t.info);
  }

  private emitRun(t: ActiveTask): void {
    t.runDirty = false;
    t.lastRunEmit = performance.now();
    this.host.runState({
      ...t.run,
      stack: [...t.run.stack],
      lastReturns: [...t.run.lastReturns],
      top: [...t.run.top],
    });
  }

  // --- runner events ---------------------------------------------------------------------------

  private onEvent(t: ActiveTask, ev: RunnerEvent, stage: 'setup' | 'run'): void {
    switch (ev.kind) {
      case 'log':
        this.host.log(ev.level ?? 'info', stage === 'setup' ? 'BYTE' : 'SYSTEM', clean(ev.text), ev.channel ?? (stage === 'setup' ? 'setup' : 'runner'));
        break;
      case 'stdout':
      case 'stderr':
        if (stage === 'setup') this.setupLine(t, ev.text, ev.kind === 'stderr');
        else this.outputLine(t, ev.text, ev.kind === 'stderr');
        break;
      case 'hello':
        t.run.python = ev.python;
        t.run.traceMode = ev.traceMode;
        t.runDirty = true;
        this.host.log('info', 'SYSTEM', `${ev.python} started${ev.pid ? ` (pid ${ev.pid})` : ''}, tracing: ${ev.traceMode}`, 'runner');
        break;
      case 'call':
        this.onCall(t, ev);
        break;
      case 'return':
        this.onReturn(t, ev);
        break;
      case 'unwind':
        this.traceLine(t, 'warn', `RAISE ${fnLabel(clean(ev.fn, 80))}: ${clean(ev.type, 60)} ${clean(ev.message, 120)}`);
        break;
      case 'stack':
        t.run.stack = ev.frames.map((f) => ({ fn: clean(f.fn, 80), file: clean(f.file, 120), line: f.line }));
        t.run.current = t.run.stack.at(-1) ?? null;
        t.runDirty = true;
        this.updateWall(t);
        break;
      case 'stats':
        t.run.calls = ev.calls;
        t.run.returns = ev.returns;
        t.run.top = ev.top.map((f) => ({
          fn: clean(f.fn, 80),
          file: clean(f.file, 120),
          calls: f.calls,
          types: f.types.map((x) => clean(x, 40)),
          value: clean(f.value, 80),
          declared: f.declared ? clean(f.declared, 40) : null,
        }));
        t.runDirty = true;
        break;
      case 'input_request':
        this.onInputRequest(t, ev);
        break;
      case 'input_done':
        break;
      case 'exception':
        this.onException(t, ev);
        break;
      case 'setup_step':
        t.run.command = clean(ev.command, 300);
        t.runDirty = true;
        t.info.note = `INSTALLING ${ev.index + 1}/${t.q.setup.length}`;
        this.host.taskChanged(t.info);
        this.host.log('info', 'BYTE', `$ ${clean(ev.command, 300)}`, 'setup');
        break;
      case 'setup_done':
        t.setupOk = ev.ok;
        t.setupFailed = ev.failed;
        this.host.setupFinished(t.info, t.q.setup.map((c) => c.text), ev.ok);
        this.host.log(ev.ok ? 'success' : 'error', 'BYTE', ev.ok ? 'BYTE: setup finished OK' : `BYTE: setup failed at "${clean(ev.failed ?? '?', 200)}" (exit code ${ev.exitCode ?? 'none'})`, 'setup');
        break;
      case 'exit':
        t.run.exitCode = ev.code;
        t.runDirty = true;
        break;
      case 'result':
        t.result = ev;
        t.run.phase = 'done';
        t.run.outcome = ev.outcome;
        t.run.exitCode = ev.exitCode;
        t.run.finishedAt = Date.now();
        t.info.exitCode = ev.exitCode;
        this.dropInput(t);
        this.emitRun(t);
        this.host.log(ev.ok ? 'success' : ev.outcome === 'stopped' ? 'warn' : 'error', 'SYSTEM', `program ended: ${clean(ev.summary, 300)}`, 'runner');
        break;
      case 'error':
        this.host.log('error', 'SYSTEM', clean(ev.text), 'runner');
        break;
    }
  }

  /** Opens a new one second window and reports what it dropped. */
  private closeWindow(w: LineWindow, report: (dropped: number) => void): void {
    const now = performance.now();
    if (now - w.start < 1000) return;
    if (w.dropped > 0) report(w.dropped);
    w.start = now;
    w.count = 0;
    w.dropped = 0;
  }

  private outputLine(t: ActiveTask, text: string, isErr: boolean): void {
    const line = clean(text, 400);
    if (isErr) t.run.stderrLines++;
    else {
      t.run.stdoutLines++;
      if (line.trim()) t.lastOutput = { text: line, at: this.host.now() };
    }
    t.outputTail.push(line);
    if (t.outputTail.length > 6) t.outputTail.shift();
    t.runDirty = true;
    const w = t.outWindow;
    if (w.count < OUTPUT_LINES_PER_SEC) {
      w.count++;
      this.host.log(isErr ? 'warn' : 'info', isErr ? 'ERR' : 'OUT', line, isErr ? 'stderr' : 'stdout');
    } else {
      w.dropped++;
    }
  }

  private setupLine(t: ActiveTask, text: string, isErr: boolean): void {
    const line = clean(text, 400);
    t.setupTail.push(line);
    if (t.setupTail.length > 80) t.setupTail.shift();
    const w = t.outWindow;
    if (w.count < OUTPUT_LINES_PER_SEC) {
      w.count++;
      this.host.log(isErr ? 'warn' : 'info', 'BYTE', line, 'setup');
    } else {
      w.dropped++;
    }
    // Byte comments on what pip does.
    const now = this.host.now();
    if (now - t.byteBubbleAt < BYTE_BUBBLE_MS / 2) return;
    const collecting = /^\s*(Collecting|Downloading)\s+([A-Za-z0-9_.\-[\]]+)/.exec(line);
    const installed = /^\s*Successfully installed\s+(.+)$/.exec(line);
    let say: string | null = null;
    if (installed) say = `Installed ${installed[1].trim().split(/\s+/).length} package(s)!`;
    else if (collecting) say = `Fetching ${clip(collecting[2], 24)}`;
    if (say) this.speak(t, 'byte', say, 'speech', 1800);
  }

  private traceLine(t: ActiveTask, level: LogLevel, text: string): void {
    const w = t.traceWindow;
    if (w.count >= TRACE_LINES_PER_SEC) {
      w.dropped++;
      return;
    }
    w.count++;
    this.host.log(level, 'TRACE', text, 'trace');
  }

  private onCall(t: ActiveTask, ev: Extract<RunnerEvent, { kind: 'call' }>): void {
    const fn = clean(ev.fn, 80);
    const args = clean(ev.args, 90);
    t.lastCall = { fn, args, at: this.host.now() };
    const indent = '  '.repeat(Math.max(0, Math.min(6, ev.depth - 1)));
    this.traceLine(t, 'info', `${indent}CALL ${fnLabel(fn)}(${args})  ${clean(ev.file, 80)}:${ev.line}`);
  }

  private onReturn(t: ActiveTask, ev: Extract<RunnerEvent, { kind: 'return' }>): void {
    const fn = clean(ev.fn, 80);
    const type = clean(ev.type, 40);
    const value = clean(ev.value, 80);
    const declared = ev.declared ? clean(ev.declared, 40) : null;
    t.run.lastReturns.push({ fn, type, value, declared, yielded: ev.yielded });
    if (t.run.lastReturns.length > 6) t.run.lastReturns.shift();
    t.runDirty = true;
    t.lastReturn = { fn, type, value, at: this.host.now() };
    // A declared return type that does not match what came back is worth a yellow line.
    const mismatch = declared !== null && declared !== type && !declared.includes(type) && !(declared === 'None' && type === 'None');
    const indent = '  '.repeat(Math.max(0, Math.min(6, ev.depth - 1)));
    this.traceLine(
      t,
      mismatch ? 'warn' : 'info',
      `${indent}${ev.yielded ? 'YIELD' : 'RET '} ${fnLabel(fn)} -> ${type} ${value}${declared ? ` (declared ${declared})` : ''}`,
    );
  }

  private onInputRequest(t: ActiveTask, ev: Extract<RunnerEvent, { kind: 'input_request' }>): void {
    if (t.stopRequested) return;
    const prompt = clean(ev.prompt || (t.outputTail.at(-1) ?? ''), 200).trim();
    const req: InputRequest = {
      taskId: t.info.id,
      requestId: ev.requestId,
      prompt,
      secret: ev.secret,
      fn: ev.fn ? clean(ev.fn, 80) : null,
      since: Date.now(),
      // The last output lines, without the question itself (it is shown on its own).
      context: (t.outputTail.at(-1)?.trim() === prompt ? t.outputTail.slice(0, -1) : t.outputTail).slice(-5),
    };
    t.pendingInput = req;
    t.run.waitingInput = req;
    this.emitRun(t);
    this.host.inputRequest(req);
    t.info.note = 'WAITING FOR INPUT';
    this.host.taskChanged(t.info);
    const ghost = this.host.hacker;
    ghost.setState('idle', 'seated', 'WAITING INPUT');
    const h = this.head(ghost);
    this.host.fx('exclaim', h.x, h.y - 4, { duration: 900 });
    this.speak(t, 'ghost', `Need input: ${prompt || 'type a line'}`, 'speech', 4000, true);
    // Byte does not read the question out loud afterwards.
    if (t.lastOutput) t.shownOutputAt = t.lastOutput.at;
    this.host.log(
      'info',
      'SYSTEM',
      `the program waits for input${req.fn ? ` in ${fnLabel(req.fn)}` : ''}: ${prompt || '(no prompt)'}${req.secret ? ' (hidden)' : ''}`,
      'input',
    );
  }

  private onException(t: ActiveTask, ev: Extract<RunnerEvent, { kind: 'exception' }>): void {
    t.run.exception = { type: clean(ev.type, 60), message: clean(ev.message, 300), fn: ev.fn ? clean(ev.fn, 80) : null, line: ev.line };
    t.runDirty = true;
    const ghost = this.host.hacker;
    this.host.setWorld({ deskScreen: 'red' }, 'desk_screen');
    const rack = this.stationPx('SERVER_HOT', -26);
    this.host.fx('siren', rack.x, rack.y - 6, { duration: 2400 });
    this.host.fx('smoke', rack.x, rack.y, { duration: 2400 });
    ghost.setState('error', 'facepalm', 'CRASH');
    ghost.holdMood('overheating', 15000);
    this.speak(t, 'ghost', `${t.run.exception.type}!`, 'speech', 2200, true);
    const where = t.run.exception.fn ? ` in ${fnLabel(t.run.exception.fn)}${ev.line ? ` line ${ev.line}` : ''}` : '';
    this.host.log('error', 'GHOST', `GHOST: it crashed with ${t.run.exception.type}: ${t.run.exception.message}${where}`, 'chat');
  }

  /** Bubbles and activity labels for what the program is doing (throttled in sim time). */
  private react(t: ActiveTask): void {
    if (t.phase !== 'RUN' || !t.runStarted || t.pendingInput || t.run.phase === 'done' || t.stopRequested) return;
    const now = this.host.now();
    const { hacker: ghost, assistant: byte } = this.host;
    const c = t.lastCall;
    const r = t.lastReturn;
    if (c && c.at > t.shownCallAt && now - t.activityAt >= ACTIVITY_MS && ghost.state !== 'error') {
      t.activityAt = now;
      ghost.setState('working_at_desk', 'typing', clip(`RUN ${fnLabel(c.fn)}`.toUpperCase(), 20));
    }
    if (now - t.ghostBubbleAt >= GHOST_BUBBLE_MS) {
      const newReturn = r !== null && r.at > t.shownReturnAt;
      const newCall = c !== null && c.at > t.shownCallAt;
      // Alternate: a thought for the function that runs, speech for what it returned.
      if (newReturn && (!newCall || t.lastBubble === 'thought')) {
        const v = r.value && r.value !== 'None' ? ` ${clip(r.value, 18)}` : '';
        if (this.speak(t, 'ghost', `${clip(fnLabel(r.fn), 24)} -> ${r.type}${v}`, 'speech', 1600)) {
          t.shownReturnAt = r.at;
          t.lastBubble = 'speech';
        }
      } else if (newCall) {
        if (this.speak(t, 'ghost', `${clip(fnLabel(c.fn), 30)}(${clip(c.args, 24)})`, 'thought', 1600)) {
          t.shownCallAt = c.at;
          t.lastBubble = 'thought';
        }
      }
    }
    const out = t.lastOutput;
    if (out && out.at > t.shownOutputAt && now - t.byteBubbleAt >= BYTE_BUBBLE_MS && byte.station === 'DESK_SIDE' && !byte.move) {
      if (this.speak(t, 'byte', `It says: ${clip(out.text.trim(), 40)}`, 'speech', 2200)) t.shownOutputAt = out.at;
    }
  }

  /** The Command Center wall shows the function that runs (throttled). */
  private updateWall(t: ActiveTask): void {
    const cur = t.run.current;
    if (!cur || t.run.phase !== 'run') return;
    const now = performance.now();
    if (cur.fn === t.wallFn || now - t.wallAt < WALL_EVERY_MS) return;
    t.wallFn = cur.fn;
    t.wallAt = now;
    this.host.setWorld({ monitorText: `${t.info.id} RUN ${t.info.codeName}: ${fnLabel(cur.fn)} LINE ${cur.line}` }, 'monitor_text');
  }

  // --- helpers ---------------------------------------------------------------------------------

  private flag(t: ActiveTask, name: string): Action {
    t.need.push(name);
    return { kind: 'call', fn: () => t.flags.add(name) };
  }

  /** Short description of what is physically happening, shown in the queue. */
  private note(t: ActiveTask, text: string): Action {
    return {
      kind: 'call',
      fn: () => {
        t.info.note = text;
        this.host.taskChanged(t.info);
      },
    };
  }

  private setNote(t: ActiveTask, text: string): void {
    t.info.note = text;
  }

  /** World pixel position above an agent's head. */
  private head(a: Agent): { x: number; y: number } {
    const p = a.position();
    return { x: Math.round(p.x * TILE + 8), y: Math.round(p.y * TILE - 6) };
  }

  private stationPx(id: StationId, dy = 0): { x: number; y: number } {
    const s = STATIONS[id];
    return { x: s.x * TILE + 8, y: s.y * TILE + 8 + dy };
  }

  /**
   * One speaker at a time: Ghost and Byte stand next to each other at the PC, so their bubbles
   * would cover each other. A routine line waits for the other's bubble to end; an urgent one
   * (input needed, a crash) hushes the other agent.
   */
  private speak(t: ActiveTask, who: 'ghost' | 'byte', text: string, kind: BubbleKind, duration: number, urgent = false): boolean {
    const now = this.host.now();
    const me = who === 'ghost' ? this.host.hacker : this.host.assistant;
    const other = who === 'ghost' ? this.host.assistant : this.host.hacker;
    const otherUntil = who === 'ghost' ? t.byteBubbleUntil : t.ghostBubbleUntil;
    if (now < otherUntil + 250) {
      if (!urgent) return false;
      this.host.bubble(other.id, '', 'speech', 0);
      if (who === 'ghost') t.byteBubbleUntil = now;
      else t.ghostBubbleUntil = now;
    }
    this.host.bubble(me.id, text, kind, duration);
    if (who === 'ghost') {
      t.ghostBubbleAt = now;
      t.ghostBubbleUntil = now + duration;
    } else {
      t.byteBubbleAt = now;
      t.byteBubbleUntil = now + duration;
    }
    return true;
  }

  private runnerTask(t: ActiveTask): RunnerTask {
    return {
      id: t.info.id,
      title: t.info.title,
      codeName: t.info.codeName,
      workDir: t.q.workDir,
      venvDir: t.q.venvDir,
      setup: t.q.setup,
      run: t.q.run,
      projectName: t.info.projectName,
    };
  }

  /** Ghost walks to his PC (no-op when he is already there) and sits down, still. */
  private toPc(activity = 'TO PC'): Action[] {
    return [
      { kind: 'goto', station: 'DESK_GHOST', activity },
      { kind: 'do', state: 'idle', anim: 'seated', activity: 'AT PC', duration: 0, facing: 'up' },
    ];
  }

  /**
   * Keeps Ghost seated at the PC after his part of a phase, until the next phase replaces the
   * plan. Without it he would stand up for a moment between phases.
   */
  private holdAtPc(): Action {
    return { kind: 'wait', until: () => false, state: 'idle', anim: 'seated', activity: 'AT PC' };
  }

  // --- phases ----------------------------------------------------------------------------------

  /** Ghost heads to his PC while Byte fetches the code from the mail room. */
  private enterIntake(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    ghost.reserved = byte.reserved = true;
    ghost.taskId = byte.taskId = t.info.id;
    this.setNote(t, 'GHOST -> PC');
    this.host.setWorld({ mailbox: 'full' }, 'mailbox');
    const box = this.stationPx('MAIL_DROP', -16);
    this.host.fx('mail_drop', box.x, box.y - 24, { toX: box.x, toY: box.y - 4, duration: 700 });
    this.host.log('info', 'SYSTEM', `TASK ${t.info.id} received [${t.info.priority}]: ${t.info.title} (${t.info.run})`);
    byte.plan([
      { kind: 'goto', station: 'MAIL_DROP', activity: 'TO MAIL ROOM' },
      { kind: 'do', state: 'researching', anim: 'typing', activity: 'PICK UP CODE', duration: 1200, facing: 'up' },
      {
        kind: 'call',
        fn: () => {
          this.host.setWorld({ mailbox: 'empty' }, 'mailbox');
          const h = this.head(byte);
          this.host.fx('packet', h.x, h.y, { duration: 600 });
          byte.setCarrying('packet');
          t.milestone += 0.5;
          this.host.log('info', 'BYTE', `BYTE: new code to run - ${t.info.codeName}${t.info.fileCount > 1 ? ` (${t.info.fileCount} files)` : ''}`, 'chat');
        },
      },
      this.flag(t, 'byte'),
    ]);
    const wake: Action[] =
      ghost.state === 'sleeping'
        ? [
            {
              kind: 'call',
              fn: () => {
                const h = this.head(ghost);
                this.host.fx('exclaim', h.x, h.y - 4, { duration: 900 });
              },
            },
            { kind: 'do', state: 'idle', anim: 'idle', activity: 'WAKE UP', duration: 700, facing: 'down' },
            { kind: 'say', text: 'Huh? Code to run?', duration: 1400 },
          ]
        : [];
    ghost.plan([
      ...wake,
      { kind: 'call', fn: () => this.host.log('info', 'GHOST', 'GHOST: code coming in, heading to my PC', 'chat') },
      ...this.toPc('TO PC'),
      {
        kind: 'call',
        fn: () => {
          // The PC wakes up when he sits down: blue boot screen, nothing running yet.
          this.host.setWorld({ deskScreen: 'blue' }, 'desk_screen');
          t.milestone += 0.5;
          t.info.note = 'AT PC';
          this.host.taskChanged(t.info);
          this.host.log('info', 'GHOST', 'GHOST: at my PC, waiting for the code', 'chat');
        },
      },
      this.flag(t, 'ghost'),
      this.holdAtPc(),
    ]);
  }

  /** Byte brings the code to Ghost, who is already seated at his PC. */
  private enterHandover(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    this.setNote(t, 'BYTE -> PC');
    byte.plan([
      { kind: 'goto', station: 'DESK_SIDE', activity: 'TO GHOST' },
      { kind: 'say', text: `New job, boss: ${clip(t.info.run, 34)}`, to: ghost.id, duration: 2600, wait: true },
      {
        kind: 'call',
        fn: () => {
          const from = this.head(byte);
          const to = this.head(ghost);
          this.host.fx('packet', from.x, from.y + 8, { toX: to.x, toY: to.y + 8, duration: 700 });
          byte.setCarrying(null);
          t.flags.add('handed');
        },
      },
      { kind: 'do', state: 'handing_over', anim: 'idle', activity: 'HAND OVER', duration: 900, facing: 'left' },
      this.flag(t, 'byte'),
    ]);
    const happy = ghost.energy >= 45 && ghost.mood !== 'tired' && ghost.mood !== 'overheating';
    ghost.plan([
      ...this.toPc('TO PC'),
      { kind: 'wait', until: () => t.flags.has('handed'), maxDuration: 30000, state: 'idle', anim: 'seated', activity: 'WAIT FOR CODE' },
      // He turns around in his chair to take it, reacts, then sits back down.
      happy
        ? { kind: 'do', state: 'celebrating', anim: 'cheer', activity: 'PUMPED', duration: 1300, facing: 'down' }
        : { kind: 'do', state: 'idle', anim: 'facepalm', activity: 'SIGH', duration: 1300, facing: 'down' },
      { kind: 'say', text: happy ? "Let's run it!" : '*sigh* Fine. Running it.', to: byte.id, duration: 1600 },
      this.note(t, 'CODE AT PC'),
      this.flag(t, 'ghost'),
      this.holdAtPc(),
    ]);
  }

  /** Byte installs the dependencies at the server racks; Ghost waits at his PC. */
  private enterSetup(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    if (t.q.setup.length === 0) {
      t.setupOk = true;
      const cached = t.info.setupCached;
      this.setNote(t, cached ? 'SETUP CACHED' : 'NO SETUP');
      this.host.log('info', 'SYSTEM', cached ? `task ${t.info.id}: setup already done for this project (SETUP + RUN redoes it)` : `task ${t.info.id}: no setup commands`);
      byte.plan([{ kind: 'do', state: 'idle', anim: 'idle', activity: 'WATCHING', duration: 300, facing: 'left' }]);
      ghost.plan([
        ...this.toPc('TO PC'),
        { kind: 'say', text: cached ? 'Deps already installed.' : 'No setup needed.', bubble: 'thought', duration: 1400 },
        { kind: 'do', state: 'researching', anim: 'seated', activity: 'CHECK DEPS', duration: 900, facing: 'up' },
        this.flag(t, 'ghost'),
        this.holdAtPc(),
      ]);
      return;
    }
    byte.reserved = true;
    this.setNote(t, 'BYTE -> RACKS');
    t.run = { ...this.freshRun(t, 'setup', t.q.setup[0].text), python: t.run.python };
    t.runDirty = true;
    const task = this.runnerTask(t);
    byte.plan([
      { kind: 'call', fn: () => byte.setCarrying('file') },
      { kind: 'goto', station: 'SERVER_CHECK', activity: 'TO RACKS' },
      {
        kind: 'call',
        fn: () => {
          // Only now, with Byte at the racks, does the setup really start.
          byte.setCarrying(null);
          t.setupHandle = new RunnerHandle(this.host.runner.setup(task, { signal: t.abort.signal, input: t.input }));
          t.run.startedAt = Date.now();
          t.runDirty = true;
          t.info.note = 'INSTALLING';
          this.host.taskChanged(t.info);
          this.host.setWorld({ racksBusy: true }, 'racks_busy');
          this.host.log('info', 'BYTE', `BYTE: at the racks, running ${t.q.setup.length} setup command(s)`, 'chat');
        },
      },
      { kind: 'say', text: 'Installing the deps...', duration: 1600 },
      { kind: 'do', state: 'researching', anim: 'typing', activity: 'PIP INSTALL', duration: 1200, until: () => t.setupOk !== null, facing: 'up' },
      {
        kind: 'call',
        fn: () => {
          this.host.setWorld({ racksBusy: false }, 'racks_busy');
          if (t.setupOk) {
            byte.insertNext([
              { kind: 'say', text: 'Deps ready!', duration: 1400 },
              { kind: 'do', state: 'celebrating', anim: 'cheer', activity: 'DEPS READY', duration: 1000, facing: 'down' },
            ]);
          } else {
            const rack = this.stationPx('SERVER_HOT', -26);
            this.host.setWorld({ rackOverheat: HOT_RACK }, 'rack_overheat');
            this.host.fx('siren', rack.x, rack.y - 6, { duration: 2400 });
            this.host.fx('smoke', rack.x, rack.y, { duration: 2400 });
            byte.insertNext([
              { kind: 'say', text: 'Setup failed!', duration: 1600 },
              { kind: 'do', state: 'error', anim: 'facepalm', activity: 'SETUP FAILED', duration: 1400, facing: 'down' },
              { kind: 'call', fn: () => this.host.setWorld({ rackOverheat: null }, 'rack_overheat') },
            ]);
          }
        },
      },
      this.flag(t, 'byte'),
    ]);
    ghost.plan([...this.toPc('TO PC'), { kind: 'say', text: 'Byte installs the deps...', bubble: 'thought', duration: 2200 }, this.flag(t, 'ghost'), this.holdAtPc()]);
  }

  /**
   * The real work: Ghost is (or first gets) seated at the PC, THEN the program starts. When it
   * ends he stands up, the screen goes dark and he leaves the PC.
   */
  private enterRun(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    byte.reserved = true;
    if (t.setupOk === false) {
      this.setNote(t, 'SETUP FAILED');
      t.result = this.setupFailureResult(t);
      t.run.phase = 'done';
      t.run.outcome = 'setup_failed';
      t.run.finishedAt = Date.now();
      this.emitRun(t);
      ghost.plan([
        ...this.toPc('TO PC'),
        { kind: 'say', text: 'Setup failed. Not running it.', duration: 1800 },
        { kind: 'do', state: 'error', anim: 'facepalm', activity: 'NO RUN', duration: 1200, facing: 'down' },
        ...this.leavePc(t, 'GHOST: setup failed, leaving the PC'),
        this.flag(t, 'ghost'),
      ]);
      return;
    }
    this.setNote(t, 'GHOST -> PC');
    const task = this.runnerTask(t);
    byte.plan([
      { kind: 'goto', station: 'DESK_SIDE', activity: 'TO PC' },
      { kind: 'wait', until: () => this.runDone(t), state: 'idle', anim: 'idle', activity: 'WATCHING' },
    ]);
    ghost.plan([
      ...this.toPc('TO PC'),
      {
        kind: 'call',
        fn: () => {
          // Ghost is seated at the PC: only now does the program start.
          t.runStarted = true;
          t.phaseStart = this.host.now();
          t.run = { ...this.freshRun(t, 'run', t.q.run.text), python: t.run.python };
          t.runHandle = new RunnerHandle(this.host.runner.run(task, { signal: t.abort.signal, input: t.input }));
          t.info.runner = this.host.runner.name;
          t.info.note = 'RUNNING AT PC';
          this.host.taskChanged(t.info);
          this.emitRun(t);
          this.host.setWorld({ racksBusy: true, deskScreen: 'green', monitorText: `${t.info.id} RUN ${t.info.codeName}` }, 'racks_busy');
          this.host.log('info', 'GHOST', `GHOST: seated at the PC, running: ${t.q.run.text}`, 'chat');
        },
      },
      {
        kind: 'do',
        state: 'working_at_desk',
        anim: 'typing',
        activity: 'RUNNING',
        duration: RUN_MIN_MS,
        // No time cap: he stays until the program really ended (whatever the sim speed).
        until: () => this.runDone(t),
        facing: 'up',
      },
      // A crash stays on screen for a moment: the red PC screen with Ghost facepalming at it. The
      // program exits right after its exception, so without this he would stand up at once and
      // nobody would see it. Without a crash this ends on the next tick.
      { kind: 'wait', until: () => t.run.exception === null, maxDuration: CRASH_BEAT_MS },
      ...this.leavePc(t, 'GHOST: the program ended, leaving the PC'),
      this.flag(t, 'ghost'),
    ]);
  }

  /** The screen goes dark and Ghost gets up from the PC. */
  private leavePc(t: ActiveTask, line: string): Action[] {
    return [
      {
        kind: 'call',
        fn: () => {
          this.host.setWorld({ deskScreen: 'off', racksBusy: false }, 'desk_screen');
          this.host.log('info', 'GHOST', line, 'chat');
          t.info.note = 'LEAVING PC';
          this.host.taskChanged(t.info);
        },
      },
      { kind: 'do', state: 'idle', anim: 'idle', activity: 'STAND UP', duration: 500, facing: 'down' },
    ];
  }

  private setupFailureResult(t: ActiveTask): ResultEvent {
    const failed = clean(t.setupFailed ?? '?', 300);
    const report = [
      `# RUN ${t.info.id}: ${clean(t.info.codeName, 80)}`,
      '',
      '- Result: SETUP FAILED, the program was not started',
      `- Failed setup command: ${failed}`,
      `- Run command: ${clean(t.q.run.text, 300)}`,
      '',
      `## Setup output (last ${Math.min(80, t.setupTail.length)} lines)`,
      '',
      '```',
      ...(t.setupTail.length ? t.setupTail.map((l) => l.replace(/^```/, "'''")) : ['(nothing)']),
      '```',
      '',
    ].join('\n');
    return {
      kind: 'result',
      summary: `Setup failed: ${clip(failed, 120)}`,
      report,
      ok: false,
      outcome: 'setup_failed',
      exitCode: null,
      calls: 0,
      outputLines: 0,
      runtimeMs: t.setupHandle?.runtimeMs ?? 0,
    };
  }

  private outcomeOf(t: ActiveTask): RunOutcome {
    return t.result?.outcome ?? (t.setupOk === false ? 'setup_failed' : 'error');
  }

  /** The result goes up on the Command Center wall; Byte carries it to the Mail Room. */
  private enterDeliver(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    byte.reserved = true;
    this.setNote(t, 'GHOST -> WALL');
    const outcome = this.outcomeOf(t);
    const ok = outcome === 'ok';
    const word = ok ? 'OK' : outcome === 'stopped' ? 'STOPPED' : outcome === 'setup_failed' ? 'SETUP FAILED' : 'ERR';
    const exit = t.result?.exitCode !== null && t.result?.exitCode !== undefined ? ` EXIT ${t.result.exitCode}` : '';
    const secs = t.result ? ` ${(t.result.runtimeMs / 1000).toFixed(1)}S` : '';
    ghost.plan([
      { kind: 'goto', station: 'COMMAND_SCREEN', activity: 'TO WALL' },
      {
        kind: 'call',
        fn: () => {
          this.host.setWorld({ monitorText: `${t.info.id} ${t.info.codeName}: ${word}${exit}${secs}` }, 'monitor_text');
          t.info.note = 'RESULT ON WALL';
          this.host.taskChanged(t.info);
        },
      },
      { kind: 'do', state: 'researching', anim: 'idle', activity: 'POST RESULT', duration: 1200, facing: 'up' },
      { kind: 'wait', until: () => t.flags.has('byte_here'), maxDuration: 40000, state: 'idle', anim: 'idle', activity: 'WAIT BYTE' },
      {
        kind: 'call',
        fn: () => {
          ghost.setFacing('right');
          const from = this.head(ghost);
          const to = this.head(byte);
          this.host.fx('packet', from.x, from.y + 8, { toX: to.x, toY: to.y + 8, duration: 700 });
          byte.setCarrying('packet');
          t.flags.add('result_handed');
          t.info.note = 'BYTE -> MAIL';
          this.host.taskChanged(t.info);
        },
      },
      ok
        ? { kind: 'do', state: 'celebrating', anim: 'cheer', activity: 'SHIP IT', duration: 1500, facing: 'down', onEnd: () => ghost.holdMood('hyped', 25000) }
        : { kind: 'do', state: 'error', anim: 'facepalm', activity: word, duration: 1500, facing: 'down' },
      this.flag(t, 'ghost'),
    ]);
    byte.plan([
      { kind: 'goto', station: 'COMMAND_SIDE', activity: 'COLLECT RESULT', facing: 'left' },
      { kind: 'call', fn: () => t.flags.add('byte_here') },
      { kind: 'wait', until: () => t.flags.has('result_handed'), maxDuration: 40000, state: 'idle', anim: 'idle', activity: 'WAIT RESULT' },
      { kind: 'goto', station: 'MAIL_DROP', activity: 'TO MAIL ROOM' },
      { kind: 'do', state: 'handing_over', anim: 'typing', activity: 'SEND RESULT', duration: 1000, facing: 'up' },
      { kind: 'call', fn: () => this.publish(t) },
      ok
        ? { kind: 'do', state: 'celebrating', anim: 'cheer', activity: 'DELIVERED', duration: 1200, facing: 'down' }
        : { kind: 'do', state: 'idle', anim: 'idle', activity: 'DELIVERED', duration: 800, facing: 'down' },
      this.flag(t, 'byte'),
    ]);
  }

  private enterCooldown(t: ActiveTask): void {
    const { hacker: ghost, assistant: byte } = this.host;
    byte.reserved = false;
    byte.taskId = null;
    ghost.plan([
      { kind: 'goto', station: 'COFFEE', activity: 'COOLDOWN' },
      {
        kind: 'do',
        state: 'drinking_coffee',
        anim: 'idle',
        activity: 'COFFEE BREAK',
        duration: 3000,
        facing: 'up',
        onEnd: () => {
          ghost.changeEnergy(25);
          if (ghost.mood !== 'hyped') ghost.holdMood('caffeinated', 30000);
        },
      },
      this.flag(t, 'ghost'),
    ]);
  }

  /** Builds and broadcasts the result (once), awards XP and fires the celebration FX. */
  private publish(t: ActiveTask): void {
    if (t.published) return;
    t.published = true;
    const { hacker: ghost, assistant: byte } = this.host;
    const r = t.result;
    const outcome = this.outcomeOf(t);
    const fallback = `# RUN ${t.info.id}: ${clean(t.info.codeName, 80)}\n\nThe runner ended without a report.\n`;
    const result: ResultInfo = {
      taskId: t.info.id,
      title: t.info.title,
      summary: r?.summary ?? 'The runner ended without a report.',
      report: r?.report ?? fallback,
      codeName: t.info.codeName,
      command: t.q.run.text,
      projectName: t.info.projectName,
      ok: outcome === 'ok',
      outcome,
      exitCode: r?.exitCode ?? null,
      runtimeMs: r?.runtimeMs ?? t.runHandle?.runtimeMs ?? 0,
      calls: r?.calls ?? 0,
      outputLines: r?.outputLines ?? 0,
      createdAt: Date.now(),
    };
    byte.setCarrying(null);
    t.info.status = result.ok ? 'done' : outcome === 'stopped' ? 'cancelled' : 'failed';
    t.info.note = result.ok ? 'DONE' : outcome === 'stopped' ? 'STOPPED' : outcome === 'setup_failed' ? 'SETUP FAILED' : 'FAILED';
    t.info.exitCode = result.exitCode;
    t.info.finishedAt = Date.now();
    t.info.progress = 1;
    t.info.stepProgress = t.info.stepProgress.map((p, i) => (i <= TASK_STEPS.indexOf('DELIVER') ? 1 : p));
    this.host.taskChanged(t.info);
    this.host.publishResult(result);
    this.host.runFinished(t.info, result);

    const box = this.stationPx('MAIL_DROP', -16);
    if (result.ok) this.host.fx('confetti', box.x, box.y, { duration: 1600 });
    const gh = this.head(ghost);
    const bh = this.head(byte);
    this.host.fx('coin_xp', gh.x, gh.y - 4, { duration: 1300 });
    this.host.fx('coin_xp', bh.x, bh.y - 4, { duration: 1300 });
    ghost.addXp(result.ok ? 40 + Math.min(40, Math.round(result.calls / 25)) : 15);
    byte.addXp(t.q.setup.length ? 25 : 15);
    const stats = this.host.world.stats;
    this.host.setWorld(
      {
        racksBusy: false,
        monitorText: `LAST: ${t.info.id} ${t.info.codeName} ${result.ok ? 'OK' : outcome === 'stopped' ? 'STOPPED' : 'ERR'}`,
        stats: {
          ...stats,
          tasksDone: stats.tasksDone + (result.ok ? 1 : 0),
          tasksFailed: stats.tasksFailed + (result.ok || outcome === 'stopped' ? 0 : 1),
          tasksCancelled: stats.tasksCancelled + (outcome === 'stopped' ? 1 : 0),
        },
      },
      'stats',
    );
    this.host.log(result.ok ? 'success' : 'error', 'SYSTEM', `RESULT ${t.info.id} ${result.ok ? 'OK' : outcome.toUpperCase()}: ${result.summary}`);
  }
}
