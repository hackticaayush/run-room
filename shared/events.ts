// The RUN ROOM event protocol, shared by server and client.
//
// Every WebSocket frame from the server is a JSON array of ServerEvent envelopes
// ({ type, payload }). Every frame from a client is a single ClientCommand envelope.
// The server is authoritative: it broadcasts the same events to ALL connected clients.

import { MAX_COMMAND_LENGTH, MAX_INPUT_LENGTH, MAX_PROJECT_NAME, MAX_SETUP_LINES } from './constants';
import {
  PRIORITIES,
  type AgentId,
  type AgentState,
  type ClockInfo,
  type DialogueInfo,
  type FxEvent,
  type InputRequest,
  type LogEntry,
  type PathPoint,
  type Priority,
  type ProjectInfo,
  type ResultInfo,
  type RunState,
  type ServerConfig,
  type TaskInfo,
  type TaskStatus,
  type TaskStep,
  type WorldProps,
} from './types';

export type AmbientKind =
  | 'racks_busy'
  | 'rack_overheat'
  | 'mailbox'
  | 'monitor_text'
  | 'desk_screen'
  | 'cat'
  | 'lightning'
  | 'stats';

/** Server -> ALL clients (a few are sent to one client only, noted below). */
export interface ServerEventMap {
  /** Sent to one client right after it connects. */
  HELLO: { clientId: string; config: ServerConfig };
  /** Full world state. Sent on connect and on REQUEST_SNAPSHOT so late joiners sync instantly. */
  STATE_SNAPSHOT: {
    agents: AgentState[];
    taskQueue: TaskInfo[];
    worldClock: number;
    propAnimFrame: number;
    clock: ClockInfo;
    world: WorldProps;
    logs: LogEntry[];
    results: ResultInfo[];
    dialogues: DialogueInfo[];
    fx: FxEvent[];
    clients: number;
    projects: ProjectInfo[];
    /** The current run, or the last one once it finished. */
    run: RunState | null;
  };
  /** Sim clock sync, sent periodically and on pause / resume / speed changes. */
  CLOCK: ClockInfo;
  /** Full agent state (a superset of { agentId, state, station, mood, energy, xp, level }). */
  AGENT_STATE: AgentState;
  /** A walk along a tile path. Clients animate it from startClock at speed tiles per sim second. */
  AGENT_MOVE: { agentId: AgentId; path: PathPoint[]; startClock: number; speed: number };
  DIALOGUE: DialogueInfo;
  LOG: LogEntry;
  TASK_UPDATE: {
    taskId: string;
    status: TaskStatus;
    stepIndex: number;
    steps: TaskStep[];
    progress: number;
    task: TaskInfo;
  };
  RESULT: ResultInfo;
  FX: FxEvent;
  /** A change to shared props (racks, mailbox, monitor wall, cat, weather). Carries the full world props. */
  AMBIENT: { type: AmbientKind; world: WorldProps };
  /** Number of connected viewers. */
  CLIENTS: { count: number };
  /** Live execution state of the current run (current function, stack, returns), a few times a second. */
  RUN_STATE: RunState;
  /** The running program waits for a line of input. Every viewer sees the prompt; the first answer wins. */
  INPUT_REQUEST: InputRequest;
  /** The input request was answered, or dropped because the run ended. */
  INPUT_DONE: { taskId: string; requestId: number; by: string | null; shown: string | null; cancelled: boolean };
  /** The saved projects changed. */
  PROJECTS: { projects: ProjectInfo[] };
  /** Sent only to one client: a rejected command or other notice. */
  NOTICE: { level: 'info' | 'warn' | 'error'; text: string };
}

export type ServerEventType = keyof ServerEventMap;
export type ServerEvent = {
  [K in ServerEventType]: { type: K; payload: ServerEventMap[K] };
}[ServerEventType];
export type ServerEventOf<K extends ServerEventType> = Extract<ServerEvent, { type: K }>;

/** Where the code of a run comes from: a fresh upload or a saved project. */
export type RunSource = { kind: 'upload'; uploadId: string } | { kind: 'project'; projectId: string };

