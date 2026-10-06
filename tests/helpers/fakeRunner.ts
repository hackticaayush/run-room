// A scripted TaskRunner for tests: setup steps, function calls and returns, output lines, input
// requests answered through the InputBridge, crashes and STOP. No Python needed.

import type { RunnerContext, RunnerEvent, RunnerTask, TaskRunner } from '../../server/runners/TaskRunner';

export interface FakeRunnerOptions {
  /** Traced work(i) calls, each with a return. */
  calls?: number;
  /** Output lines. */
  lines?: number;
  /** Times the program asks for input (answers are echoed to stdout). */
  inputs?: number;
  /** Real ms to wait before each output line (lets tests stop a run mid-way). */
  delayMs?: number;
  /** End with an uncaught exception (exit code 1). */
  crash?: boolean;
  /** The setup fails. */
  setupFails?: boolean;
}

export type FakeRunner = TaskRunner & { aborted: boolean; answers: (string | null)[]; setups: number; runs: number; lastTask: RunnerTask | null };

export function fakeRunner(opts: FakeRunnerOptions = {}): FakeRunner {
  const pause = () => new Promise((res) => setTimeout(res, opts.delayMs ?? 0));
  const r: FakeRunner = {
    name: 'fake',
    aborted: false,
    answers: [],
    setups: 0,
    runs: 0,
    lastTask: null,
    async *setup(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent> {
      r.setups++;
      for (let i = 0; i < task.setup.length; i++) {
        yield { kind: 'setup_step', index: i, command: task.setup[i].text };
        yield { kind: 'stdout', text: `Collecting fakepkg${i}` };
        await pause();
        if (ctx.signal.aborted) {
          r.aborted = true;
          return;
        }
      }
      if (opts.setupFails) {
        yield { kind: 'stderr', text: 'ERROR: No matching distribution found for fakepkg0' };
        yield { kind: 'setup_done', ok: false, failed: task.setup[0]?.text ?? 'setup', exitCode: 1 };
        return;
      }
      yield { kind: 'stdout', text: 'Successfully installed fakepkg0' };
      yield { kind: 'setup_done', ok: true, failed: null, exitCode: 0 };
    },
    async *run(task: RunnerTask, ctx: RunnerContext): AsyncIterable<RunnerEvent> {
      r.runs++;
      r.lastTask = task;
      const started = performance.now();
      const aborted = new Promise<'aborted'>((res) => {
        if (ctx.signal.aborted) res('aborted');
        ctx.signal.addEventListener('abort', () => res('aborted'), { once: true });
      });
      const result = (outcome: 'ok' | 'error' | 'stopped', exitCode: number | null): RunnerEvent => ({
        kind: 'result',
        summary: `fake ${outcome}`,
        report: `# Fake report\n\noutcome ${outcome}\n`,
        ok: outcome === 'ok',
        outcome,
        exitCode,
        calls: (opts.calls ?? 3) + 1,
        outputLines: opts.lines ?? 2,
        runtimeMs: Math.round(performance.now() - started),
      });
      yield { kind: 'hello', python: 'Python 3.99.0', traceMode: 'fake', pid: 4242 };
      yield { kind: 'call', fn: 'main', file: 'main.py', line: 1, args: '', depth: 1 };
      yield { kind: 'stack', frames: [{ fn: '<module>', file: 'main.py', line: 30 }, { fn: 'main', file: 'main.py', line: 3 }] };
      for (let i = 0; i < (opts.calls ?? 3); i++) {
        yield { kind: 'call', fn: 'work', file: 'main.py', line: 10, args: `i=${i}`, depth: 2 };
        yield { kind: 'return', fn: 'work', type: 'int', value: String(i * 2), declared: 'int', depth: 2, yielded: false };
      }
      for (let i = 0; i < (opts.lines ?? 2); i++) {
        await pause();
        if (ctx.signal.aborted) {
          r.aborted = true;
          yield result('stopped', null);
          return;
        }
        yield { kind: 'stdout', text: `line ${i}` };
      }
      for (let i = 0; i < (opts.inputs ?? 0); i++) {
        let answer!: (v: string | null) => void;
        const got = new Promise<string | null>((res) => (answer = res));
        ctx.input.attach((v) => answer(v));
        yield { kind: 'stdout', text: `Question ${i + 1}: ` };
        yield { kind: 'input_request', requestId: i + 1, prompt: `Question ${i + 1}: `, secret: false, fn: 'main' };
        const v = await Promise.race([got, aborted]);
        ctx.input.detach();
        if (v === 'aborted') {
          r.aborted = true;
          yield result('stopped', null);
          return;
        }
        r.answers.push(v);
        yield { kind: 'input_done', requestId: i + 1 };
        yield { kind: 'stdout', text: `you said ${v}` };
      }
      yield { kind: 'stats', calls: (opts.calls ?? 3) + 1, returns: opts.calls ?? 3, yields: 0, top: [{ fn: 'work', file: 'main.py', calls: opts.calls ?? 3, types: ['int'], value: '4', declared: 'int' }] };
      if (opts.crash) {
        yield { kind: 'exception', type: 'ValueError', message: 'boom', fn: 'work', file: 'main.py', line: 11 };
        yield { kind: 'stderr', text: 'Traceback (most recent call last):' };
        yield { kind: 'stderr', text: 'ValueError: boom' };
        yield { kind: 'exit', code: 1 };
        yield result('error', 1);
        return;
      }
      yield { kind: 'return', fn: 'main', type: 'None', value: 'None', declared: null, depth: 1, yielded: false };
      yield { kind: 'exit', code: 0 };
      yield result('ok', 0);
    },
  };
  return r;
}
