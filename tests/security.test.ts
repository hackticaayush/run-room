// Watching is open to everyone; full access (running code, uploads, every command) is admin only.
// Admin is unlocked with the RUNROOM_ACCESS_PASSWORD, exchanged once for a session token. With no
// password the server is in open mode (everyone is admin). While the server listens only on this
// computer the Host / Origin checks keep a foreign page or a DNS rebinding page away, password or not.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../shared/events';
import { startRunRoomServer, type RunRoomServer } from '../server/app';
import { AdminAuth, hostnameOf, isLoopbackAddress, isLoopbackHost, originAllowed, refuseReason, tokenOf } from '../server/net/security';
import { childEnv } from '../server/runners/python/process';
import { fakeRunner } from './helpers/fakeRunner';

const opts = { bindHost: '127.0.0.1', allowedOrigins: ['http://192.168.1.20:5173'] };
const fakeReq = (o: { headers?: Record<string, string>; url?: string; peer?: string }) =>
  ({ socket: { remoteAddress: o.peer ?? '127.0.0.1' }, url: o.url ?? '/ws', headers: o.headers ?? {} }) as unknown as IncomingMessage;

describe('address and origin checks', () => {
  it('knows loopback addresses and names', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['192.168.1.5', '10.0.0.1', '::ffff:10.0.0.1', '', undefined]) expect(isLoopbackAddress(a)).toBe(false);
    for (const h of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '[::1]']) expect(isLoopbackHost(h)).toBe(true);
    expect(isLoopbackHost('evil.example')).toBe(false);
    expect(hostnameOf('localhost:5173')).toBe('localhost');
    expect(hostnameOf('[::1]:8787')).toBe('::1');
  });

  it('allows same origin, localhost pages and listed origins only', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:5173', opts)).toBe(true);
    expect(originAllowed('http://192.168.1.20:5173', '192.168.1.20:8787', opts)).toBe(true);
    expect(originAllowed('https://evil.example', 'localhost:8787', opts)).toBe(false);
    expect(originAllowed('file://x', 'localhost:8787', opts)).toBe(false);
  });
});

describe('admin password and tokens', () => {
  it('open mode: no password means everyone is admin', () => {
    const auth = new AdminAuth(null);
    expect(auth.required).toBe(false);
    expect(auth.role(fakeReq({}))).toBe('admin');
    expect(auth.login('anything')).toBeNull();
  });

  it('checks the password (constant time, trimmed) and hands out a working token', () => {
    const auth = new AdminAuth('  s3cret  ');
    expect(auth.required).toBe(true);
    expect(auth.login('nope')).toBeNull();
    expect(auth.login('')).toBeNull();
    const token = auth.login('s3cret');
    expect(token).toBeTruthy();
    expect(auth.valid(token)).toBe(true);
    expect(auth.valid('bogus-token')).toBe(false);
    expect(auth.role(fakeReq({ headers: { 'x-runroom-token': token! } }))).toBe('admin');
    expect(auth.role(fakeReq({ url: `/ws?token=${token}` }))).toBe('admin');
    expect(auth.role(fakeReq({}))).toBe('guest');
    expect(tokenOf(fakeReq({ headers: { 'x-runroom-token': token! } }))).toBe(token);
    auth.revoke(token);
    expect(auth.valid(token)).toBe(false);
  });

  it('expired tokens stop working', () => {
    const auth = new AdminAuth('x', -1);
    const token = auth.login('x');
    expect(token).toBeTruthy();
    expect(auth.valid(token)).toBe(false);
  });

  it('blocks foreign hosts and origins unless a password is set AND the server listens on the network', () => {
    const open = new AdminAuth(null);
    const pw = new AdminAuth('p');
    const net = { bindHost: '0.0.0.0', allowedOrigins: [] };
    const local = { bindHost: '127.0.0.1', allowedOrigins: [] };
    expect(refuseReason(fakeReq({ headers: { host: 'evil.example:8787' } }), net, open, false)).toBe('unknown host');
    expect(refuseReason(fakeReq({ headers: { host: '10.0.0.2:8787', origin: 'http://evil.example' } }), net, open, true)).toBe('requests from other web sites are refused');
    expect(refuseReason(fakeReq({ headers: { host: '10.0.0.2:8787', origin: 'http://10.0.0.2:8787' } }), net, open, true)).toBeNull();
    // A password on a server that listens only on this computer: a DNS rebinding page (foreign host
    // name) or another web site could otherwise guess the password and run code. Still refused.
    expect(refuseReason(fakeReq({ headers: { host: 'evil.example:8787' } }), local, pw, false)).toBe('unknown host');
    expect(refuseReason(fakeReq({ headers: { host: 'localhost:5173', origin: 'https://evil.example' } }), local, pw, true)).toBe('requests from other web sites are refused');
    expect(refuseReason(fakeReq({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }), local, pw, true)).toBeNull();
    // A password on a server that listens on the network: public, any host may watch (admin needs the token).
    expect(refuseReason(fakeReq({ headers: { host: 'runroom.example:443' } }), net, pw, true)).toBeNull();
  });
});

