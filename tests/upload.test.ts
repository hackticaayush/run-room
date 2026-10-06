import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planFolder, sanitizeFilename, UploadStore, validateSingleFile } from '../server/upload';
import { normalizeRelPath } from '../shared/projectFiles';
import { MAX_FILE_BYTES, MAX_PER_FILE_BYTES, MAX_PROJECT_BYTES } from '../shared/constants';
import { formatBytes } from '../shared/display';
import { startRunRoomServer, type RunRoomServer } from '../server/app';
import { fakeRunner } from './helpers/fakeRunner';

describe('single file uploads', () => {
  it('sanitizes names: no paths, no odd characters, no leading dots', () => {
    expect(sanitizeFilename('../../etc/passwd.py')).toBe('passwd.py');
    expect(sanitizeFilename('C:\\Users\\me\\script.py')).toBe('script.py');
    expect(sanitizeFilename('my file (1).py')).toBe('my_file_1_.py');
    expect(sanitizeFilename('.hidden.py')).toBe('hidden.py');
    expect(sanitizeFilename('.py')).toBe('upload.py');
  });

  it('allows up to 1 GB per file and per folder', () => {
    const GB = 1024 * 1024 * 1024;
    expect([MAX_FILE_BYTES, MAX_PER_FILE_BYTES, MAX_PROJECT_BYTES]).toEqual([GB, GB, GB]);
    expect(formatBytes(GB)).toBe('1 GB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(512)).toBe('512 bytes');
  });

  it('accepts only Python files up to 1 GB that are text', () => {
    expect(validateSingleFile('a.py', 10, Buffer.from('print(1)')).ok).toBe(true);
    expect(validateSingleFile('a.pyw', 10).ok).toBe(true);
    expect(validateSingleFile('a.js', 10).error).toMatch(/only Python files/);
    expect(validateSingleFile('a.py.exe', 10).ok).toBe(false);
    expect(validateSingleFile('a.py', 0).ok).toBe(false);
    expect(validateSingleFile('a.py', 50 * 1024 * 1024).ok).toBe(true);
    expect(validateSingleFile('a.py', MAX_FILE_BYTES).ok).toBe(true);
    expect(validateSingleFile('a.py', MAX_FILE_BYTES + 1).error).toMatch(/limit is 1 GB/);
    expect(validateSingleFile('a.py', 4, Buffer.from([0x61, 0x00, 0x62, 0x63])).ok).toBe(false);
  });

  it('stores each upload in its own folder under a random id and resolves only known ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-up-'));
    const store = new UploadStore(dir);
    const rec = store.saveFile('../evil name.py', Buffer.from('print(1)\n'));
    if ('error' in rec) throw new Error(rec.error);
    expect(rec).toMatchObject({ kind: 'file', name: 'evil_name.py', entry: 'evil_name.py', fileCount: 1 });
    expect(rec.id).toMatch(/^up_[0-9a-f]{16}$/);
    expect(readFileSync(join(rec.filesDir, 'evil_name.py'), 'utf8')).toBe('print(1)\n');
    expect(store.resolve(rec.id)?.filesDir).toBe(rec.filesDir);
    expect(store.resolve('../../package.json')).toBeNull();
    expect(store.resolve('up_0000000000000000')).toBeNull();
    expect(store.resolve(rec.filesDir)).toBeNull();
  });
});

describe('project folder uploads', () => {
  it('rejects unsafe relative paths', () => {
    for (const bad of ['../x.py', 'a/../b.py', '/abs.py', 'C:/x.py', 'a//b.py', 'a/./b.py', 'con.py', 'a/nul', 'bad|name.py', 'trail.', 'x\u0001.py']) {
      expect(normalizeRelPath(bad)).toBeNull();
    }
    expect(normalizeRelPath('proj\\src\\main.py')).toBe('proj/src/main.py');
  });

  it('strips the folder name, skips caches and virtual environments, finds the entry and requirements', () => {
    const paths = [
      'proj/main.py',
      'proj/pkg/__init__.py',
      'proj/pkg/util.py',
      'proj/requirements.txt',
      'proj/data/input.csv',
      'proj/__pycache__/main.cpython-312.pyc',
      'proj/.git/HEAD',
      'proj/.venv/pyvenv.cfg',
      'proj/.venv/Lib/site-packages/x.py',
      'proj/myenv/pyvenv.cfg',
      'proj/myenv/bin/python',
      'proj/build.egg-info/PKG-INFO',
    ];
    const plan = planFolder(paths, paths.map(() => 10));
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.name).toBe('proj');
    expect(plan.files.map((f) => f.rel)).toEqual(['main.py', 'pkg/__init__.py', 'pkg/util.py', 'requirements.txt', 'data/input.csv']);
    expect(plan.skipped).toBe(7);
    expect(plan.entry).toBe('main.py');
    expect(plan.requirements).toBe('requirements.txt');
    expect(plan.pyFiles).toEqual(['main.py', 'pkg/__init__.py', 'pkg/util.py']);
  });

  it('refuses folders without Python, duplicates, oversized files and too many bytes', () => {
    expect(planFolder(['site/index.js', 'site/package.json'], [5, 5])).toEqual({ error: expect.stringMatching(/no \.py file/) });
    expect(planFolder(['p/A.py', 'p/a.py'], [5, 5])).toEqual({ error: expect.stringMatching(/same name/) });
    // 500 MB data files are fine now; over 1 GB per file or in total is not.
    expect(planFolder(['p/a.py', 'p/data.bin'], [5, 500 * 1024 * 1024])).toMatchObject({ totalBytes: 500 * 1024 * 1024 + 5 });
    expect(planFolder(['p/a.py', 'p/big.bin'], [5, MAX_PER_FILE_BYTES + 1])).toEqual({ error: expect.stringMatching(/larger than 1 GB/) });
    expect(planFolder(['p/a.py', 'p/b.bin', 'p/c.bin', 'p/d.bin'], [5, 4e8, 4e8, 4e8])).toEqual({ error: expect.stringMatching(/limit is 1 GB/) });
    expect(planFolder(['p/../x.py'], [5])).toEqual({ error: expect.stringMatching(/unsafe path/) });
    expect(planFolder(['p/a.py'], [5, 6])).toEqual({ error: expect.stringMatching(/incomplete/) });
  });

  it('guesses the entry when there is no main.py', () => {
    const plan = planFolder(['tool/run_me.py', 'tool/helpers.py'], [1, 1]);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.entry).toBe('helpers.py');
    const nested = planFolder(['repo/src/app/main.py', 'repo/README.md'], [1, 1]);
    if ('error' in nested) throw new Error(nested.error);
    expect(nested.entry).toBe('src/app/main.py');
  });
});

