// Shared domain types for RUN ROOM. Imported by both the server and the client.
// Everything here is plain data so it can travel over the WebSocket as JSON.

export type AgentId = string;

export type Facing = 'down' | 'left' | 'right' | 'up';

export const AGENT_STATES = [
  'idle',
  'walking',
  'working_at_desk',
  'researching',
  'handing_over',
  'drinking_coffee',
  'celebrating',
  'error',
  'sleeping',
] as const;
export type AgentStateName = (typeof AGENT_STATES)[number];

export const MOODS = ['caffeinated', 'focused', 'tired', 'hyped', 'overheating'] as const;
export type Mood = (typeof MOODS)[number];

/**
 * Animation the client should play for an agent that is not walking.
 * 'seated' = sitting still at the PC (reading); 'typing' = working at the PC.
 */
export type AnimName = 'idle' | 'walk' | 'typing' | 'seated' | 'cheer' | 'facepalm' | 'sleep';

/** Item drawn above an agent's hands while it walks. */
export type CarryItem = 'file' | 'packet' | 'coffee';

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * The visible lifecycle of a run. INTAKE: Byte picks the code up while Ghost walks to his PC.
 * HANDOVER: Byte brings it to the PC. SETUP: Byte installs dependencies at the server racks (skipped
 * when there is nothing to install). RUN: Ghost runs the program at his PC. DELIVER: the result
 * goes up on the Command Center wall and Byte carries it to the Mail Room. COOLDOWN: coffee.
 */
export const TASK_STEPS = ['INTAKE', 'HANDOVER', 'SETUP', 'RUN', 'DELIVER', 'COOLDOWN'] as const;
export type TaskStep = (typeof TASK_STEPS)[number];

/** Steps shown as progress segments in the bottom bar (COOLDOWN happens after delivery). */
export const VISIBLE_TASK_STEPS: readonly TaskStep[] = TASK_STEPS.slice(0, 5);

export type TaskStatus = 'queued' | 'active' | 'done' | 'failed' | 'cancelled';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';
/**
 * chat: crew talk. runner: run bookkeeping. stdout / stderr: the program's own output.
 * trace: function calls and returns. input: answers typed by viewers. setup: setup command output.
 */
export type LogChannel = 'chat' | 'runner' | 'stdout' | 'stderr' | 'system' | 'trace' | 'input' | 'setup';

export const FX_TYPES = [
  'heart',
  'z',
  'exclaim',
  'spark',
  'packet',
  'smoke',
  'siren',
  'coin_xp',
  'confetti',
  'matrix',
  'file_sprite',
  'dust_puff',
  'mail_drop',
] as const;
export type FxType = (typeof FX_TYPES)[number];

export type BubbleKind = 'speech' | 'thought';
export type DeskScreen = 'green' | 'red' | 'blue' | 'off';

/** A tile coordinate pair [x, y]. */
export type PathPoint = [number, number];

/** A walk in progress. Position at sim time T is a pure function of these fields (see shared/motion.ts). */
export interface MoveState {
  path: PathPoint[];
  /** Sim clock (ms) when the walk started. */
  startClock: number;
  /** Tiles per sim second. */
  speed: number;
}

export interface AgentAction {
  /** Sim clock (ms). */
  at: number;
  text: string;
}

export interface AgentState {
  agentId: AgentId;
  name: string;
  role: string;
  state: AgentStateName;
  /** Short ASCII description of what the agent is doing, e.g. "CHECK RACKS". */
  activity: string;
  station: string | null;
  mood: Mood;
  energy: number;
  xp: number;
  level: number;
  /** Tile position where the agent stands (or where the current move started). */
  x: number;
  y: number;
  facing: Facing;
  anim: AnimName;
  carrying: CarryItem | null;
  taskId: string | null;
  move: MoveState | null;
  /** Last 10 actions, newest last. */
  history: AgentAction[];
}

/** A single .py file or a whole project folder. */
export type CodeKind = 'file' | 'folder';

