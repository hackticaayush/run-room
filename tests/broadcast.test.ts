import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRunRoomServer, type RunRoomServer } from '../server/app';
import { TestClient } from './helpers/wsClient';

describe('websocket broadcast (milestone 1)', () => {
  let server: RunRoomServer;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-bc-'));
    server = await startRunRoomServer({ port: 0, uploadsDir: join(dir, 'u'), projectsDir: join(dir, 'p'), log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  it('greets each client and broadcasts the same clock frames to everyone', async () => {
    const a = await TestClient.connect(server.port);
    const b = await TestClient.connect(server.port);

    const helloA = await a.waitForType('HELLO');
    const helloB = await b.waitForType('HELLO');
    expect(helloA.payload.clientId).not.toEqual(helloB.payload.clientId);
    await a.waitForType('STATE_SNAPSHOT');
    await b.waitForType('STATE_SNAPSHOT');

    // Both see the viewer count reach 2.
    await a.waitFor((e) => e.type === 'CLIENTS' && e.payload.count === 2);
    await b.waitFor((e) => e.type === 'CLIENTS' && e.payload.count === 2);

    // A speed change from A is broadcast to B as the identical CLOCK frame.
    a.send({ type: 'SET_SPEED', payload: { multiplier: 2 } });
    const clockA = await a.waitFor((e) => e.type === 'CLOCK' && e.payload.speed === 2, 5000, false);
    const clockB = await b.waitFor((e) => e.type === 'CLOCK' && e.payload.speed === 2, 5000, false);
    expect(clockB).toEqual(clockA);

    // A malformed command is rejected only to its sender.
    a.send({ type: 'SET_SPEED', payload: { multiplier: 3 } });
    const notice = await a.waitForType('NOTICE', 5000, false);
    expect(notice.payload.text).toMatch(/speed/);

    await a.close();
    await b.close();
  });
});