/** ALL clients -> server. */
export interface ClientCommandMap {
  /**
   * Run Python code. For a saved project, setup and run default to the saved commands.
   * saveAs also saves the upload as a project (and the run then uses that project).
   */
  SUBMIT_TASK: {
    source: RunSource;
    setup?: string[];
    run?: string;
    priority: Priority;
    saveAs?: string;
    overwrite?: boolean;
    /** Run the setup again even when it already ran OK for this saved project. */
    forceSetup?: boolean;
  };
  /** Save an upload with its commands under a name, without running it. */
  SAVE_PROJECT: { uploadId: string; name: string; setup: string[]; run: string; overwrite?: boolean };
  UPDATE_PROJECT: { projectId: string; name?: string; setup?: string[]; run?: string };
  DELETE_PROJECT: { projectId: string };
  /** Answer to INPUT_REQUEST. eof = close the program's stdin (like Ctrl+D). */
  PROVIDE_INPUT: { taskId: string; requestId: number; value: string; eof?: boolean };
  CANCEL_TASK: { taskId: string };
  PAUSE: Record<string, never>;
  RESUME: Record<string, never>;
  SET_SPEED: { multiplier: number };
  GIVE_COFFEE: Record<string, never>;
  /** Extension: clicking the cat. Everyone sees the hearts. */
  PET_CAT: Record<string, never>;
  /** Extension: ask for a fresh STATE_SNAPSHOT (used after a tab wakes up). */
  REQUEST_SNAPSHOT: Record<string, never>;
}

export type ClientCommandType = keyof ClientCommandMap;
export type ClientCommand = {
  [K in ClientCommandType]: { type: K; payload: ClientCommandMap[K] };
}[ClientCommandType];

export const ALLOWED_SPEEDS = [1, 2, 4] as const;
export const UPLOAD_ID_RE = /^up_[0-9a-f]{16}$/;
export const PROJECT_ID_RE = /^p_[0-9a-f]{12}$/;

export function makeEvent<K extends ServerEventType>(type: K, payload: ServerEventMap[K]): ServerEventOf<K> {
  return { type, payload } as ServerEventOf<K>;
}

export function makeCommand<K extends ClientCommandType>(
  type: K,
  payload: ClientCommandMap[K],
): Extract<ClientCommand, { type: K }> {
  return { type, payload } as Extract<ClientCommand, { type: K }>;
}

type ParseResult = { ok: true; command: ClientCommand } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Setup lines: an array of strings (or one string with newlines), trimmed, blank lines dropped. */
function setupLines(v: unknown): string[] | null {
  const list = isStr(v) ? v.split(/\r?\n/) : Array.isArray(v) ? v : null;
  if (!list || !list.every(isStr)) return null;
  const lines = (list as string[]).map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_SETUP_LINES || lines.some((l) => l.length > MAX_COMMAND_LENGTH)) return null;
  return lines;
}

function runText(v: unknown): string | null {
  if (!isStr(v)) return null;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_COMMAND_LENGTH ? t : null;
}

function projectName(v: unknown): string | null {
  if (!isStr(v)) return null;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_PROJECT_NAME ? t : null;
}

