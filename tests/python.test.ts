// The real Python runner and its tracing harness (skipped when no Python 3.8+ is installed).

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommand, type ParsedCommand } from '../shared/commands';
import { PythonRunner } from '../server/runners/PythonRunner';
import { findPython, venvReady } from '../server/runners/python/process';
import { InputBridge, type RunnerEvent, type RunnerTask } from '../server/runners/TaskRunner';

const python = await findPython();

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'runroom-py-'));
  const code = join(dir, 'files');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(code, ...rel.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return code;
}

const cmd = (text: string, role: 'run' | 'setup') => {
  const c = parseCommand(text, role);
  if ('error' in c) throw new Error(c.error);
  return c as ParsedCommand;
};

function task(workDir: string, run: string, setup: string[] = []): RunnerTask {
  return {
    id: 'T900',
    title: 'test run',
    codeName: 'proj',
    workDir,
    venvDir: join(workDir, '..', 'venv'),
    setup: setup.map((s) => cmd(s, 'setup')),
    run: cmd(run, 'run'),
    projectName: null,
  };
}

async function collect(stream: AsyncIterable<RunnerEvent>, on?: (ev: RunnerEvent) => void): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  for await (const ev of stream) {
    out.push(ev);
    on?.(ev);
  }
  return out;
}

const kinds = <K extends RunnerEvent['kind']>(evs: RunnerEvent[], kind: K) => evs.filter((e) => e.kind === kind) as Extract<RunnerEvent, { kind: K }>[];
const result = (evs: RunnerEvent[]) => kinds(evs, 'result')[0];

const MAIN = `from geo.shapes import Circle, countdown


def parse_radius(text: str) -> float:
    return float(text)


def describe(c: Circle) -> str:
    return "area %.2f" % c.area()


def main():
    name = input("Your name: ")
    print("hello", name)
    r = parse_radius(input("Radius: "))
    print(describe(Circle(r)))
    print(list(countdown(3)))
    if r > 100:
        raise ValueError("radius too big: %s" % r)
    with open("out.txt", "w") as f:
        f.write("done")


if __name__ == "__main__":
    main()
`;

const SHAPES = `import math


class Circle:
    def __init__(self, r: float):
        self.r = r

    def area(self) -> float:
        return math.pi * self.r ** 2


def countdown(n):
    while n > 0:
        yield n
        n -= 1
`;

