// Multi-client sync: one authoritative simulation, many WebSocket viewers in lockstep.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../shared/events';
import { sampleMove } from '../shared/motion';
import type { MoveState } from '../shared/types';
import { startRunRoomServer, type RunRoomServer } from '../server/app';
import { findPython } from '../server/runners/python/process';
import { fakeRunner, type FakeRunner } from './helpers/fakeRunner';
import { TestClient } from './helpers/wsClient';

type MoveEvent = Extract<ServerEvent, { type: 'AGENT_MOVE' }>;

/** Position of an agent at sim time t, replayed from the AGENT_MOVE events a client received. */
function replay(moves: MoveEvent[], agentId: string, t: number): { x: number; y: number } | null {
  const mine = moves.filter((m) => m.payload.agentId === agentId && m.payload.startClock <= t);
  const last = mine.at(-1);
  if (!last) return null;
  const s = sampleMove(last.payload as MoveState, t);
  return { x: s.x, y: s.y };
}

async function uploadFile(port: number, name: string, content: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([content]), name);
  const res = await fetch(`http://127.0.0.1:${port}/api/upload/file`, { method: 'POST', body: form });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!body.id) throw new Error(body.error ?? 'upload failed');
  return body.id;
}

async function uploadFolder(port: number, files: [string, string][]): Promise<string> {
  const form = new FormData();
  form.append('manifest', JSON.stringify(files.map(([p]) => p)));
  for (const [p, c] of files) form.append('files', new Blob([c]), p.split('/').pop());
  const res = await fetch(`http://127.0.0.1:${port}/api/upload/folder`, { method: 'POST', body: form });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!body.id) throw new Error(body.error ?? 'upload failed');
  return body.id;
}

function tempDirs() {
  const dir = mkdtempSync(join(tmpdir(), 'runroom-mc-'));
  return { uploadsDir: join(dir, 'uploads'), projectsDir: join(dir, 'projects') };
}

