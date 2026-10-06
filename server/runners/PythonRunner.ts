// PythonRunner: runs the user's own Python code on this computer.
//   setup(): makes the code's virtual environment once (python -m venv --system-site-packages, so
//            packages already installed on the computer keep working) and runs the setup commands
//            inside it, streaming their output.
//   run():   runs the program under python/runroom_harness.py, which reports function calls,
//            return values and types, the call stack, input prompts and exceptions on a private
//            pipe (fd 3). Answers typed by the viewers are written to the program's stdin.
// This is NOT a sandbox: the program runs as a normal process with the user's own permissions.
// Commands are never passed to a shell (see shared/commands.ts).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ParsedCommand } from '../../shared/commands';
import { ALWAYS_SKIPPED_DIRS } from '../../shared/projectFiles';
import type { RunFnStat, RunFrame, RunOutcome } from '../../shared/types';
import type { RunnerContext, RunnerEvent, RunnerTask, TaskRunner } from './TaskRunner';
import { childEnv, EventQueue, findPython, killTree, LineSplitter, spawnTracked, venvPython, venvReady } from './python/process';
import { buildRunReport, CapturedLines, summarize, type FileChange, type ReportInput } from './python/report';

export const HARNESS = fileURLToPath(new URL('./python/runroom_harness.py', import.meta.url));

const NO_PYTHON = 'no Python 3.8+ found on this computer: install Python 3 (python.org) or set PYTHON to its path';

export interface PythonRunnerOptions {
  /** Real time limit per setup command (default 20 minutes). */
  setupTimeoutMs?: number;
  /** Real time limit for the program, not counting time spent waiting for input (default 60 minutes). */
  runTimeoutMs?: number;
  /** auto (sys.monitoring when available), monitoring, profile or off. */
  trace?: string;
  /** Output kept per stream for the report (default 1 MB). */
  maxCaptureBytes?: number;
  /** An unfinished output line (a prompt, progress dots) is shown after this long (default 400 ms). */
  partialFlushMs?: number;
}

/** The interpreter arguments of a parsed setup command. */
export function commandArgs(cmd: ParsedCommand): string[] {
  if (cmd.tool === 'pip') return ['-m', 'pip', ...cmd.args];
  const t = cmd.target;
  if (!t) return [...cmd.pyOptions, ...cmd.args];
  if (t.mode === 'file') return [...cmd.pyOptions, t.path, ...cmd.args];
  if (t.mode === 'module') return [...cmd.pyOptions, '-m', t.name, ...cmd.args];
  return [...cmd.pyOptions, '-c', t.code, ...cmd.args];
}

type FileStamp = { size: number; mtimeMs: number };

/** Sizes and times of the code's files (caches and virtual environments skipped, at most 5000). */
export function snapshotFiles(root: string): Map<string, FileStamp> {
  const out = new Map<string, FileStamp>();
  const walk = (dir: string, rel: string) => {
    if (out.size >= 5000) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (rel && names.includes('pyvenv.cfg')) return;
    for (const name of names) {
      if (out.size >= 5000) return;
      const full = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          if (!ALWAYS_SKIPPED_DIRS.includes(name)) walk(full, r);
        } else if (st.isFile() && !/\.py[co]$/i.test(name)) {
          out.set(r, { size: st.size, mtimeMs: st.mtimeMs });
        }
      } catch {
        // vanished meanwhile
      }
    }
  };
  walk(root, '');
  return out;
}

export function diffFiles(before: Map<string, FileStamp>, after: Map<string, FileStamp>): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, st] of after) {
    const old = before.get(path);
    if (!old) changes.push({ path, size: st.size, kind: 'created' });
    else if (old.size !== st.size || old.mtimeMs !== st.mtimeMs) changes.push({ path, size: st.size, kind: 'changed' });
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push({ path, size: 0, kind: 'deleted' });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : v === undefined || v === null ? '' : String(v).slice(0, max));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function frames(v: unknown): RunFrame[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-12).map((f: Record<string, unknown>) => ({ fn: str(f?.fn, 120), file: str(f?.file, 200), line: num(f?.line) ?? 0 }));
}

function fnStats(v: unknown): RunFnStat[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map((f: Record<string, unknown>) => ({
    fn: str(f?.fn, 120),
    file: str(f?.file, 200),
    calls: num(f?.calls) ?? 0,
    types: Array.isArray(f?.types) ? (f.types as unknown[]).slice(0, 4).map((t) => str(t, 40)) : [],
    value: str(f?.val, 100),
    declared: f?.decl ? str(f.decl, 60) : null,
  }));
}

