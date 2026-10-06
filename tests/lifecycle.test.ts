import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../shared/events';
import { TASK_STEPS } from '../shared/types';
import { Simulation } from '../server/sim/Simulation';
import type { TaskInput } from '../server/sim/sources';
import { UploadStore } from '../server/upload';
import { ProjectStore } from '../server/projects';
import { fakeRunner, type FakeRunnerOptions } from './helpers/fakeRunner';

const tick = () => new Promise((r) => setImmediate(r));
type Ev<K extends ServerEvent['type']> = Extract<ServerEvent, { type: K }>;

function setup(opts: FakeRunnerOptions = {}) {
  const runner = fakeRunner(opts);
  const dir = mkdtempSync(join(tmpdir(), 'runroom-life-'));
  const uploads = new UploadStore(join(dir, 'uploads'));
  const projects = new ProjectStore(join(dir, 'projects'));
  const sim = new Simulation({ idle: false, seed: 7, runner, uploads, projects });
  const events: ServerEvent[] = [];
  const direct = new Map<string, ServerEvent[]>();
  sim.onFlush((b, d) => {
    events.push(...b);
    for (const [k, v] of d) direct.set(k, [...(direct.get(k) ?? []), ...v]);
  });
  const up = uploads.saveFile('main.py', Buffer.from('print("hi")\n'));
  if ('error' in up) throw new Error(up.error);
  const submit = (extra: Partial<TaskInput> = {}) =>
    sim.submitTask({ source: { kind: 'upload', uploadId: up.id }, run: 'python main.py', priority: 'NORMAL', ...extra });
  return { sim, events, direct, runner, uploads, projects, up, submit };
}

/** Steps the sim (100 ms per step) while letting async runners progress, until done() or a limit. */
async function runUntil(sim: Simulation, done: () => boolean, maxSimMs = 240000) {
  for (let t = 0; t < maxSimMs; t += 100) {
    sim.step(100);
    // Mostly microtask yields; every 2 s of sim time also let a little real time pass so
    // runners that await real timers can progress.
    if (t % 2000 === 0) await new Promise((r) => setTimeout(r, 1));
    else await tick();
    if (done()) return;
  }
  throw new Error('simulation did not reach the expected state in time');
}

const idle = (sim: Simulation) => () => sim.director.active === null && sim.tasks.every((t) => t.info.status !== 'queued');

const stepsSeen = (events: ServerEvent[], taskId: string) => {
  const seq: number[] = [];
  for (const e of events) {
    if (e.type !== 'TASK_UPDATE' || e.payload.taskId !== taskId) continue;
    if (seq[seq.length - 1] !== e.payload.stepIndex) seq.push(e.payload.stepIndex);
  }
  return seq;
};

const ofType = <K extends ServerEvent['type']>(events: ServerEvent[], type: K) => events.filter((e) => e.type === type) as Ev<K>[];
const indexOf = (events: ServerEvent[], pred: (e: ServerEvent) => boolean) => events.findIndex(pred);

