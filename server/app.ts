// HTTP + WebSocket bootstrap. One Simulation, many viewers.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { formatBytes } from '../shared/display';
import { makeEvent, parseClientCommand } from '../shared/events';
import { MAX_FILE_BYTES, MAX_PER_FILE_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, WS_PATH } from '../shared/constants';
import { ClientRegistry } from './net/ClientRegistry';
import { AdminAuth, clientAddress, refuseReason, tokenOf, type AccessOptions } from './net/security';
import { Simulation, type SimulationOptions } from './sim/Simulation';
import { summaryOf, UploadStore } from './upload';
import { ProjectStore } from './projects';
import { PythonRunner, type PythonRunnerOptions } from './runners/PythonRunner';
import { findPython, killAllChildren } from './runners/python/process';
import type { TaskRunner } from './runners/TaskRunner';

export interface RunRoomServerOptions {
  port?: number;
  /** Listen address. Default 127.0.0.1 (this computer only). */
  host?: string;
  sim?: Omit<SimulationOptions, 'runner' | 'uploads' | 'projects' | 'runEnabled'>;
  /** Running code at all (RUNROOM_RUN=off switches it off). Default true. */
  runEnabled?: boolean;
  /** Extra browser origins allowed to connect in open mode. */
  allowedOrigins?: string[];
  /** The admin password. When set, full access needs logging in; otherwise everyone is admin. */
  password?: string | null;
  /** Where uploads are stored (default server/uploads). */
  uploadsDir?: string;
  /** Where saved projects live (default data/projects). */
  projectsDir?: string;
  /** Override the runner (tests). Default: PythonRunner. */
  runner?: TaskRunner;
  python?: PythonRunnerOptions;
  /** Serve the built client from client/dist when it exists (production mode). */
  serveClient?: boolean;
  log?: (msg: string) => void;
}

export interface RunRoomServer {
  port: number;
  sim: Simulation;
  registry: ClientRegistry;
  uploads: UploadStore;
  projects: ProjectStore;
  http: Server;
  close(): Promise<void>;
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Tiny fixed window rate limiter (per remote address). Used for uploads and login attempts. */
function rateLimiter(maxPerMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = clientAddress(req);
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.windowStart > 60000) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    if (++h.count > maxPerMinute) {
      res.status(429).json({ error: 'too many requests, wait a minute' });
      return;
    }
    next();
  };
}

function multerError(err: unknown): string {
  const code = (err as { code?: string }).code;
  switch (code) {
    case 'LIMIT_FILE_SIZE':
      return `a file is larger than ${formatBytes(MAX_PER_FILE_BYTES)}`;
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
      return `too many files (limit ${MAX_PROJECT_FILES})`;
    case 'LIMIT_UNEXPECTED_FILE':
      return 'unexpected upload field';
    default:
      return 'upload failed';
  }
}

