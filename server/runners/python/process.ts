// Process helpers for the Python runner: finding Python, virtual environment paths, the child
// environment, line splitting with UTF-8 safety, and killing a whole process tree.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface PythonInfo {
  /** Absolute path of the interpreter. */
  exe: string;
  /** e.g. "3.12.0". */
  version: string;
}

const PROBE = 'import sys; print(sys.executable); print("%d.%d.%d" % tuple(sys.version_info[:3]))';

function probe(cmd: string, args: string[]): Promise<PythonInfo | null> {
  return new Promise((resolve) => {
    let out = '';
    let child: ChildProcess;
    try {
      child = spawn(cmd, [...args, '-c', PROBE], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 10000);
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < 4096) out += d.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const [exe, version] = out.trim().split(/\r?\n/);
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
      if (code !== 0 || !exe || !m) return resolve(null);
      // The Windows Store alias prints an install hint instead; old Pythons are not supported.
      if (Number(m[1]) !== 3 || Number(m[2]) < 8) return resolve(null);
      resolve({ exe: exe.trim(), version });
    });
  });
}

let found: Promise<PythonInfo | null> | null = null;

/**
 * Finds a Python 3.8+ interpreter: $PYTHON (a path or command), then python3, python and the
 * Windows "py -3" launcher. Cached for the life of the server.
 */
export function findPython(): Promise<PythonInfo | null> {
  found ??= (async () => {
    const candidates: [string, string[]][] = [];
    if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
    candidates.push(['python3', []], ['python', []], ['py', ['-3']]);
    for (const [cmd, args] of candidates) {
      const info = await probe(cmd, args);
      if (info) return info;
    }
    return null;
  })();
  return found;
}

/** Interpreter inside a virtual environment folder. */
export function venvPython(venvDir: string): string {
  return process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');
}

export function venvReady(venvDir: string): boolean {
  return existsSync(venvPython(venvDir)) && existsSync(join(venvDir, 'pyvenv.cfg'));
}

/**
 * The child environment: the server's own environment (programs behave as in the user's terminal)
 * plus UTF-8 output, unbuffered streams, no pip prompts, and the virtual environment "activated".
 * The admin password is left out: a program's output is shown to every viewer, guests included.
 */
export function childEnv(venvDir: string | null, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PYTHONHOME;
  // Windows environment names ignore case, so match the name in any spelling.
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'RUNROOM_ACCESS_PASSWORD') delete env[k];
  if (venvDir) {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const bin = process.platform === 'win32' ? join(venvDir, 'Scripts') : join(venvDir, 'bin');
    env[pathKey] = env[pathKey] ? `${bin}${delimiter}${env[pathKey]}` : bin;
    env.VIRTUAL_ENV = venvDir;
  }
  return {
    ...env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    ...extra,
  };
}

const live = new Set<ChildProcess>();

/** Spawns without a shell. POSIX children get their own process group so the tree can be killed. */
export function spawnTracked(exe: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; extraFd?: boolean }): ChildProcess {
  const child = spawn(exe, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: opts.extraFd ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
  live.add(child);
  child.once('close', () => live.delete(child));
  child.once('error', () => live.delete(child));
  return child;
}

/** Kills a process and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    k.on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Kills every program still running (server shutdown). */
export function killAllChildren(): void {
  for (const c of live) killTree(c);
}

process.once('exit', () => {
  // Synchronous best effort: POSIX process groups. Windows children die with the console.
  if (process.platform === 'win32') return;
  for (const c of live) {
    try {
      if (c.pid !== undefined) process.kill(-c.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
});

/** Splits a byte stream into lines (UTF-8 safe across chunks). */
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  push(chunk: Buffer): string[] {
    this.pending += this.decoder.write(chunk);
    const parts = this.pending.split(/\r?\n/);
    this.pending = parts.pop() ?? '';
    return parts;
  }

  /** The unfinished last line (e.g. a prompt without a newline). */
  get partial(): string {
    return this.pending;
  }

  /** Takes the unfinished line out (it is shown as its own line). */
  takePartial(): string {
    const p = this.pending;
    this.pending = '';
    return p;
  }

  end(): string[] {
    this.pending += this.decoder.end();
    const rest = this.pending;
    this.pending = '';
    return rest ? [rest] : [];
  }
}

/** Push based async queue: turns process callbacks into an async iterator. */
export class EventQueue<T> {
  private items: T[] = [];
  private waiters: ((v: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<T>>((res) => this.waiters.push(res));
      if (r.done) return;
      yield r.value;
    }
  }
}