export interface TaskInfo {
  id: string;
  /** e.g. "RUN main.py". */
  title: string;
  priority: Priority;
  status: TaskStatus;
  stepIndex: number;
  steps: TaskStep[];
  /** Overall progress 0..1. */
  progress: number;
  /** Per step progress 0..1, same order as steps. */
  stepProgress: number[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** What is physically happening right now, e.g. "GHOST -> PC" or "RUNNING AT PC". */
  note: string;
  /** The file name or the folder name of the code. */
  codeName: string;
  codeKind: CodeKind;
  fileCount: number;
  /** The saved project this run uses, if any. */
  projectId: string | null;
  projectName: string | null;
  /** Setup commands, one per entry (validated). Empty when there is nothing to set up. */
  setup: string[];
  /** True when the setup is skipped because it already ran OK for this saved project. */
  setupCached: boolean;
  /** The run command, e.g. "python main.py". */
  run: string;
  exitCode: number | null;
  runner: string | null;
}

/** One frame of the running program's call stack (only the user's own code is shown). */
export interface RunFrame {
  /** Qualified function name, e.g. "Circle.area" or "<module>". */
  fn: string;
  /** Path relative to the project folder. */
  file: string;
  line: number;
}

/** A value returned (or yielded) by one of the program's functions. */
export interface RunReturn {
  fn: string;
  /** Name of the returned value's type, e.g. "int", "list", "None". */
  type: string;
  /** Short repr of the value. */
  value: string;
  /** The declared return annotation, when the function has one. */
  declared: string | null;
  yielded: boolean;
}

/** Per function totals for the run monitor and the report. */
export interface RunFnStat {
  fn: string;
  file: string;
  calls: number;
  /** Distinct return types seen (at most 4). */
  types: string[];
  /** Short repr of the last value shown. */
  value: string;
  declared: string | null;
}

/** The running program waits for a line on stdin (input(), getpass, sys.stdin.readline ...). */
export interface InputRequest {
  taskId: string;
  requestId: number;
  /** What the program printed as the question, e.g. "Enter radius: ". */
  prompt: string;
  /** True for getpass(): the answer is masked everywhere. */
  secret: boolean;
  /** The function that asked, when known. */
  fn: string | null;
  /** Wall clock epoch ms when the program started waiting. */
  since: number;
  /** The last few output lines before the question. */
  context: string[];
}

/** starting: the crew is getting ready (Ghost walks to his PC); setup / run: a process runs. */
export type RunPhase = 'starting' | 'setup' | 'run' | 'done';
export type RunOutcome = 'ok' | 'error' | 'stopped' | 'setup_failed';

/** Live execution state of the current (or last) run, shown in the run monitor. */
export interface RunState {
  taskId: string;
  codeName: string;
  phase: RunPhase;
  /** The command running now (a setup line or the run command). */
  command: string;
  /** Wall clock epoch ms when the current phase started. */
  startedAt: number;
  finishedAt: number | null;
  /** e.g. "Python 3.12.0 (project venv)". */
  python: string | null;
  /** How calls are traced: "monitoring" (Python 3.12+), "profile" or "off". */
  traceMode: string;
  current: RunFrame | null;
  /** Outermost first. */
  stack: RunFrame[];
  /** Newest last. */
  lastReturns: RunReturn[];
  top: RunFnStat[];
  calls: number;
  returns: number;
  stdoutLines: number;
  stderrLines: number;
  inputs: number;
  exception: { type: string; message: string; fn: string | null; line: number | null } | null;
  waitingInput: InputRequest | null;
  exitCode: number | null;
  outcome: RunOutcome | null;
}

/** A saved project: code plus its setup and run commands, ready for one click runs. */
export interface ProjectInfo {
  id: string;
  name: string;
  kind: CodeKind;
  /** The main file, e.g. "main.py". */
  entry: string | null;
  fileCount: number;
  totalBytes: number;
  setup: string[];
  run: string;
  createdAt: number;
  updatedAt: number;
  /** The setup ran OK for the current files and setup commands (its packages are installed). */
  setupDone: boolean;
  lastRun: { taskId: string; at: number; ok: boolean; exitCode: number | null } | null;
}

export interface ResultInfo {
  taskId: string;
  title: string;
  summary: string;
  /** Markdown report: output, functions, return types, inputs, files changed. */
  report: string;
  codeName: string;
  command: string;
  projectName: string | null;
  ok: boolean;
  outcome: RunOutcome;
  exitCode: number | null;
  runtimeMs: number;
  calls: number;
  outputLines: number;
  createdAt: number;
}

export interface DialogueInfo {
  id: string;
  from: AgentId;
  to: AgentId | null;
  text: string;
  /** Sim ms. */
  duration: number;
  kind: BubbleKind;
  /** Sim clock when the bubble appeared. */
  startClock: number;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  /** "SYSTEM" or an upper case agent name such as "GHOST". */
  source: string;
  text: string;
  /** Wall clock epoch ms on the server. */
  timestamp: number;
  channel: LogChannel;
}

export interface FxEvent {
  id: string;
  type: FxType;
  /** World pixel position. */
  x: number;
  y: number;
  /** Optional travel target in world pixels (packet flights). */
  toX?: number;
  toY?: number;
  /** Sim clock when the effect starts. */
  startClock: number;
  /** Sim ms. */
  duration: number;
}

export interface WorldProps {
  racksBusy: boolean;
  /** Index of the server rack that is overheating, or null. */
  rackOverheat: number | null;
  mailbox: 'empty' | 'full';
  /** Text scrolled on the command center monitor wall. */
  monitorText: string;
  deskScreen: DeskScreen;
  /** The cat is awake while the sim clock is below this value. */
  catAwakeUntil: number;
  /** Sim clock of the last lightning flash in the rain windows. */
  lightningAt: number;
  stats: {
    tasksDone: number;
    tasksFailed: number;
    tasksCancelled: number;
  };
}

export interface ClockInfo {
  /** Sim time in ms. Advances with the speed multiplier, frozen while paused. */
  worldClock: number;
  speed: number;
  paused: boolean;
  /** Server wall clock epoch ms when this clock value was taken. */
  serverTime: number;
  propAnimFrame: number;
}

export interface UploadLimits {
  /** A single .py file. */
  maxFileBytes: number;
  /** A whole project folder. */
  maxProjectBytes: number;
  maxProjectFiles: number;
  /** Any one file inside a project folder. */
  maxPerFileBytes: number;
}

export interface ServerConfig {
  version: string;
  /** Running code is switched on for this server (RUNROOM_RUN is not "off"). */
  runEnabled: boolean;
  /** This viewer may start runs (admin, and running is switched on). */
  canRun: boolean;
  /** 'admin' = full access (upload, run, save, control the office); 'guest' = watch only. */
  role: 'admin' | 'guest';
  /** An admin password is set, so full access needs logging in; otherwise everyone is admin. */
  passwordRequired: boolean;
  /** e.g. "Python 3.12.0", or null when no Python 3.8+ was found. */
  python: string | null;
  limits: UploadLimits;
  tickRate: number;
  propFrameMs: number;
}