export async function startRunRoomServer(options: RunRoomServerOptions = {}): Promise<RunRoomServer> {
  const log = options.log ?? ((m: string) => console.log(m));
  const bindHost = options.host ?? '127.0.0.1';
  const access: AccessOptions = {
    bindHost,
    allowedOrigins: options.allowedOrigins ?? [],
  };
  const auth = new AdminAuth(options.password ?? null);
  const runEnabled = options.runEnabled ?? true;
  const uploads = new UploadStore(options.uploadsDir ?? join(REPO_ROOT, 'server', 'uploads'));
  const projects = new ProjectStore(options.projectsDir ?? join(REPO_ROOT, 'data', 'projects'));
  const runner = options.runner ?? new PythonRunner(options.python);

  const sim = new Simulation({ ...options.sim, runner, uploads, projects, runEnabled });
  const python = await findPython();
  sim.python = python ? `Python ${python.version}` : null;
  sim.passwordRequired = auth.required;
  const registry = new ClientRegistry();

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const why = refuseReason(req, access, auth, req.method !== 'GET' && req.method !== 'HEAD');
    if (why && req.path.startsWith('/api')) {
      res.status(403).json({ error: why });
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, clients: registry.count, worldClock: Math.round(sim.worldClock), runEnabled, python: sim.python });
  });

  // Exchange the admin password for a session token. Rate limited against guessing.
  app.post('/api/login', rateLimiter(20), express.json({ limit: '4kb' }), (req, res) => {
    if (!auth.required) {
      res.status(400).json({ error: 'this RUN ROOM has no admin password: everyone already has full access' });
      return;
    }
    const token = auth.login((req.body as { password?: unknown } | undefined)?.password);
    if (!token) {
      res.status(401).json({ error: 'wrong password' });
      return;
    }
    log('[auth] admin logged in');
    res.json({ token });
  });

  // Drop a session token (log out). Harmless without a valid token.
  app.post('/api/logout', (req, res) => {
    auth.revoke(tokenOf(req));
    res.json({ ok: true });
  });

  /** Uploads need admin (full access). */
  const mayUpload = (req: Request, res: Response, next: NextFunction) => {
    if (!runEnabled) {
      res.status(403).json({ error: 'running code is switched off on this server' });
      return;
    }
    if (auth.role(req) !== 'admin') {
      res.status(403).json({ error: 'full access needed: enter the admin password (ADMIN in the top bar) to upload code' });
      return;
    }
    next();
  };

  // Uploads stream to disk (up to 1 GB, never held in memory), are checked, then moved into their
  // own folder. Anything refused is deleted again.
  const toDisk = multer.diskStorage({
    destination: uploads.incomingDir,
    filename: (_req, _file, cb) => cb(null, `in_${randomBytes(8).toString('hex')}`),
  });
  const onDisk = (f: Express.Multer.File) => ({ path: f.path, size: f.size });

  // One Python file.
  const fileUpload = multer({ storage: toDisk, limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 } });
  app.post('/api/upload/file', mayUpload, rateLimiter(30), (req, res) => {
    fileUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? `the file is larger than ${formatBytes(MAX_FILE_BYTES)}` : multerError(err) });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'no file received' });
        return;
      }
      const part = onDisk(req.file);
      const saved = uploads.saveFile(req.file.originalname, part);
      uploads.discard([part]);
      if ('error' in saved) {
        res.status(400).json({ error: saved.error });
        return;
      }
      log(`[upload] ${saved.name} (${saved.totalBytes} bytes) -> ${saved.id}`);
      res.json(summaryOf(saved));
    });
  });

  // A project folder: a "manifest" field (JSON list of relative paths) plus the files in order.
  const folderUpload = multer({
    storage: toDisk,
    limits: { fileSize: MAX_PER_FILE_BYTES, files: MAX_PROJECT_FILES, fields: 4, fieldSize: 2 * 1024 * 1024, parts: MAX_PROJECT_FILES + 8 },
  });
  app.post('/api/upload/folder', mayUpload, rateLimiter(20), (req, res) => {
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length)) {
      res.status(411).json({ error: 'missing Content-Length' });
      return;
    }
    if (length > MAX_PROJECT_BYTES + 4 * 1024 * 1024) {
      res.status(413).json({ error: `the folder is larger than ${formatBytes(MAX_PROJECT_BYTES)}` });
      return;
    }
    folderUpload.array('files', MAX_PROJECT_FILES)(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: multerError(err) });
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const parts = files.map(onDisk);
      let manifest: unknown;
      try {
        manifest = JSON.parse(String((req.body as { manifest?: string } | undefined)?.manifest ?? ''));
      } catch {
        manifest = null;
      }
      if (!Array.isArray(manifest) || manifest.length !== files.length || !manifest.every((p) => typeof p === 'string')) {
        uploads.discard(parts);
        res.status(400).json({ error: 'the folder upload is incomplete, try again' });
        return;
      }
      const saved = uploads.saveFolder(manifest as string[], parts);
      uploads.discard(parts);
      if ('error' in saved) {
        res.status(400).json({ error: saved.error });
        return;
      }
      log(`[upload] folder ${saved.name} (${saved.fileCount} files, ${saved.totalBytes} bytes, ${saved.skipped} skipped) -> ${saved.id}`);
      res.json(summaryOf(saved));
    });
  });
  // A project as one .zip file (phones cannot pick folders). Unpacked with the folder rules.
  const zipUpload = multer({ storage: toDisk, limits: { fileSize: MAX_PROJECT_BYTES, files: 1, fields: 4 } });
  app.post('/api/upload/zip', mayUpload, rateLimiter(20), (req, res) => {
    zipUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? `the zip is larger than ${formatBytes(MAX_PROJECT_BYTES)}` : multerError(err) });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'no file received' });
        return;
      }
      const part = onDisk(req.file);
      const name = req.file.originalname;
      void uploads.saveZip(name, part).then((saved) => {
        uploads.discard([part]);
        if ('error' in saved) {
          res.status(400).json({ error: saved.error });
          return;
        }
        log(`[upload] zip ${saved.name} (${saved.fileCount} files, ${saved.totalBytes} bytes, ${saved.skipped} skipped) -> ${saved.id}`);
        res.json(summaryOf(saved));
      });
    });
  });
  // Uploads and saved projects are never served back: there is deliberately no static route.

  const dist = join(REPO_ROOT, 'client', 'dist');
  if (options.serveClient && existsSync(dist)) {
    app.use(express.static(dist, { index: 'index.html' }));
    app.get(/^\/(?!api\/|ws).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  const http = createServer(app);
  // A 1 GB upload over a slow link can take longer than Node's default 5 minute request timeout.
  http.requestTimeout = 60 * 60 * 1000;
  const wss = new WebSocketServer({
    server: http,
    path: WS_PATH,
    maxPayload: 64 * 1024,
    verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
      const why = refuseReason(info.req, access, auth, true);
      if (why) done(false, 403, why);
      else done(true);
    },
  });

  sim.onFlush((broadcast, direct) => {
    registry.broadcast(broadcast);
    for (const [clientId, events] of direct) registry.sendTo(clientId, events);
  });

  wss.on('connection', (ws, req) => {
    // Anyone may connect and watch. Admin (the password holder, or everyone in open mode) may run.
    const client = registry.add(ws, clientAddress(req));
    sim.setClientPermissions(client.id, auth.role(req) === 'admin');
    registry.sendTo(client.id, [makeEvent('HELLO', { clientId: client.id, config: sim.config(client.id) }), ...sim.snapshotEvents()]);
    sim.setClientCount(registry.count);
    log(`[ws] client ${client.id} connected (${registry.count} online)`);

    ws.on('message', (data) => {
      const parsed = parseClientCommand(data.toString());
      if (!parsed.ok) {
        registry.sendTo(client.id, [makeEvent('NOTICE', { level: 'warn', text: `rejected: ${parsed.error}` })]);
        return;
      }
      sim.enqueueCommand(client.id, parsed.command);
    });

    ws.on('close', () => {
      registry.remove(client.id);
      sim.clientLeft(client.id);
      sim.setClientCount(registry.count);
      log(`[ws] client ${client.id} left (${registry.count} online)`);
    });

    ws.on('error', () => {
      // The close event follows; nothing else to do.
    });
  });

  const heartbeat = setInterval(() => registry.heartbeat(), 15000);

  const port = await new Promise<number>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, bindHost, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : (options.port ?? 0));
    });
  });

  sim.start();

  return {
    port,
    sim,
    registry,
    uploads,
    projects,
    http,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        sim.stop();
        killAllChildren();
        registry.closeAll();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
