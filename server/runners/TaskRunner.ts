// TaskRunner: the real work behind a run. RUN ROOM ships one runner, PythonRunner, which runs
// the user's own Python code in two stages: the setup commands (if any), then the run command
// under a tracing harness. The office (TaskDirector) decides WHEN each stage starts (setup once
// Byte stands at the server racks, the program once Ghost sits at his PC) and turns the streamed
// events into terminal lines, speech bubbles and the run monitor.
//
// Rules for every runner: only work inside the task's own code folder, no network scanning, no
// probing, no exploit code. (The user's program itself is the user's own code.)

import type { ParsedCommand } from '../../shared/commands';
import type { LogChannel, LogLevel, RunFnStat, RunFrame, RunOutcome } from '../../shared/types';

export type RunnerEvent =
  | { kind: 'log'; text: string; level?: LogLevel; channel?: LogChannel }
  | { kind: 'stdout'; text: string }
  | { kind: 'stderr'; text: string }
  | { kind: 'hello'; python: string; traceMode: string; pid: number | null }
  | { kind: 'call'; fn: string; file: string; line: number; args: string; depth: number }
  | { kind: 'return'; fn: string; type: string; value: string; declared: string | null; depth: number; yielded: boolean }
  | { kind: 'unwind'; fn: string; type: string; message: string }
  | { kind: 'stack'; frames: RunFrame[] }
  | { kind: 'stats'; calls: number; returns: number; yields: number; top: RunFnStat[] }
  | { kind: 'input_request'; requestId: number; prompt: string; secret: boolean; fn: string | null }
  | { kind: 'input_done'; requestId: number }
  | { kind: 'exception'; type: string; message: string; fn: string | null; file: string | null; line: number | null }
  | { kind: 'setup_step'; index: number; command: string }
  | { kind: 'setup_done'; ok: boolean; failed: string | null; exitCode: number | null }
  | { kind: 'exit'; code: number | null }
  | {
      kind: 'result';
      summary: string;
      report: string;
      ok: boolean;
      outcome: RunOutcome;
      exitCode: number | null;
      calls: number;
      outputLines: number;
      runtimeMs: number;
    }
  | { kind: 'error'; text: string };

export type ResultEvent = Extract<RunnerEvent, { kind: 'result' }>;

export interface RunnerTask {
  id: string;
  title: string;
  /** The file name or folder name of the code. */
  codeName: string;
  /** Absolute folder with the code. Programs run with it as their working directory. */
  workDir: string;
  /** Where the code's virtual environment lives (created by the first setup that needs it). */
  venvDir: string;
  setup: ParsedCommand[];
  run: ParsedCommand;
  projectName: string | null;
}

/** Lets the office hand a typed line (or the end of input) to the running program. */
export class InputBridge {
  private handler: ((value: string | null) => void) | null = null;

  attach(handler: (value: string | null) => void): void {
    this.handler = handler;
  }

  detach(): void {
    this.handler = null;
  }

  /** Delivers a line (null = end of input). False when nothing is listening. */
  provide(value: string | null): boolean {
    if (!this.handler) return false;
    this.handler(value);
    return true;
  }
}

export interface RunnerContext {
  /** Aborted when the user presses STOP / CANCEL. Runners must stop promptly. */
  signal: AbortSignal;
  input: InputBridge;
}

export interface TaskRunner {
  name: string;
  /** Runs the setup commands. The stream ends with setup_done. */
  setup(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent>;
  /** Runs the program. The stream ends with result. */
  run(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent>;
}