export class PythonRunner implements TaskRunner {
  readonly name = 'python';
  private readonly setupTimeoutMs: number;
  private readonly runTimeoutMs: number;
  private readonly trace: string;
  private readonly maxCapture: number;
  private readonly partialFlushMs: number;

  constructor(opts: PythonRunnerOptions = {}) {
    this.setupTimeoutMs = opts.setupTimeoutMs ?? 20 * 60 * 1000;
    this.runTimeoutMs = opts.runTimeoutMs ?? 60 * 60 * 1000;
    this.trace = opts.trace ?? 'auto';
    this.maxCapture = opts.maxCaptureBytes ?? 1024 * 1024;
    this.partialFlushMs = opts.partialFlushMs ?? 400;
  }

  // --- setup ----------------------------------------------------------------------------------

  async *setup(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent> {
    if (task.setup.length === 0) {
      yield { kind: 'setup_done', ok: true, failed: null, exitCode: 0 };
      return;
    }
    const base = await findPython();
    if (!base) {
      yield { kind: 'error', text: NO_PYTHON };
      yield { kind: 'setup_done', ok: false, failed: task.setup[0].text, exitCode: null };
      return;
    }
    let py = base.exe;
    let venv: string | null = null;
    if (venvReady(task.venvDir)) {
      py = venvPython(task.venvDir);
      venv = task.venvDir;
      yield { kind: 'log', text: 'using the virtual environment of this code', channel: 'setup' };
    } else {
      yield { kind: 'log', text: 'creating a virtual environment for this code (python -m venv --system-site-packages)', channel: 'setup' };
      const r = yield* this.exec(base.exe, ['-m', 'venv', '--system-site-packages', task.venvDir], task.workDir, null, ctx, this.setupTimeoutMs);
      if (ctx.signal.aborted) return;
      if (r === 0 && venvReady(task.venvDir)) {
        py = venvPython(task.venvDir);
        venv = task.venvDir;
      } else {
        yield { kind: 'log', level: 'warn', text: 'could not create a virtual environment: using the system Python instead', channel: 'setup' };
      }
    }
    for (let index = 0; index < task.setup.length; index++) {
      const cmd = task.setup[index];
      yield { kind: 'setup_step', index, command: cmd.text };
      const code = yield* this.exec(py, commandArgs(cmd), task.workDir, venv, ctx, this.setupTimeoutMs);
      if (ctx.signal.aborted) return;
      if (code !== 0) {
        yield { kind: 'setup_done', ok: false, failed: cmd.text, exitCode: code };
        return;
      }
    }
    yield { kind: 'setup_done', ok: true, failed: null, exitCode: 0 };
  }

  /** Runs one setup process, streaming its output. Returns the exit code (null = killed). */
  private async *exec(
    exe: string,
    args: string[],
    cwd: string,
    venv: string | null,
    ctx: RunnerContext,
    timeoutMs: number,
  ): AsyncGenerator<RunnerEvent, number | null> {
    const q = new EventQueue<RunnerEvent>();
    const out = new LineSplitter();
    const err = new LineSplitter();
    let timedOut = false;
    let startError: string | null = null;
    const child = spawnTracked(exe, args, { cwd, env: childEnv(venv) });
    child.stdin?.on('error', () => {});
    child.stdin?.end();
    const done = new Promise<number | null>((resolveDone) => {
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      const onAbort = () => killTree(child);
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        for (const l of out.end()) q.push({ kind: 'stdout', text: l });
        for (const l of err.end()) q.push({ kind: 'stderr', text: l });
        resolveDone(code);
      };
      child.stdout?.on('data', (d: Buffer) => out.push(d).forEach((l) => q.push({ kind: 'stdout', text: l })));
      child.stderr?.on('data', (d: Buffer) => err.push(d).forEach((l) => q.push({ kind: 'stderr', text: l })));
      child.on('error', (e) => {
        startError = e.message;
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
    void done.then(() => q.close());
    for await (const ev of q) yield ev;
    const code = await done;
    if (timedOut) yield { kind: 'stderr', text: `timed out after ${Math.round(timeoutMs / 60000)} minutes and was stopped` };
    if (startError) yield { kind: 'stderr', text: `could not start: ${startError}` };
    return timedOut ? null : code;
  }

  // --- run --------------------------------------------------------------------------------------

  async *run(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent> {
    const started = performance.now();
    const stdout = new CapturedLines(this.maxCapture);
    const stderr = new CapturedLines(this.maxCapture);
    const base = await findPython();
    const venv = venvReady(task.venvDir) ? task.venvDir : null;
    const report = (r: Partial<ReportInput> & Pick<ReportInput, 'outcome'>): RunnerEvent => {
      const input: ReportInput = {
        taskId: task.id,
        codeName: task.codeName,
        command: task.run.text,
        python: base ? `Python ${base.version}` : null,
        usedVenv: Boolean(venv),
        traceMode: this.trace,
        exitCode: null,
        runtimeMs: Math.round(performance.now() - started),
        waitedMs: 0,
        stdout,
        stderr,
        calls: 0,
        returns: 0,
        top: [],
        exception: null,
        inputs: [],
        files: [],
        ...r,
      };
      return {
        kind: 'result',
        summary: summarize(input),
        report: buildRunReport(input),
        ok: input.outcome === 'ok',
        outcome: input.outcome,
        exitCode: input.exitCode,
        calls: input.calls,
        outputLines: stdout.total,
        runtimeMs: input.runtimeMs,
      };
    };

    if (!base) {
      yield { kind: 'error', text: NO_PYTHON };
      yield report({ outcome: 'error', note: NO_PYTHON });
      return;
    }
    const target = task.run.target;
    if (!target) {
      yield { kind: 'error', text: 'the run command does not say what to run' };
      yield report({ outcome: 'error', note: 'the run command does not say what to run' });
      return;
    }
    if (target.mode === 'file') {
      const root = resolve(task.workDir);
      const abs = resolve(root, target.path);
      if (!abs.startsWith(root + sep) || !existsSync(abs)) {
        const msg = `cannot find ${target.path} in ${task.codeName}`;
        yield { kind: 'error', text: msg };
        yield report({ outcome: 'error', note: msg });
        return;
      }
    }

    const before = snapshotFiles(task.workDir);
    const py = venv ? venvPython(venv) : base.exe;
    const targetArg = target.mode === 'file' ? target.path : target.mode === 'module' ? target.name : target.code;
    const args = [...task.run.pyOptions, '-u', '-X', 'utf8', HARNESS, target.mode, targetArg, ...task.run.args];
    const env = childEnv(venv, { RUNROOM_EVENT_FD: '3', RUNROOM_PROJECT_ROOT: resolve(task.workDir), RUNROOM_TRACE: this.trace });
    const child = spawnTracked(py, args, { cwd: task.workDir, env, extraFd: true });
    child.stdin?.on('error', () => {});

    const q = new EventQueue<RunnerEvent>();
    let traceMode = this.trace === 'off' ? 'off' : 'starting';
    let python = `Python ${base.version}`;
    let calls = 0;
    let returns = 0;
    let top: RunFnStat[] = [];
    let exception: ReportInput['exception'] = null;
    let harnessExit: number | null = null;
    const inputs: ReportInput['inputs'] = [];
    let pending: { id: number; prompt: string; secret: boolean; since: number } | null = null;
    let waitedMs = 0;
    let timedOut = false;
    let startError: string | null = null;

    const outSplit = new LineSplitter();
    const errSplit = new LineSplitter();
    const evSplit = new LineSplitter();
    let partialTimer: NodeJS.Timeout | null = null;
    const pushOut = (line: string) => {
      stdout.push(line);
      q.push({ kind: 'stdout', text: line });
    };
    const flushPartial = () => {
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = null;
      const p = outSplit.takePartial();
      if (p) pushOut(p);
    };

    const onHarness = (line: string) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (ev.t) {
        case 'hello':
          python = `Python ${str(ev.py, 20)}`;
          traceMode = str(ev.trace, 20);
          q.push({ kind: 'hello', python, traceMode, pid: num(ev.pid) });
          break;
        case 'call':
          q.push({ kind: 'call', fn: str(ev.fn, 120), file: str(ev.file, 200), line: num(ev.line) ?? 0, args: str(ev.args, 120), depth: num(ev.d) ?? 0 });
          break;
        case 'ret':
          q.push({
            kind: 'return',
            fn: str(ev.fn, 120),
            type: str(ev.type, 60),
            value: str(ev.val, 120),
            declared: ev.decl ? str(ev.decl, 60) : null,
            depth: num(ev.d) ?? 0,
            yielded: ev.y === 1,
          });
          break;
        case 'unwind':
          q.push({ kind: 'unwind', fn: str(ev.fn, 120), type: str(ev.type, 60), message: str(ev.msg, 160) });
          break;
        case 'stack':
          q.push({ kind: 'stack', frames: frames(ev.frames) });
          break;
        case 'stats':
          calls = num(ev.calls) ?? calls;
          returns = num(ev.rets) ?? returns;
          top = fnStats(ev.top);
          q.push({ kind: 'stats', calls, returns, yields: num(ev.ylds) ?? 0, top });
          break;
        case 'input': {
          // Show the question in the terminal right away (it has no newline yet).
          flushPartial();
          const id = num(ev.id) ?? 0;
          const prompt = str(ev.prompt, 300);
          pending = { id, prompt, secret: ev.secret === true, since: performance.now() };
          q.push({ kind: 'input_request', requestId: id, prompt, secret: ev.secret === true, fn: ev.fn ? str(ev.fn, 120) : null });
          break;
        }
        case 'input_done':
          q.push({ kind: 'input_done', requestId: num(ev.id) ?? 0 });
          break;
        case 'exc':
          exception = {
            type: str(ev.type, 80),
            message: str(ev.msg, 500),
            fn: ev.fn ? str(ev.fn, 120) : null,
            file: ev.file ? str(ev.file, 200) : null,
            line: num(ev.line),
          };
          q.push({ kind: 'exception', ...exception });
          break;
        case 'exit':
          harnessExit = num(ev.code);
          q.push({ kind: 'exit', code: harnessExit });
          break;
      }
    };

    child.stdout?.on('data', (d: Buffer) => {
      outSplit.push(d).forEach(pushOut);
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = outSplit.partial ? setTimeout(flushPartial, this.partialFlushMs) : null;
    });
    child.stderr?.on('data', (d: Buffer) =>
      errSplit.push(d).forEach((l) => {
        stderr.push(l);
        q.push({ kind: 'stderr', text: l });
      }),
    );
    (child.stdio[3] as Readable | null)?.on('data', (d: Buffer) => evSplit.push(d).forEach(onHarness));

    ctx.input.attach((value) => {
      if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) return;
      // The question ends here, like in a terminal where the answer is typed after it.
      flushPartial();
      if (pending) {
        waitedMs += performance.now() - pending.since;
        inputs.push({ prompt: pending.prompt, value, secret: pending.secret });
        pending = null;
      } else {
        inputs.push({ prompt: '', value, secret: false });
      }
      if (value === null) child.stdin.end();
      else child.stdin.write(`${value}\n`);
    });

    const onAbort = () => killTree(child);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const watchdog = setInterval(() => {
      const now = performance.now();
      const active = now - started - waitedMs - (pending ? now - pending.since : 0);
      if (active > this.runTimeoutMs) {
        timedOut = true;
        killTree(child);
      }
    }, 1000);

    const done = new Promise<number | null>((resolveDone) => {
      let settled = false;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        ctx.signal.removeEventListener('abort', onAbort);
        ctx.input.detach();
        flushPartial();
        outSplit.end().forEach(pushOut);
        errSplit.end().forEach((l) => {
          stderr.push(l);
          q.push({ kind: 'stderr', text: l });
        });
        evSplit.end().forEach(onHarness);
        resolveDone(code);
      };
      child.on('error', (e) => {
        startError = e.message;
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
    void done.then(() => q.close());
    for await (const ev of q) yield ev;
    const code = await done;

    if (pending) waitedMs += performance.now() - (pending as { since: number }).since;
    let note: string | undefined;
    if (timedOut) note = `stopped after the time limit of ${Math.round(this.runTimeoutMs / 60000)} minutes`;
    if (startError) note = `could not start Python: ${startError}`;
    if (note) yield { kind: 'stderr', text: note };
    const outcome: RunOutcome = ctx.signal.aborted ? 'stopped' : code === 0 && !timedOut && !startError ? 'ok' : 'error';
    yield report({
      outcome,
      exitCode: code ?? harnessExit,
      waitedMs: Math.round(waitedMs),
      python: `${python}`,
      traceMode,
      calls,
      returns,
      top,
      exception,
      inputs,
      files: diffFiles(before, snapshotFiles(task.workDir)),
      note,
    });
  }
}
