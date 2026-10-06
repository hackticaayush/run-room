// Projects uploaded as one .zip (phones cannot pick folders).

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadStore } from '../server/upload';
import { startRunRoomServer, type RunRoomServer } from '../server/app';
import { fakeRunner } from './helpers/fakeRunner';
import { makeZip, type ZipItem } from './helpers/zip';

function storeWith(items: ZipItem[] | Buffer, name = 'project.zip') {
  const store = new UploadStore(mkdtempSync(join(tmpdir(), 'runroom-zip-')));
  const buf = Buffer.isBuffer(items) ? items : makeZip(items);
  const path = join(store.incomingDir, 'in_zip');
  writeFileSync(path, buf);
  return { store, run: () => store.saveZip(name, { path, size: buf.length }) };
}

const uploadsIn = (store: UploadStore) => readdirSync(store.dir).filter((n) => n.startsWith('up_'));

describe('zip uploads', () => {
  it('unpacks a GitHub style zip: strips the top folder, skips __MACOSX, venvs and caches', async () => {
    const { run } = storeWith([
      { name: 'calc-main/' },
      { name: 'calc-main/main.py', data: 'from pkg.ops import add\nprint(add(1, 2))\n' },
      { name: 'calc-main/pkg/' },
      { name: 'calc-main/pkg/__init__.py', data: '' },
      { name: 'calc-main/pkg/ops.py', data: 'def add(a, b):\n    return a + b\n' },
      { name: 'calc-main/requirements.txt', data: 'requests\n' },
      { name: 'calc-main/data/big.csv', data: 'a,b\n'.repeat(5000) },
      { name: '__MACOSX/calc-main/._main.py', data: 'junk' },
      { name: 'calc-main/.venv/pyvenv.cfg', data: 'home = x' },
      { name: 'calc-main/.venv/Lib/site.py', data: 'x' },
      { name: 'calc-main/pkg/__pycache__/ops.cpython-312.pyc', data: 'x' },
    ]);
    const rec = await run();
    if ('error' in rec) throw new Error(rec.error);
    expect(rec).toMatchObject({ kind: 'folder', name: 'calc-main', fileCount: 5, skipped: 4, entry: 'main.py', requirements: 'requirements.txt' });
    expect(rec.pyFiles).toEqual(['main.py', 'pkg/__init__.py', 'pkg/ops.py']);
    expect(readFileSync(join(rec.filesDir, 'pkg', 'ops.py'), 'utf8')).toContain('return a + b');
    expect(readFileSync(join(rec.filesDir, 'data', 'big.csv'), 'utf8').length).toBe(20000);
    expect(existsSync(join(rec.filesDir, '.venv'))).toBe(false);
    expect(existsSync(join(rec.filesDir, '__MACOSX'))).toBe(false);
  });

  it('names a zip without a top folder after the zip file', async () => {
    const { run } = storeWith(
      [
        { name: 'tool.py', data: 'print(1)\n' },
        { name: 'helpers.py', data: 'X = 1\n' },
      ],
      'my tool.zip',
    );
    const rec = await run();
    if ('error' in rec) throw new Error(rec.error);
    expect(rec.name).toBe('my_tool');
    expect(rec.entry).toBe('helpers.py');
  });

  it('refuses "../" names, symlinks, folders without Python and files that are not zips', async () => {
    const slip = storeWith([
      { name: 'p/main.py', data: 'x' },
      { name: '../evil.py', data: 'x' },
    ]);
    expect(await slip.run()).toEqual({ error: expect.stringMatching(/unsafe path/) });
    expect(uploadsIn(slip.store)).toEqual([]);

    const link = storeWith([
      { name: 'p/main.py', data: 'x' },
      { name: 'p/secrets', data: '/etc/passwd', mode: 0o120777 },
    ]);
    expect(await link.run()).toEqual({ error: expect.stringMatching(/symbolic links/) });

    const js = storeWith([{ name: 'site/index.js', data: 'x' }]);
    expect(await js.run()).toEqual({ error: expect.stringMatching(/only Python projects/) });

    const junk = storeWith(Buffer.from('this is not a zip file at all'));
    expect(await junk.run()).toEqual({ error: expect.stringMatching(/not a valid \.zip/) });

    const txt = storeWith([{ name: 'a.py', data: 'x' }], 'notes.txt');
    expect(await txt.run()).toEqual({ error: expect.stringMatching(/pick a \.zip/) });
  });

  it('a zip that lies about its sizes (a zip bomb) fails while unpacking and leaves nothing behind', async () => {
    const { store, run } = storeWith([
      { name: 'p/main.py', data: 'print(1)\n' },
      { name: 'p/bomb.bin', data: Buffer.alloc(200000), declaredSize: 10 },
    ]);
    expect(await run()).toHaveProperty('error');
    expect(uploadsIn(store)).toEqual([]);
  });

  it('refuses a zip that declares more than 1 GB inside', async () => {
    const { run } = storeWith([
      { name: 'p/main.py', data: 'print(1)\n' },
      { name: 'p/huge.bin', data: 'x', declaredSize: 1024 * 1024 * 1024 + 1 },
    ]);
    expect(await run()).toEqual({ error: expect.stringMatching(/larger than 1 GB/) });
  });
});

describe('POST /api/upload/zip', () => {
  let server: RunRoomServer;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runroom-ziphttp-'));
    server = await startRunRoomServer({ port: 0, uploadsDir: join(dir, 'u'), projectsDir: join(dir, 'p'), runner: fakeRunner(), sim: { idle: false }, log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  const post = (name: string, body: Buffer) => {
    const form = new FormData();
    form.append('file', new Blob([body]), name);
    return fetch(`http://127.0.0.1:${server.port}/api/upload/zip`, { method: 'POST', body: form });
  };

  it('stores the project and removes the uploaded zip', async () => {
    const res = await post('demo.zip', makeZip([{ name: 'demo/main.py', data: 'print("hi")\n' }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'folder', name: 'demo', entry: 'main.py', fileCount: 1 });
    const bad = await post('demo.zip', makeZip([{ name: '../x.py', data: 'x' }]));
    expect(bad.status).toBe(400);
    expect(readdirSync(server.uploads.incomingDir)).toEqual([]);
  });
});