describe('program environment', () => {
  it('never hands the admin password to a program (its output is shown to every viewer)', () => {
    const before = process.env.RUNROOM_ACCESS_PASSWORD;
    process.env.RUNROOM_ACCESS_PASSWORD = 'top-secret';
    try {
      const env = childEnv(null);
      expect(Object.keys(env).some((k) => k.toUpperCase() === 'RUNROOM_ACCESS_PASSWORD')).toBe(false);
      expect(Object.values(env)).not.toContain('top-secret');
      expect(env.PYTHONUNBUFFERED).toBe('1');
    } finally {
      if (before === undefined) delete process.env.RUNROOM_ACCESS_PASSWORD;
      else process.env.RUNROOM_ACCESS_PASSWORD = before;
    }
  });
});

describe('open mode server (no password)', () => {
  let server: RunRoomServer;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-open-'));
    server = await startRunRoomServer({ port: 0, uploadsDir: join(dir, 'u'), projectsDir: join(dir, 'p'), runner: fakeRunner(), sim: { idle: false }, log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  const connect = (headers: Record<string, string>) =>
    new Promise<{ ok: boolean; status?: number; events: ServerEvent[]; ws: WebSocket }>((resolve) => {
      const events: ServerEvent[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers });
      ws.on('message', (d) => events.push(...(JSON.parse(d.toString()) as ServerEvent[])));
      ws.once('open', () => setTimeout(() => resolve({ ok: true, events, ws }), 150));
      ws.once('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode, events, ws }));
      ws.once('error', () => resolve({ ok: false, events, ws }));
    });

  it('refuses WebSockets from other web sites and DNS rebinding hosts', async () => {
    expect((await connect({ Origin: 'https://evil.example' })).status).toBe(403);
    expect((await connect({ Host: `evil.example:${server.port}` })).status).toBe(403);
    const fine = await connect({ Origin: 'http://localhost:5173' });
    expect(fine.ok).toBe(true);
    fine.ws.close();
  });

  it('refuses API calls for a foreign Host header', async () => {
    const http = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.end();
    });
    expect(status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/health`)).status).toBe(200);
  });

  it('every viewer is admin and may run', async () => {
    const c = await connect({});
    const hello = c.events.find((e) => e.type === 'HELLO');
    expect(hello?.type === 'HELLO' && hello.payload.config).toMatchObject({ role: 'admin', canRun: true, passwordRequired: false });
    c.ws.close();
  });

  it('there is no admin password to log in with', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'anything' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('admin password server (listening on this computer)', () => {
  const PASSWORD = 'open-sesame-123';
  let server: RunRoomServer;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-pw-'));
    server = await startRunRoomServer({ port: 0, uploadsDir: join(dir, 'u'), projectsDir: join(dir, 'p'), password: PASSWORD, runner: fakeRunner(), sim: { idle: false }, log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  const base = () => `http://127.0.0.1:${server.port}`;
  const helloConfig = (headers: Record<string, string>, path = '/ws') =>
    new Promise<Extract<ServerEvent, { type: 'HELLO' }>['payload']['config']>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, { headers });
      ws.on('message', (d) => {
        const hit = (JSON.parse(d.toString()) as ServerEvent[]).find((e) => e.type === 'HELLO');
        if (hit?.type === 'HELLO') {
          ws.close();
          resolve(hit.payload.config);
        }
      });
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });

  const login = async (password: string) => {
    const res = await fetch(`${base()}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    return { status: res.status, body: (await res.json()) as { token?: string; error?: string } };
  };

  it('a visitor connects and watches as a guest but cannot run; a DNS rebinding host is refused', async () => {
    expect(await helloConfig({})).toMatchObject({ role: 'guest', canRun: false, passwordRequired: true });
    // Listening only on 127.0.0.1: a foreign host name (DNS rebinding) is refused even with a password.
    await expect(helloConfig({ Host: 'anything.example' })).rejects.toThrow(/403/);
  });

  it('a DNS rebinding page cannot even try the password', async () => {
    const http = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const body = JSON.stringify({ password: PASSWORD });
      const req = http.request(
        { host: '127.0.0.1', port: server.port, path: '/api/login', method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.end(body);
    });
    expect(status).toBe(403);
  });

  it('a guest WebSocket command is refused', async () => {
    const events: ServerEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.on('message', (d) => events.push(...(JSON.parse(d.toString()) as ServerEvent[])));
    ws.send(JSON.stringify({ type: 'SUBMIT_TASK', payload: { source: { kind: 'upload', uploadId: 'up_0123456789abcdef' }, run: 'python main.py', priority: 'NORMAL' } }));
    await new Promise((r) => setTimeout(r, 200));
    const notice = events.find((e) => e.type === 'NOTICE');
    expect(notice?.type === 'NOTICE' && notice.payload.text).toMatch(/guest/);
    ws.close();
  });

  it('the right password returns a token that unlocks full access', async () => {
    expect((await login('wrong')).status).toBe(401);
    const ok = await login(PASSWORD);
    expect(ok.status).toBe(200);
    const token = ok.body.token!;
    expect(token).toBeTruthy();
    expect(await helloConfig({}, `/ws?token=${token}`)).toMatchObject({ role: 'admin', canRun: true });
  });

  it('uploads need the token', async () => {
    const post = (headers: Record<string, string>) => {
      const form = new FormData();
      form.append('file', new Blob(['print(1)\n']), 'p.py');
      return fetch(`${base()}/api/upload/file`, { method: 'POST', body: form, headers });
    };
    expect((await post({})).status).toBe(403);
    const token = (await login(PASSWORD)).body.token!;
    expect((await post({ 'X-RunRoom-Token': token })).status).toBe(200);
  });
});
