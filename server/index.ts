// Entry point: npm run dev (local) or npm start (serves the built client on 127.0.0.1).
// Public deploy: npm run start:public (or set --public / RUNROOM_PUBLIC=1) with an admin password.
// Settings come from the environment, or from a .env file in the repo root (NAME=value lines);
// a real environment variable wins over the file.
//   PORT=8787                      HTTP + WebSocket port
//   HOST=127.0.0.1                 listen address (--public defaults it to 0.0.0.0)
//   SIM_TICK_RATE=60               simulation ticks per second
//   RUNROOM_RUN=off               switch running code off (the office is then only a show)
//   RUNROOM_ACCESS_PASSWORD=...   the admin password. Anyone who opens the page watches as a guest;
//                                  entering this password unlocks full access (upload, run, control).
//                                  Required when the server listens on a non-loopback address.
//   RUNROOM_PUBLIC=1              listen on 0.0.0.0 (same as --public): reachable from other devices
//   RUNROOM_ALLOWED_ORIGINS=...   extra browser origins (open mode only), comma separated
//   RUNROOM_DATA_DIR=./data       where saved projects live
//   RUNROOM_TRACE=auto            auto | monitoring | profile | off (function call tracing)
//   RUNROOM_RUN_TIMEOUT_MIN=60    time limit of one program, not counting time waiting for input
//   RUNROOM_SETUP_TIMEOUT_MIN=20  time limit of one setup command
//   PYTHON=/path/to/python         the interpreter to use (default: python3, python, py -3)
//   --serve-client                 also serve the built client (client/dist) on the same port
//   --public                       listen on 0.0.0.0 so phones and other computers can reach it
//                                  (an admin password is then required)

import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../shared/constants';
import { startRunRoomServer } from './app';
import { isLoopbackHost } from './net/security';

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Local settings such as RUNROOM_ACCESS_PASSWORD. Loaded before anything below reads them; a real
// environment variable with the same name wins, so a host's own settings take precedence.
const envFile = join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const serveClient = process.argv.includes('--serve-client') || process.env.SERVE_CLIENT === '1';
const isPublic = process.argv.includes('--public') || process.env.RUNROOM_PUBLIC === '1';
const host = process.env.HOST || (isPublic ? '0.0.0.0' : '127.0.0.1');
const tickRate = num(process.env.SIM_TICK_RATE, 60);
const runEnabled = (process.env.RUNROOM_RUN ?? '').toLowerCase() !== 'off';
const password = (process.env.RUNROOM_ACCESS_PASSWORD ?? '').trim() || null;
const dataDir = process.env.RUNROOM_DATA_DIR ? resolve(process.env.RUNROOM_DATA_DIR) : join(repoRoot, 'data');

// Listening on anything but loopback without a password would give everyone who can reach the
// address full access (RUN ROOM runs real code and is not a sandbox). Refuse to start instead.
const loopbackOnly = isLoopbackHost(host);
if (!loopbackOnly && !password) {
  console.error(`[runroom] refusing to listen on ${host} without an admin password.`);
  console.error('[runroom] anyone who reached this address would be able to run code on this computer.');
  console.error('[runroom] set RUNROOM_ACCESS_PASSWORD=your-password (and put RUN ROOM behind HTTPS) and start again.');
  process.exit(1);
}

/** This computer's addresses on the local network (IPv4, no loopback or link-local). */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

const server = await startRunRoomServer({
  port,
  host,
  sim: { tickRate },
  runEnabled,
  allowedOrigins: (process.env.RUNROOM_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  password,
  projectsDir: join(dataDir, 'projects'),
  python: {
    trace: process.env.RUNROOM_TRACE || 'auto',
    runTimeoutMs: num(process.env.RUNROOM_RUN_TIMEOUT_MIN, 60) * 60000,
    setupTimeoutMs: num(process.env.RUNROOM_SETUP_TIMEOUT_MIN, 20) * 60000,
  },
  serveClient,
});

const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
console.log(`[runroom] simulation server listening on http://${shown}:${server.port} (ws path /ws, ${tickRate} ticks/s)`);
if (!runEnabled) console.log('[runroom] running code is OFF (RUNROOM_RUN=off)');
else {
  console.log(`[runroom] full access (upload + run) for ${password ? 'anyone with the admin password' : 'everyone (no admin password set)'} - ${server.sim.python ?? 'no Python 3.8+ found (install it or set PYTHON)'}`);
  console.log('[runroom] programs run as normal processes with your permissions: this is not a sandbox');
}
if (!loopbackOnly) {
  const pagePort = serveClient ? server.port : num(process.env.VITE_PORT, 5173);
  const urls = lanAddresses().map((ip) => `http://${ip}:${pagePort}/`);
  if (urls.length === 0) console.log('[runroom] PUBLIC: no network address found (is this computer on Wi-Fi or a LAN?)');
  else {
    console.log('[runroom] PUBLIC: open the office from another device on the same network at:');
    for (const u of urls) console.log(`[runroom]   ${u}`);
  }
  console.log('[runroom] visitors watch as guests; the admin password unlocks full access. Put this behind HTTPS on the open internet.');
  if (password && password.length < 12) {
    console.log('[runroom] WARNING: the admin password is short and easy to guess, and whoever guesses it can run code on this computer.');
    console.log('[runroom] use a long random password (RUNROOM_ACCESS_PASSWORD or .env) before putting RUN ROOM on the internet.');
  }
}

const shutdown = async () => {
  console.log('[runroom] shutting down');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
