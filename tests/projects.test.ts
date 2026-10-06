import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanProjectName, ProjectStore } from '../server/projects';

function source(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'runroom-src-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, ...rel.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const base = { kind: 'folder' as const, entry: 'main.py', fileCount: 2, totalBytes: 20, setup: ['pip install -r requirements.txt'], run: 'python main.py' };

describe('saved projects store', () => {
  it('checks names', () => {
    expect(cleanProjectName('  My   App ')).toBe('My App');
    expect(cleanProjectName('calc_v2 (beta).x-1')).toBe('calc_v2 (beta).x-1');
    expect(cleanProjectName('')).toEqual({ error: expect.any(String) });
    expect(cleanProjectName('x'.repeat(41))).toEqual({ error: expect.any(String) });
    expect(cleanProjectName('../evil')).toEqual({ error: expect.stringMatching(/letters, digits/) });
    expect(cleanProjectName('a/b')).toEqual({ error: expect.any(String) });
  });

  it('copies the code, persists across restarts and tracks setup and runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'runroom-proj-'));
    const store = new ProjectStore(root);
    const p = store.create({ ...base, name: 'Calc', sourceDir: source({ 'main.py': 'print(1)\n', 'lib/a.py': 'X = 1\n' }) });
    if ('error' in p) throw new Error(p.error);
    expect(p.id).toMatch(/^p_[0-9a-f]{12}$/);
    expect(readFileSync(join(p.filesDir, 'lib', 'a.py'), 'utf8')).toBe('X = 1\n');
    expect(p.setupDone).toBe(false);

    store.markSetup(p.id, base.setup, true);
    store.markRun(p.id, { taskId: 'T007', ok: true, exitCode: 0 });
    expect(store.get(p.id)).toMatchObject({ setupDone: true, lastRun: { taskId: 'T007', ok: true, exitCode: 0 } });

    // A new store over the same folder sees the same projects.
    const again = new ProjectStore(root);
    expect(again.list()).toEqual([expect.objectContaining({ id: p.id, name: 'Calc', setupDone: true, run: 'python main.py' })]);
    expect(JSON.stringify(again.list())).not.toContain(root.slice(0, 10));

    // Changing the setup means it has to run again.
    again.update(p.id, { setup: ['pip install numpy'] });
    expect(again.get(p.id)?.setupDone).toBe(false);
    // A failed setup never counts as done.
    again.markSetup(p.id, ['pip install numpy'], false);
    expect(again.get(p.id)?.setupDone).toBe(false);
    again.markSetup(p.id, ['pip install numpy'], true);
    expect(again.get(p.id)?.setupDone).toBe(true);
  });

  it('refuses duplicate names (any case); overwrite replaces the code and asks for a new setup', () => {
    const store = new ProjectStore(mkdtempSync(join(tmpdir(), 'runroom-proj-')));
    const p = store.create({ ...base, name: 'Tool', sourceDir: source({ 'main.py': 'v1\n', 'old.py': '' }) });
    if ('error' in p) throw new Error(p.error);
    store.markSetup(p.id, base.setup, true);
    expect(store.create({ ...base, name: 'TOOL', sourceDir: source({ 'main.py': 'v2\n' }) })).toEqual({ error: expect.stringMatching(/already exists/) });
    const q = store.create({ ...base, name: 'TOOL', overwrite: true, sourceDir: source({ 'main.py': 'v2\n' }) });
    if ('error' in q) throw new Error(q.error);
    expect(q.id).toBe(p.id);
    expect(readFileSync(join(q.filesDir, 'main.py'), 'utf8')).toBe('v2\n');
    expect(existsSync(join(q.filesDir, 'old.py'))).toBe(false);
    expect(q.setupDone).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it('renames with a uniqueness check and deletes the folder', () => {
    const store = new ProjectStore(mkdtempSync(join(tmpdir(), 'runroom-proj-')));
    const a = store.create({ ...base, name: 'A', sourceDir: source({ 'main.py': '' }) });
    const b = store.create({ ...base, name: 'B', sourceDir: source({ 'main.py': '' }) });
    if ('error' in a || 'error' in b) throw new Error('create failed');
    expect(store.update(b.id, { name: 'a' })).toEqual({ error: expect.stringMatching(/already exists/) });
    expect(store.update(b.id, { name: 'B2' })).toMatchObject({ name: 'B2' });
    expect(store.remove(a.id)).toBe(true);
    expect(existsSync(a.dir)).toBe(false);
    expect(store.get(a.id)).toBeNull();
    expect(store.get('../../etc')).toBeNull();
  });
});