describe.skipIf(!python)('python runner', () => {
  const runner = new PythonRunner({ partialFlushMs: 100 });

  async function runWithAnswers(workDir: string, run: string, answers: (string | null)[]) {
    const input = new InputBridge();
    const ctx = { signal: new AbortController().signal, input };
    const queue = [...answers];
    const events = await collect(runner.run(task(workDir, run), ctx), (ev) => {
      if (ev.kind === 'input_request') setTimeout(() => input.provide(queue.length ? queue.shift()! : null), 20);
    });
    return events;
  }

  it('runs a project, traces calls with return and declared types, and feeds input', async () => {
    const dir = project({ 'main.py': MAIN, 'geo/__init__.py': '', 'geo/shapes.py': SHAPES });
    const evs = await runWithAnswers(dir, 'python main.py', ['Ana', '2.5']);
    const hello = kinds(evs, 'hello')[0];
    expect(hello.python).toMatch(/^Python 3\.\d+\.\d+$/);
    expect(['monitoring', 'profile']).toContain(hello.traceMode);

    const requests = kinds(evs, 'input_request');
    expect(requests.map((r) => [r.prompt, r.fn, r.secret])).toEqual([
      ['Your name: ', 'main', false],
      ['Radius: ', 'main', false],
    ]);
    const out = kinds(evs, 'stdout').map((e) => e.text);
    expect(out).toEqual(expect.arrayContaining(['hello Ana', 'area 19.63', '[3, 2, 1]']));

    const rets = kinds(evs, 'return');
    expect(rets).toContainEqual(expect.objectContaining({ fn: 'parse_radius', type: 'float', value: '2.5', declared: 'float' }));
    expect(rets).toContainEqual(expect.objectContaining({ fn: 'describe', type: 'str', declared: 'str' }));
    expect(rets.some((r) => r.fn.endsWith('area') && r.type === 'float' && r.declared === 'float')).toBe(true);
    expect(rets.some((r) => r.fn === 'countdown' && r.yielded && r.type === 'int')).toBe(true);
    const calls = kinds(evs, 'call');
    expect(calls).toContainEqual(expect.objectContaining({ fn: 'parse_radius', file: 'main.py', args: "text='2.5'" }));
    // Library code (math, the standard library) is never traced.
    expect(calls.every((c) => c.file === 'main.py' || c.file.startsWith('geo/'))).toBe(true);

    const r = result(evs);
    expect(r).toMatchObject({ ok: true, outcome: 'ok', exitCode: 0 });
    expect(r.calls).toBeGreaterThanOrEqual(5);
    expect(r.report).toContain('| parse_radius | main.py |');
    expect(r.report).toContain('Your name: -> Ana');
    expect(r.report).toContain('- created: out.txt (4 bytes)');
    expect(r.report).toContain('hello Ana');
  }, 30000);

  it('reports an uncaught exception with its place, exit code 1 and a clean traceback', async () => {
    const dir = project({ 'main.py': MAIN, 'geo/__init__.py': '', 'geo/shapes.py': SHAPES });
    const evs = await runWithAnswers(dir, 'python main.py', ['Bo', '500']);
    const exc = kinds(evs, 'exception')[0];
    expect(exc).toMatchObject({ type: 'ValueError', message: 'radius too big: 500.0', fn: 'main', file: 'main.py', line: 19 });
    const err = kinds(evs, 'stderr').map((e) => e.text).join('\n');
    expect(err).toContain('Traceback (most recent call last):');
    expect(err).toContain('ValueError: radius too big: 500.0');
    // The harness and runpy stay out of the traceback.
    expect(err).not.toContain('runroom_harness');
    expect(err).not.toContain('runpy');
    expect(result(evs)).toMatchObject({ ok: false, outcome: 'error', exitCode: 1 });
    expect(result(evs).report).toContain('## Uncaught exception');
  }, 30000);

  it('handles end of input, sys.exit codes, -m modules and -c code', async () => {
    const dir = project({
      'main.py': MAIN,
      'geo/__init__.py': '',
      'geo/shapes.py': SHAPES,
      'tool/__init__.py': '',
      'tool/__main__.py': 'import sys\nprint("args", sys.argv[1:])\nsys.exit(3)\n',
    });
    const eof = await runWithAnswers(dir, 'python main.py', [null]);
    expect(kinds(eof, 'exception')[0]).toMatchObject({ type: 'EOFError' });
    expect(result(eof).report).toContain('(end of input)');

    const mod = await runWithAnswers(dir, 'python -m tool a b', []);
    expect(kinds(mod, 'stdout').map((e) => e.text)).toContain("args ['a', 'b']");
    expect(result(mod)).toMatchObject({ exitCode: 3, outcome: 'error' });

    const code = await runWithAnswers(dir, 'python -c "import getpass; p = getpass.getpass(); print(len(p))"', ['secret!']);
    expect(kinds(code, 'input_request')[0]).toMatchObject({ secret: true });
    expect(kinds(code, 'stdout').map((e) => e.text)).toContain('7');
    expect(result(code).report).toContain('(hidden)');
    expect(result(code).report).not.toContain('secret!');
  }, 30000);

  it('STOP kills the program (and what it started); the time limit too', async () => {
    const dir = project({ 'loop.py': 'import time\nprint("start", flush=True)\nwhile True:\n    time.sleep(0.05)\n' });
    const abort = new AbortController();
    const evs = await collect(runner.run(task(dir, 'python loop.py'), { signal: abort.signal, input: new InputBridge() }), (ev) => {
      if (ev.kind === 'stdout' && ev.text === 'start') setTimeout(() => abort.abort(), 50);
    });
    expect(result(evs)).toMatchObject({ outcome: 'stopped', ok: false });

    const quick = new PythonRunner({ runTimeoutMs: 1200 });
    const t0 = Date.now();
    const timed = await collect(quick.run(task(dir, 'python loop.py'), { signal: new AbortController().signal, input: new InputBridge() }));
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(result(timed)).toMatchObject({ outcome: 'error' });
    expect(result(timed).report).toContain('time limit');
  }, 30000);

  it('refuses to start a script that is not in the project', async () => {
    const dir = project({ 'main.py': 'print(1)\n' });
    const evs = await collect(runner.run(task(dir, 'python other.py'), { signal: new AbortController().signal, input: new InputBridge() }));
    expect(kinds(evs, 'error')[0].text).toMatch(/cannot find other.py/);
    expect(result(evs)).toMatchObject({ ok: false, outcome: 'error' });
  });

  it('setup: makes a virtual environment once, runs the commands in it, stops at the first failure', async () => {
    const dir = project({ 'main.py': 'import sys\nprint("prefix", sys.prefix)\n' });
    const ok = await collect(
      runner.setup(task(dir, 'python main.py', ['python -c "print(\'setup step 1\')"', 'pip --version']), { signal: new AbortController().signal, input: new InputBridge() }),
    );
    expect(kinds(ok, 'setup_step').map((e) => e.index)).toEqual([0, 1]);
    expect(kinds(ok, 'stdout').map((e) => e.text)).toContain('setup step 1');
    expect(kinds(ok, 'setup_done')[0]).toMatchObject({ ok: true });
    const venv = join(dir, '..', 'venv');
    expect(venvReady(venv)).toBe(true);
    // The program now runs with the project's own interpreter.
    const run = await collect(runner.run(task(dir, 'python main.py'), { signal: new AbortController().signal, input: new InputBridge() }));
    expect(kinds(run, 'stdout').map((e) => e.text).join(' ')).toContain('venv');
    expect(result(run).report).toContain('in the project virtual environment');

    const bad = await collect(
      runner.setup(task(dir, 'python main.py', ['python -c "import sys; sys.exit(3)"', 'python -c "print(\'never\')"']), {
        signal: new AbortController().signal,
        input: new InputBridge(),
      }),
    );
    expect(kinds(bad, 'setup_done')[0]).toMatchObject({ ok: false, exitCode: 3, failed: expect.stringContaining('sys.exit(3)') });
    expect(kinds(bad, 'stdout').map((e) => e.text)).not.toContain('never');
    expect(existsSync(venv)).toBe(true);
  }, 120000);
});