describe('upload endpoints', () => {
  let server: RunRoomServer;
  let base: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-http-'));
    server = await startRunRoomServer({
      port: 0,
      uploadsDir: join(dir, 'uploads'),
      projectsDir: join(dir, 'projects'),
      runner: fakeRunner(),
      sim: { idle: false },
      log: () => {},
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  const postFile = (name: string, content: string | Uint8Array, headers: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', new Blob([content]), name);
    return fetch(`${base}/api/upload/file`, { method: 'POST', body: form, headers });
  };

  const postFolder = (files: [string, string][]) => {
    const form = new FormData();
    form.append('manifest', JSON.stringify(files.map(([p]) => p)));
    for (const [p, c] of files) form.append('files', new Blob([c]), p.split('/').pop());
    return fetch(`${base}/api/upload/folder`, { method: 'POST', body: form });
  };

  it('accepts a python file and returns an opaque id and its summary', async () => {
    const res = await postFile('script.py', 'print("hi")\n');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; kind: string; entry: string };
    expect(body).toMatchObject({ kind: 'file', name: 'script.py', entry: 'script.py' });
    expect(body.id).toMatch(/^up_/);
    expect(JSON.stringify(body)).not.toContain(tmpdir().slice(0, 8));
  });

  it('rejects other file types and binary content with a readable error', async () => {
    const bad = await postFile('tool.js', 'console.log(1)');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/only Python files/);
    const binary = await postFile('bin.py', new Uint8Array([0x61, 0x00, 0x62]));
    expect(binary.status).toBe(400);
    expect(((await binary.json()) as { error: string }).error).toMatch(/not a text file/);
  });

  it('streams big uploads to disk: a 20 MB file is stored whole, refused parts leave nothing behind', async () => {
    const line = 'x = 1  # filler line for a big upload\n';
    const content = line.repeat(Math.ceil((20 * 1024 * 1024) / line.length));
    const res = await postFile('big.py', content);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; totalBytes: number };
    expect(body.totalBytes).toBe(content.length);
    const stored = server.uploads.resolve(body.id)!;
    expect(statSync(join(stored.filesDir, 'big.py')).size).toBe(content.length);
    // Nothing stays in the incoming folder, accepted or refused.
    await postFile('nope.js', 'x');
    expect(readdirSync(server.uploads.incomingDir)).toEqual([]);
  });

  it('the store also takes parts that are already on disk', () => {
    const store = new UploadStore(mkdtempSync(join(tmpdir(), 'runroom-disk-')));
    const tmp = join(store.incomingDir, 'in_test');
    writeFileSync(tmp, 'print("from disk")\n');
    const rec = store.saveFile('disk.py', { path: tmp, size: statSync(tmp).size });
    if ('error' in rec) throw new Error(rec.error);
    expect(readFileSync(join(rec.filesDir, 'disk.py'), 'utf8')).toBe('print("from disk")\n');
    expect(existsSync(tmp)).toBe(false);
  });

  it('stores a project folder with its structure', async () => {
    const res = await postFolder([
      ['demo/main.py', 'from pkg.util import twice\nprint(twice(21))\n'],
      ['demo/pkg/__init__.py', ''],
      ['demo/pkg/util.py', 'def twice(x):\n    return 2 * x\n'],
      ['demo/requirements.txt', ''],
      ['demo/__pycache__/x.pyc', 'junk'],
    ]);
    const body = (await res.json()) as { id: string; name: string; fileCount: number; skipped: number; entry: string; requirements: string };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ kind: 'folder', name: 'demo', fileCount: 4, skipped: 1, entry: 'main.py', requirements: 'requirements.txt' });
    const stored = server.uploads.resolve(body.id)!;
    expect(readFileSync(join(stored.filesDir, 'pkg', 'util.py'), 'utf8')).toContain('return 2 * x');
    expect(existsSync(join(stored.filesDir, '__pycache__'))).toBe(false);
  });

  it('refuses folders that are not Python projects or try to escape', async () => {
    const js = await postFolder([
      ['site/index.js', 'x'],
      ['site/package.json', '{}'],
    ]);
    expect(js.status).toBe(400);
    expect(((await js.json()) as { error: string }).error).toMatch(/only Python projects/);
    const evil = await postFolder([['demo/../../evil.py', 'x']]);
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { error: string }).error).toMatch(/unsafe path/);
  });

  it('refuses uploads coming from another web site', async () => {
    const res = await postFile('x.py', 'print(1)', { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
  });

  it('never serves uploads or saved projects back', async () => {
    for (const path of ['/uploads/anything.py', '/server/uploads/x', '/data/projects/x', '/api/uploads']) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }
  });
});