describe('multi-client sync', () => {
  let server: RunRoomServer;
  let runner: FakeRunner;

  beforeAll(async () => {
    runner = fakeRunner({ lines: 3, inputs: 0 });
    server = await startRunRoomServer({ port: 0, ...tempDirs(), runner, sim: { idle: false, timeScale: 10, seed: 3 }, log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  it('a run submitted by viewer A is seen identically and in lockstep by viewer B', async () => {
    const uploadId = await uploadFile(server.port, 'main.py', 'print("hi")\n');
    const a = await TestClient.connect(server.port);
    const b = await TestClient.connect(server.port);
    expect((await a.waitForType('HELLO')).payload.config).toMatchObject({ runEnabled: true, canRun: true });
    await a.waitForType('STATE_SNAPSHOT');
    await b.waitForType('STATE_SNAPSHOT');
    const startA = a.events.length;
    const startB = b.events.length;

    a.send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'upload', uploadId }, run: 'python main.py', priority: 'NORMAL' } });
    const resA = await a.waitForType('RESULT', 30000);
    const resB = await b.waitForType('RESULT', 30000);
    expect(resB.payload).toEqual(resA.payload);
    expect(resA.payload).toMatchObject({ ok: true, codeName: 'main.py' });

    // Both viewers received the very same broadcast stream (ignoring per-client frames).
    const shared = (events: ServerEvent[], from: number) =>
      events.slice(from).filter((e) => ['AGENT_MOVE', 'AGENT_STATE', 'TASK_UPDATE', 'DIALOGUE', 'FX', 'RESULT', 'AMBIENT', 'RUN_STATE'].includes(e.type));
    const streamA = shared(a.events, startA);
    const streamB = shared(b.events, startB);
    expect(streamA.length).toBeGreaterThan(20);
    expect(streamB).toEqual(streamA);

    // Replaying the moves gives identical positions for both agents at any sim time.
    const movesA = a.ofType('AGENT_MOVE');
    const movesB = b.ofType('AGENT_MOVE');
    expect(movesA.length).toBeGreaterThanOrEqual(4);
    const tEnd = movesA.at(-1)!.payload.startClock;
    for (let t = 0; t <= tEnd; t += tEnd / 40) {
      for (const id of ['ghost', 'byte']) expect(replay(movesB, id, t)).toEqual(replay(movesA, id, t));
    }
    await a.close();
    await b.close();
  }, 45000);

  it('a viewer joining mid-run receives a snapshot with the live task and the run monitor', async () => {
    const uploadId = await uploadFile(server.port, 'main.py', 'print("hi")\n');
    const a = await TestClient.connect(server.port);
    await a.waitForType('STATE_SNAPSHOT');
    a.send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'upload', uploadId }, run: 'python main.py', priority: 'HIGH' } });
    const update = (await a.waitFor((e) => e.type === 'TASK_UPDATE' && e.payload.status === 'active' && e.payload.stepIndex >= 2, 30000, false)) as Extract<
      ServerEvent,
      { type: 'TASK_UPDATE' }
    >;
    const c = await TestClient.connect(server.port);
    const snap = await c.waitForType('STATE_SNAPSHOT');
    const live = snap.payload.taskQueue.find((t) => t.id === update.payload.taskId);
    expect(live?.status).toBe('active');
    expect(live!.stepIndex).toBeGreaterThanOrEqual(update.payload.stepIndex);
    expect(snap.payload.run?.taskId).toBe(update.payload.taskId);
    expect(snap.payload.agents.map((x) => x.agentId).sort()).toEqual(['byte', 'ghost']);
    const res = await c.waitFor((e) => e.type === 'RESULT' && e.payload.taskId === update.payload.taskId, 30000);
    expect(res.type).toBe('RESULT');
    await a.close();
    await c.close();
  }, 45000);

  it('pause and speed changes from one viewer reach every viewer', async () => {
    const a = await TestClient.connect(server.port);
    const b = await TestClient.connect(server.port);
    await b.waitForType('STATE_SNAPSHOT');
    a.send({ type: 'PAUSE', payload: {} });
    const pb = await b.waitFor((e) => e.type === 'CLOCK' && e.payload.paused, 5000, false);
    expect(pb.type).toBe('CLOCK');
    b.send({ type: 'RESUME', payload: {} });
    await a.waitFor((e) => e.type === 'CLOCK' && !e.payload.paused, 5000, false);
    await a.close();
    await b.close();
  });
});

describe('input prompts over the wire', () => {
  let server: RunRoomServer;
  let runner: FakeRunner;

  beforeAll(async () => {
    runner = fakeRunner({ lines: 1, inputs: 1 });
    server = await startRunRoomServer({ port: 0, ...tempDirs(), runner, sim: { idle: false, timeScale: 10, seed: 4 }, log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  it('every viewer sees the prompt; the first answer goes to the program, later ones are refused', async () => {
    const uploadId = await uploadFile(server.port, 'ask.py', 'input("Question 1: ")\n');
    const a = await TestClient.connect(server.port);
    const b = await TestClient.connect(server.port);
    await a.waitForType('STATE_SNAPSHOT');
    await b.waitForType('STATE_SNAPSHOT');
    a.send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'upload', uploadId }, run: 'python ask.py', priority: 'NORMAL' } });
    const reqA = await a.waitForType('INPUT_REQUEST', 30000);
    const reqB = await b.waitForType('INPUT_REQUEST', 30000);
    expect(reqB.payload).toEqual(reqA.payload);
    expect(reqA.payload.prompt).toBe('Question 1:');

    // A late joiner sees the open question in its snapshot.
    const c = await TestClient.connect(server.port);
    const snap = await c.waitForType('STATE_SNAPSHOT');
    expect(snap.payload.run?.waitingInput?.requestId).toBe(reqA.payload.requestId);

    b.send({ type: 'PROVIDE_INPUT', payload: { taskId: reqA.payload.taskId, requestId: reqA.payload.requestId, value: 'from B' } });
    const doneA = await a.waitForType('INPUT_DONE', 10000);
    expect(doneA.payload).toMatchObject({ shown: 'from B', cancelled: false });
    a.send({ type: 'PROVIDE_INPUT', payload: { taskId: reqA.payload.taskId, requestId: reqA.payload.requestId, value: 'from A' } });
    const notice = await a.waitForType('NOTICE', 10000);
    expect(notice.payload.text).toMatch(/already answered/);
    expect(b.ofType('NOTICE')).toHaveLength(0);
    await a.waitForType('RESULT', 30000);
    expect(runner.answers).toEqual(['from B']);
    await a.close();
    await b.close();
    await c.close();
  }, 45000);
});