describe('run lifecycle', () => {
  it('walks a run through every phase in order and publishes one result', async () => {
    const { sim, events, runner, submit } = setup();
    const r = submit() as { taskId: string };
    expect(r.taskId).toBe('T001');
    await runUntil(sim, idle(sim));
    expect(stepsSeen(events, 'T001')).toEqual(TASK_STEPS.map((_, i) => i));
    const results = ofType(events, 'RESULT');
    expect(results).toHaveLength(1);
    expect(results[0].payload).toMatchObject({ ok: true, outcome: 'ok', exitCode: 0, command: 'python main.py', codeName: 'main.py' });
    expect(results[0].payload.report).toContain('# Fake report');
    expect(runner.runs).toBe(1);
    expect(runner.setups).toBe(0);
    const final = sim.tasks[0].info;
    expect(final).toMatchObject({ status: 'done', note: 'DONE', exitCode: 0, title: 'RUN main.py' });
    expect(sim.hacker.invalidTransitions + sim.assistant.invalidTransitions).toBe(0);
  }, 30000);

  it('runs the setup at the server racks, only after Byte got there', async () => {
    const { sim, events, runner, submit } = setup();
    submit({ setup: ['pip install fakepkg'] });
    await runUntil(sim, idle(sim));
    expect(runner.setups).toBe(1);
    expect(runner.runs).toBe(1);
    const byteAtRacks = indexOf(events, (e) => e.type === 'AGENT_STATE' && e.payload.agentId === 'byte' && e.payload.station === 'SERVER_CHECK' && !e.payload.move);
    const firstSetupLine = indexOf(events, (e) => e.type === 'LOG' && e.payload.channel === 'setup' && e.payload.text.startsWith('$ '));
    expect(byteAtRacks).toBeGreaterThan(0);
    expect(firstSetupLine).toBeGreaterThan(byteAtRacks);
    // Byte comments on pip's output.
    expect(ofType(events, 'DIALOGUE').some((d) => d.payload.from === 'byte' && /Fetching fakepkg0/.test(d.payload.text))).toBe(true);
  }, 30000);

  it('does not start the program when the setup fails', async () => {
    const { sim, events, runner, submit } = setup({ setupFails: true });
    submit({ setup: ['pip install nothing-like-this'] });
    await runUntil(sim, idle(sim));
    expect(runner.runs).toBe(0);
    const result = ofType(events, 'RESULT')[0].payload;
    expect(result).toMatchObject({ ok: false, outcome: 'setup_failed' });
    expect(result.report).toContain('pip install nothing-like-this');
    expect(result.report).toContain('No matching distribution');
    expect(sim.tasks[0].info.status).toBe('failed');
    expect(sim.world.deskScreen).toBe('off');
  }, 30000);

  it('turns calls and returns into trace lines, bubbles and the run monitor', async () => {
    const { sim, events, submit } = setup({ calls: 4, lines: 3, delayMs: 5 });
    submit();
    await runUntil(sim, idle(sim));
    const trace = ofType(events, 'LOG').filter((e) => e.payload.channel === 'trace').map((e) => e.payload.text.trim());
    expect(trace).toContain('CALL work(i=0)  main.py:10');
    expect(trace).toContain('RET  work -> int 0 (declared int)');
    const out = ofType(events, 'LOG').filter((e) => e.payload.channel === 'stdout').map((e) => e.payload.text);
    expect(out).toEqual(expect.arrayContaining(['line 0', 'line 1', 'line 2']));
    const states = ofType(events, 'RUN_STATE').map((e) => e.payload);
    expect(states.some((s) => s.lastReturns.some((r) => r.fn === 'work' && r.type === 'int' && r.declared === 'int'))).toBe(true);
    expect(states.some((s) => s.phase === 'run')).toBe(true);
    expect(states.some((s) => s.stack.map((f) => f.fn).join('>') === '<module>>main')).toBe(true);
    const last = states.at(-1)!;
    expect(last).toMatchObject({ phase: 'done', outcome: 'ok', exitCode: 0, python: 'Python 3.99.0' });
    expect(last.top[0]).toMatchObject({ fn: 'work', types: ['int'] });
    // Ghost thinks about the function that runs and says what it returned.
    const ghostBubbles = ofType(events, 'DIALOGUE').filter((d) => d.payload.from === 'ghost');
    expect(ghostBubbles.some((d) => d.payload.kind === 'thought' && /work\(|main\(/.test(d.payload.text))).toBe(true);
    expect(ghostBubbles.some((d) => d.payload.kind === 'speech' && /-> (int|None)/.test(d.payload.text))).toBe(true);
  }, 30000);

  it('asks every viewer for input and passes the first answer to the program', async () => {
    const { sim, events, direct, runner, submit } = setup({ inputs: 2, lines: 1 });
    sim.setClientPermissions('viewerA', true);
    sim.setClientPermissions('viewerB', true);
    const r = submit() as { taskId: string };
    await runUntil(sim, () => events.some((e) => e.type === 'INPUT_REQUEST'));
    const req = ofType(events, 'INPUT_REQUEST')[0].payload;
    expect(req).toMatchObject({ taskId: r.taskId, requestId: 1, prompt: 'Question 1:', secret: false, fn: 'main' });
    expect(sim.hacker.activity).toBe('WAITING INPUT');
    expect(sim.tasks[0].info.note).toBe('WAITING FOR INPUT');
    // While it waits, the phase never times out.
    for (let i = 0; i < 1200; i++) sim.step(100);
    expect(sim.director.pendingInput?.requestId).toBe(1);

    sim.enqueueCommand('viewerA', { type: 'PROVIDE_INPUT', payload: { taskId: r.taskId, requestId: 1, value: '42' } });
    sim.enqueueCommand('viewerB', { type: 'PROVIDE_INPUT', payload: { taskId: r.taskId, requestId: 1, value: 'too late' } });
    sim.step(16);
    await tick();
    expect((direct.get('viewerB') ?? []).some((e) => e.type === 'NOTICE' && /already answered/.test(e.payload.text))).toBe(true);
    await runUntil(sim, () => ofType(events, 'INPUT_REQUEST').length >= 2);
    sim.enqueueCommand('viewerB', { type: 'PROVIDE_INPUT', payload: { taskId: r.taskId, requestId: 2, value: 'abc' } });
    await runUntil(sim, idle(sim));

    expect(runner.answers).toEqual(['42', 'abc']);
    expect(ofType(events, 'INPUT_DONE').map((e) => [e.payload.by, e.payload.shown, e.payload.cancelled])).toEqual([
      ['viewerA', '42', false],
      ['viewerB', 'abc', false],
    ]);
    expect(events.some((e) => e.type === 'LOG' && e.payload.channel === 'input' && e.payload.text === '> 42')).toBe(true);
    expect(ofType(events, 'RESULT')[0].payload.ok).toBe(true);
  }, 30000);

  it('keeps program output and input prompts flowing while the office is paused', async () => {
    const { sim, events, runner, submit } = setup({ inputs: 1, lines: 0 });
    sim.setClientPermissions('v', true);
    const r = submit() as { taskId: string };
    await runUntil(sim, () => runner.runs === 1);
    sim.enqueueCommand('v', { type: 'PAUSE', payload: {} });
    sim.step(16);
    const clockAtPause = sim.worldClock;
    for (let i = 0; i < 20 && !events.some((e) => e.type === 'INPUT_REQUEST'); i++) {
      sim.step(100);
      await new Promise((res) => setTimeout(res, 1));
    }
    expect(events.some((e) => e.type === 'INPUT_REQUEST')).toBe(true);
    sim.enqueueCommand('v', { type: 'PROVIDE_INPUT', payload: { taskId: r.taskId, requestId: 1, value: 'paused answer' } });
    for (let i = 0; i < 20 && runner.answers.length === 0; i++) {
      sim.step(100);
      await new Promise((res) => setTimeout(res, 1));
    }
    expect(runner.answers).toEqual(['paused answer']);
    expect(sim.worldClock).toBe(clockAtPause);
    sim.enqueueCommand('v', { type: 'RESUME', payload: {} });
    await runUntil(sim, idle(sim));
    expect(ofType(events, 'RESULT')[0].payload.ok).toBe(true);
  }, 30000);

  it('STOP during the run kills the program and still delivers a STOPPED report', async () => {
    const { sim, events, runner, submit } = setup({ lines: 400, delayMs: 20 });
    const r = submit() as { taskId: string };
    await runUntil(sim, () => events.some((e) => e.type === 'LOG' && e.payload.channel === 'stdout'));
    expect(sim.cancelTask(r.taskId)).toBe(true);
    expect(sim.tasks[0].info.note).toBe('STOPPING');
    await runUntil(sim, idle(sim));
    expect(runner.aborted).toBe(true);
    const result = ofType(events, 'RESULT')[0].payload;
    expect(result).toMatchObject({ ok: false, outcome: 'stopped' });
    expect(sim.tasks[0].info.status).toBe('cancelled');
    expect(sim.world.deskScreen).toBe('off');
    expect(sim.world.stats.tasksCancelled).toBe(1);
  }, 30000);

  it('cancelling before the program starts runs nothing', async () => {
    const { sim, runner, submit } = setup();
    const r = submit() as { taskId: string };
    sim.step(100);
    await tick();
    expect(sim.cancelTask(r.taskId)).toBe(true);
    for (let i = 0; i < 50; i++) sim.step(100);
    expect(runner.runs).toBe(0);
    expect(sim.tasks[0].info.status).toBe('cancelled');
    expect(sim.hacker.reserved || sim.assistant.reserved).toBe(false);
  });

  it('a crash turns the screen red, sounds the siren and fails the run', async () => {
    const { sim, events, submit } = setup({ crash: true });
    // When (sim ms) the desk screen changed and Ghost's animation changed.
    const screen: [number, string][] = [];
    const ghostAnim: [number, string][] = [];
    sim.onFlush((batch) => {
      for (const e of batch) {
        if (e.type === 'AMBIENT' && screen.at(-1)?.[1] !== e.payload.world.deskScreen) screen.push([sim.now(), e.payload.world.deskScreen]);
        if (e.type === 'AGENT_STATE' && e.payload.agentId === 'ghost' && ghostAnim.at(-1)?.[1] !== e.payload.anim) ghostAnim.push([sim.now(), e.payload.anim]);
      }
    });
    submit();
    await runUntil(sim, idle(sim));
    expect(events.some((e) => e.type === 'AMBIENT' && e.payload.world.deskScreen === 'red')).toBe(true);
    // The crash stays visible: the red screen holds (Ghost facepalming at it) before it goes dark.
    const red = screen.findIndex(([, s]) => s === 'red');
    const redFor = screen[red + 1][0] - screen[red][0];
    expect(screen[red + 1][1]).toBe('off');
    expect(redFor).toBeGreaterThanOrEqual(2000);
    const facepalm = ghostAnim.find(([at, anim]) => anim === 'facepalm' && at >= screen[red][0]);
    expect(facepalm).toBeDefined();
    expect(ghostAnim.find(([at, anim]) => at > facepalm![0] && anim !== 'facepalm')![0] - facepalm![0]).toBeGreaterThanOrEqual(2000);
    expect(ofType(events, 'FX').some((e) => e.payload.type === 'siren')).toBe(true);
    const result = ofType(events, 'RESULT')[0].payload;
    expect(result).toMatchObject({ ok: false, outcome: 'error', exitCode: 1 });
    expect(sim.tasks[0].info.status).toBe('failed');
    expect(ofType(events, 'RUN_STATE').at(-1)!.payload.exception).toMatchObject({ type: 'ValueError', message: 'boom', fn: 'work' });
  }, 30000);

  it('runs HIGH priority before NORMAL and LOW (FIFO within a priority)', async () => {
    const { sim, events, submit } = setup();
    const low = submit({ priority: 'LOW' }) as { taskId: string };
    const n1 = submit({ priority: 'NORMAL' }) as { taskId: string };
    const high = submit({ priority: 'HIGH' }) as { taskId: string };
    const n2 = submit({ priority: 'NORMAL' }) as { taskId: string };
    await runUntil(sim, idle(sim), 900000);
    const order = ofType(events, 'RESULT').map((e) => e.payload.taskId);
    expect(order).toEqual([high.taskId, n1.taskId, n2.taskId, low.taskId]);
  }, 60000);

  it('rejects non-Python commands, shell tricks and missing scripts', () => {
    const { submit } = setup();
    expect(submit({ run: 'node main.js' })).toMatchObject({ error: expect.stringMatching(/only Python/) });
    expect(submit({ run: 'python missing.py' })).toMatchObject({ error: expect.stringMatching(/no missing.py/) });
    expect(submit({ run: 'python main.py && del *' })).toMatchObject({ error: expect.stringMatching(/one command per line/) });
    expect(submit({ setup: ['npm install'] })).toMatchObject({ error: expect.stringMatching(/setup line 1/) });
    expect(submit({ run: 'pip install x' })).toMatchObject({ error: expect.stringMatching(/setup commands/) });
  });

  it('only admins (full access) can submit; guests are turned away', () => {
    const { sim, submit } = setup();
    expect(submit({ clientId: 'stranger' })).toMatchObject({ error: expect.stringMatching(/guest/) });
    sim.setClientPermissions('local', true);
    expect(submit({ clientId: 'local' })).toMatchObject({ taskId: 'T001' });
  });
});

describe('saved projects', () => {
  it('SAVE AS + RUN saves the code; the one click RUN skips a setup that already ran', async () => {
    const { sim, events, runner, projects, submit } = setup();
    const first = submit({ saveAs: 'Demo App', setup: ['pip install fakepkg'] }) as { taskId: string; projectId: string };
    expect(first.projectId).toMatch(/^p_[0-9a-f]{12}$/);
    expect(ofType(events, 'PROJECTS').length).toBe(0);
    sim.step(16);
    expect(ofType(events, 'PROJECTS').at(-1)!.payload.projects.map((p) => p.name)).toEqual(['Demo App']);
    await runUntil(sim, idle(sim));
    expect(runner.setups).toBe(1);
    const saved = projects.get(first.projectId)!;
    expect(saved).toMatchObject({ setupDone: true, setup: ['pip install fakepkg'], run: 'python main.py', lastRun: { ok: true, exitCode: 0 } });
    // The program ran in the saved copy of the code, not in the upload.
    expect(runner.lastTask?.workDir).toBe(saved.filesDir);

    const again = sim.submitTask({ source: { kind: 'project', projectId: first.projectId }, priority: 'NORMAL' }) as { taskId: string };
    expect(sim.tasks.find((t) => t.info.id === again.taskId)!.info).toMatchObject({ setupCached: true, setup: ['pip install fakepkg'], projectName: 'Demo App' });
    await runUntil(sim, idle(sim));
    expect(runner.setups).toBe(1);
    expect(runner.runs).toBe(2);

    sim.submitTask({ source: { kind: 'project', projectId: first.projectId }, priority: 'NORMAL', forceSetup: true });
    await runUntil(sim, idle(sim));
    expect(runner.setups).toBe(2);
  }, 60000);

  it('refuses a duplicate name unless overwrite is set, edits and deletes projects', () => {
    const { sim, up, projects, submit } = setup();
    sim.setClientPermissions('me', true);
    expect(sim.saveProject('me', { uploadId: up.id, name: 'tool', setup: [], run: 'python main.py' })).toMatchObject({ projectId: expect.any(String) });
    expect(sim.saveProject('me', { uploadId: up.id, name: 'TOOL', setup: [], run: 'python main.py' })).toMatchObject({ error: expect.stringMatching(/already exists/) });
    const over = sim.saveProject('me', { uploadId: up.id, name: 'TOOL', setup: [], run: 'python main.py', overwrite: true }) as { projectId: string };
    expect(projects.list()).toHaveLength(1);
    expect(sim.updateProject('me', { projectId: over.projectId, run: 'node x.js' })).toMatchObject({ error: expect.stringMatching(/only Python/) });
    expect(sim.updateProject('me', { projectId: over.projectId, name: 'tool v2', setup: ['pip install a'] })).toEqual({ ok: true });
    expect(projects.get(over.projectId)).toMatchObject({ name: 'tool v2', setup: ['pip install a'], setupDone: false });
    // A queued or running project cannot be deleted.
    submit({ saveAs: 'busy' });
    const busy = projects.findByName('busy')!;
    expect(sim.deleteProject('me', busy.id)).toMatchObject({ error: expect.stringMatching(/stop it first/) });
    expect(sim.deleteProject('me', over.projectId)).toEqual({ ok: true });
    expect(projects.get(over.projectId)).toBeNull();
  });
});

describe('the PC rule', () => {
  const DESK: [number, number] = [26, 4];
  const atDesk = (x: number, y: number) => x === DESK[0] && y === DESK[1];
  const programActivity = (e: ServerEvent) =>
    e.type === 'LOG' && (['stdout', 'stderr', 'trace'].includes(e.payload.channel) || (e.payload.channel === 'runner' && e.payload.text.includes(' started')));

  it('Ghost walks to his PC first, the program only runs while he is seated there, then he leaves for good', async () => {
    const { sim, events, submit } = setup({ lines: 5 });
    const ghost = sim.hacker;
    ghost.plan([{ kind: 'goto', station: 'COFFEE' }]);
    await runUntil(sim, () => ghost.station === 'COFFEE' && !ghost.move);
    events.length = 0;

    const r = submit() as { taskId: string };
    sim.step(100);
    await tick();
    const queued = ofType(events, 'TASK_UPDATE').find((e) => e.payload.taskId === r.taskId);
    expect(queued?.payload.task.note).toBe('IN QUEUE');
    const started = ofType(events, 'TASK_UPDATE').find((e) => e.payload.taskId === r.taskId && e.payload.status === 'active');
    expect(started?.payload.task.note).toBe('GHOST -> PC');

    await runUntil(sim, idle(sim));

    const seatedAt = indexOf(events, (e) => e.type === 'AGENT_STATE' && e.payload.agentId === 'ghost' && !e.payload.move && atDesk(e.payload.x, e.payload.y) && e.payload.anim === 'seated');
    expect(seatedAt).toBeGreaterThan(0);
    for (const e of events.slice(0, seatedAt)) {
      if (e.type === 'TASK_UPDATE' && e.payload.taskId === r.taskId) {
        expect(e.payload.stepIndex).toBe(0);
        expect(e.payload.task.stepProgress[0]).toBeLessThanOrEqual(0.5);
      }
    }

    const work = events.map((e, i) => ({ e, i })).filter(({ e }) => programActivity(e));
    expect(work.length).toBeGreaterThan(3);
    const firstWork = work[0].i;
    const lastWork = work[work.length - 1].i;
    expect(firstWork).toBeGreaterThan(seatedAt);

    const ghostMoves = events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'AGENT_MOVE' && e.payload.agentId === 'ghost') as { e: Ev<'AGENT_MOVE'>; i: number }[];
    for (const { e, i } of ghostMoves) {
      if (i > firstWork && i < lastWork) throw new Error(`Ghost moved while the program ran (path from ${e.payload.path[0].join(',')})`);
    }
    const leaves = ghostMoves.filter(({ e, i }) => i > lastWork && atDesk(Math.round(e.payload.path[0][0]), Math.round(e.payload.path[0][1])));
    expect(leaves.length).toBe(1);
    const returns = ghostMoves.filter(({ e, i }) => {
      const end = e.payload.path[e.payload.path.length - 1];
      return i > lastWork && atDesk(end[0], end[1]);
    });
    expect(returns).toHaveLength(0);
    expect(ghost.station).not.toBe('DESK_GHOST');
    expect(sim.world.deskScreen).toBe('off');
    expect(ghost.invalidTransitions).toBe(0);
  }, 30000);

  it('wakes Ghost from a nap on the couch, then he still walks to the PC before anything runs', async () => {
    const { sim, events, submit } = setup({ lines: 3 });
    const ghost = sim.hacker;
    ghost.plan([
      { kind: 'goto', station: 'COUCH' },
      { kind: 'do', state: 'sleeping', anim: 'sleep', activity: 'NAP', duration: 600000, facing: 'down' },
    ]);
    await runUntil(sim, () => ghost.state === 'sleeping');
    events.length = 0;
    submit({ priority: 'HIGH' });
    await runUntil(sim, idle(sim));
    const ghostState = (pred: (p: Ev<'AGENT_STATE'>['payload']) => boolean) => indexOf(events, (e) => e.type === 'AGENT_STATE' && e.payload.agentId === 'ghost' && pred(e.payload));
    const wake = ghostState((p) => p.activity === 'WAKE UP');
    const seated = ghostState((p) => !p.move && atDesk(p.x, p.y) && p.anim === 'seated');
    const firstWork = indexOf(events, programActivity);
    expect(wake).toBeGreaterThanOrEqual(0);
    expect(seated).toBeGreaterThan(wake);
    expect(firstWork).toBeGreaterThan(seated);
    expect(ghost.invalidTransitions).toBe(0);
    expect(sim.world.deskScreen).toBe('off');
  }, 30000);

  it('waits at the PC for a slow program instead of timing out (e.g. at 4x speed)', async () => {
    // 12 lines with 25 ms of real time each: far more than 90 s of sim time passes meanwhile.
    const { sim, events, submit } = setup({ lines: 12, delayMs: 25 });
    submit();
    await runUntil(sim, idle(sim), 3_000_000);
    const texts = ofType(events, 'LOG').map((e) => e.payload.text);
    expect(texts.some((t) => t.includes('timed out'))).toBe(false);
    expect(texts).toEqual(expect.arrayContaining(['line 0', 'line 11']));
    expect(ofType(events, 'RESULT')[0].payload.report).toContain('# Fake report');
    const lastLine = indexOf(events, (e) => e.type === 'LOG' && e.payload.text === 'line 11');
    const standUp = indexOf(events, (e) => e.type === 'AGENT_STATE' && e.payload.agentId === 'ghost' && e.payload.activity === 'STAND UP');
    expect(standUp).toBeGreaterThan(lastLine);
  }, 60000);

  it('keeps the PC dark and unused while there is no task', () => {
    const sim = new Simulation({ seed: 11, runner: fakeRunner() });
    const ghostAtPc: string[] = [];
    sim.onFlush((events) => {
      for (const e of events) {
        if (e.type !== 'AGENT_STATE' || e.payload.agentId !== 'ghost') continue;
        if (e.payload.station === 'DESK_GHOST' || e.payload.anim === 'typing' || e.payload.anim === 'seated') {
          ghostAtPc.push(`${e.payload.activity}@${e.payload.x},${e.payload.y}`);
        }
      }
    });
    // Twenty minutes of sim time with idle behaviors on and no tasks.
    for (let i = 0; i < 12000; i++) sim.step(100);
    expect(ghostAtPc).toEqual([]);
    expect(sim.world.deskScreen).toBe('off');
  }, 30000);
});