/** Validates the shape of an untrusted command coming from a client. Never throws. */
export function parseClientCommand(raw: unknown): ParseResult {
  let data: unknown = raw;
  if (isStr(raw)) {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'invalid JSON' };
    }
  }
  if (!isObj(data) || !isStr(data.type)) return { ok: false, error: 'missing command type' };
  const p = isObj(data.payload) ? data.payload : {};
  const empty = {} as Record<string, never>;
  switch (data.type) {
    case 'SUBMIT_TASK': {
      const src = isObj(p.source) ? p.source : null;
      let source: RunSource;
      if (src?.kind === 'upload' && isStr(src.uploadId) && UPLOAD_ID_RE.test(src.uploadId)) source = { kind: 'upload', uploadId: src.uploadId };
      else if (src?.kind === 'project' && isStr(src.projectId) && PROJECT_ID_RE.test(src.projectId)) source = { kind: 'project', projectId: src.projectId };
      else return { ok: false, error: 'pick a Python file, a project folder or a saved project first' };
      const setup = p.setup === undefined ? undefined : setupLines(p.setup);
      if (setup === null) return { ok: false, error: `setup: at most ${MAX_SETUP_LINES} commands of ${MAX_COMMAND_LENGTH} characters` };
      const run = p.run === undefined ? undefined : runText(p.run);
      if (run === null) return { ok: false, error: 'type the run command, e.g. python main.py' };
      if (source.kind === 'upload' && run === undefined) return { ok: false, error: 'type the run command, e.g. python main.py' };
      const saveAs = p.saveAs === undefined || p.saveAs === '' ? undefined : projectName(p.saveAs);
      if (saveAs === null) return { ok: false, error: `the project name must be 1 to ${MAX_PROJECT_NAME} characters` };
      const priority = (PRIORITIES as readonly string[]).includes(p.priority as string) ? (p.priority as Priority) : 'NORMAL';
      return {
        ok: true,
        command: makeCommand('SUBMIT_TASK', {
          source,
          ...(setup !== undefined ? { setup } : {}),
          ...(run !== undefined ? { run } : {}),
          priority,
          ...(saveAs ? { saveAs, overwrite: p.overwrite === true } : {}),
          forceSetup: p.forceSetup === true,
        }),
      };
    }
    case 'SAVE_PROJECT': {
      if (!isStr(p.uploadId) || !UPLOAD_ID_RE.test(p.uploadId)) return { ok: false, error: 'upload the code first' };
      const name = projectName(p.name);
      if (!name) return { ok: false, error: `the project name must be 1 to ${MAX_PROJECT_NAME} characters` };
      const setup = setupLines(p.setup ?? []);
      if (!setup) return { ok: false, error: `setup: at most ${MAX_SETUP_LINES} commands of ${MAX_COMMAND_LENGTH} characters` };
      const run = runText(p.run);
      if (!run) return { ok: false, error: 'type the run command, e.g. python main.py' };
      return { ok: true, command: makeCommand('SAVE_PROJECT', { uploadId: p.uploadId, name, setup, run, overwrite: p.overwrite === true }) };
    }
    case 'UPDATE_PROJECT': {
      if (!isStr(p.projectId) || !PROJECT_ID_RE.test(p.projectId)) return { ok: false, error: 'unknown project' };
      const out: ClientCommandMap['UPDATE_PROJECT'] = { projectId: p.projectId };
      if (p.name !== undefined) {
        const name = projectName(p.name);
        if (!name) return { ok: false, error: `the project name must be 1 to ${MAX_PROJECT_NAME} characters` };
        out.name = name;
      }
      if (p.setup !== undefined) {
        const setup = setupLines(p.setup);
        if (!setup) return { ok: false, error: `setup: at most ${MAX_SETUP_LINES} commands of ${MAX_COMMAND_LENGTH} characters` };
        out.setup = setup;
      }
      if (p.run !== undefined) {
        const run = runText(p.run);
        if (!run) return { ok: false, error: 'type the run command, e.g. python main.py' };
        out.run = run;
      }
      return { ok: true, command: makeCommand('UPDATE_PROJECT', out) };
    }
    case 'DELETE_PROJECT':
      if (!isStr(p.projectId) || !PROJECT_ID_RE.test(p.projectId)) return { ok: false, error: 'unknown project' };
      return { ok: true, command: makeCommand('DELETE_PROJECT', { projectId: p.projectId }) };
    case 'PROVIDE_INPUT': {
      if (!isStr(p.taskId)) return { ok: false, error: 'taskId must be a string' };
      const requestId = Number(p.requestId);
      if (!Number.isInteger(requestId) || requestId < 1) return { ok: false, error: 'requestId must be a positive integer' };
      const value = isStr(p.value) ? p.value : '';
      if (value.length > MAX_INPUT_LENGTH) return { ok: false, error: `input is longer than ${MAX_INPUT_LENGTH} characters` };
      return { ok: true, command: makeCommand('PROVIDE_INPUT', { taskId: p.taskId, requestId, value, eof: p.eof === true }) };
    }
    case 'CANCEL_TASK':
      if (!isStr(p.taskId)) return { ok: false, error: 'taskId must be a string' };
      return { ok: true, command: makeCommand('CANCEL_TASK', { taskId: p.taskId }) };
    case 'SET_SPEED': {
      const m = Number(p.multiplier);
      if (!(ALLOWED_SPEEDS as readonly number[]).includes(m)) return { ok: false, error: 'speed must be 1, 2 or 4' };
      return { ok: true, command: makeCommand('SET_SPEED', { multiplier: m }) };
    }
    case 'PAUSE':
    case 'RESUME':
    case 'GIVE_COFFEE':
    case 'PET_CAT':
    case 'REQUEST_SNAPSHOT':
      return { ok: true, command: { type: data.type, payload: empty } as ClientCommand };
    default:
      return { ok: false, error: `unknown command ${String(data.type).slice(0, 40)}` };
  }
}