describe('end to end with real Python', async () => {
  const python = await findPython();
  let server: RunRoomServer;

  beforeAll(async () => {
    server = await startRunRoomServer({ port: 0, ...tempDirs(), sim: { idle: false, timeScale: 10, seed: 5 }, log: () => {} });
  });

  afterAll(async () => {
    await server?.close();
  });

  it.skipIf(!python)('folder upload, setup, SAVE AS, input, then a one click rerun of the saved project', async () => {
    const uploadId = await uploadFolder(server.port, [
      ['calc/main.py', 'from ops import add\n\n\ndef main() -> None:\n    a = int(input("A: "))\n    print("sum", add(a, 2))\n\n\nmain()\n'],
      ['calc/ops.py', 'def add(x: int, y: int) -> int:\n    return x + y\n'],
      ['calc/requirements.txt', ''],
    ]);
    const a = await TestClient.connect(server.port);
    await a.waitForType('STATE_SNAPSHOT');
    a.send({
      type: 'SUBMIT_TASK',
      payload: { source: { kind: 'upload', uploadId }, setup: ['pip install -r requirements.txt'], run: 'python main.py', priority: 'NORMAL', saveAs: 'calc e2e' },
    });
    const projects = await a.waitFor((e) => e.type === 'PROJECTS' && e.payload.projects.some((p) => p.name === 'calc e2e'), 10000);
    const projectId = (projects as Extract<ServerEvent, { type: 'PROJECTS' }>).payload.projects[0].id;
    const req = await a.waitForType('INPUT_REQUEST', 90000);
    expect(req.payload).toMatchObject({ prompt: 'A:', fn: 'main' });
    a.send({ type: 'PROVIDE_INPUT', payload: { taskId: req.payload.taskId, requestId: req.payload.requestId, value: '40' } });
    const res = await a.waitForType('RESULT', 60000);
    expect(res.payload).toMatchObject({ ok: true, outcome: 'ok', exitCode: 0, projectName: 'calc e2e' });
    expect(res.payload.report).toContain('sum 42');
    expect(res.payload.report).toContain('| add | ops.py | 1 | int | int | 42 |');
    const trace = a.ofType('LOG').filter((e) => e.payload.channel === 'trace').map((e) => e.payload.text.trim());
    expect(trace).toContain('RET  add -> int 42 (declared int)');
    await a.waitFor((e) => e.type === 'PROJECTS' && e.payload.projects.some((p) => p.id === projectId && p.setupDone && p.lastRun?.ok === true), 30000);

    // One click: the saved project with its saved commands, setup already done.
    a.send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'project', projectId }, priority: 'NORMAL' } });
    const queued = await a.waitFor((e) => e.type === 'TASK_UPDATE' && e.payload.taskId !== res.payload.taskId && e.payload.task.projectId === projectId, 10000);
    expect((queued as Extract<ServerEvent, { type: 'TASK_UPDATE' }>).payload.task.setupCached).toBe(true);
    const req2 = await a.waitFor((e) => e.type === 'INPUT_REQUEST' && e.payload.taskId !== res.payload.taskId, 60000);
    a.send({ type: 'PROVIDE_INPUT', payload: { taskId: (req2 as Extract<ServerEvent, { type: 'INPUT_REQUEST' }>).payload.taskId, requestId: 1, value: '1' } });
    const res2 = await a.waitFor((e) => e.type === 'RESULT' && e.payload.taskId !== res.payload.taskId, 60000);
    expect((res2 as Extract<ServerEvent, { type: 'RESULT' }>).payload.report).toContain('sum 3');
    await a.close();
  }, 180000);
});
