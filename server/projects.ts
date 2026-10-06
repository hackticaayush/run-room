// Saved projects: code plus its setup and run commands under a name, for one click runs.
// Stored on disk (default data/projects next to the repo, never served over HTTP):
//   data/projects/<id>/project.json   name, commands, status
//   data/projects/<id>/files/         the code (the program's working directory)
//   data/projects/<id>/venv/          its virtual environment, made by the first setup

import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MAX_PROJECT_NAME } from '../shared/constants';
import { PROJECT_ID_RE } from '../shared/events';
import type { CodeKind, ProjectInfo } from '../shared/types';

export interface ProjectRecord extends ProjectInfo {
  dir: string;
  filesDir: string;
  venvDir: string;
}

interface StoredJson extends ProjectInfo {
  /** Bumped whenever the code is replaced (a new setup is needed then). */
  filesVersion: number;
  /** Fingerprint of the setup that last ran OK (commands + files version), or null. */
  setupKey: string | null;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/;

/** Checks and tidies a project name. */
export function cleanProjectName(name: string): string | { error: string } {
  const n = String(name).trim().replace(/\s+/g, ' ');
  if (!n || n.length > MAX_PROJECT_NAME) return { error: `the name must be 1 to ${MAX_PROJECT_NAME} characters` };
  if (!NAME_RE.test(n)) return { error: 'use letters, digits, spaces and . _ - ( ) in the name' };
  return n;
}

function setupKey(setup: string[], filesVersion: number): string {
  return createHash('sha1').update(JSON.stringify([setup, filesVersion])).digest('hex').slice(0, 16);
}

export interface NewProject {
  name: string;
  kind: CodeKind;
  /** Folder holding the code to copy in. */
  sourceDir: string;
  entry: string | null;
  fileCount: number;
  totalBytes: number;
  setup: string[];
  run: string;
  overwrite?: boolean;
}

export class ProjectStore {
  readonly root: string;
  private readonly items = new Map<string, StoredJson>();

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.load();
  }

  private load(): void {
    for (const id of readdirSync(this.root)) {
      if (!PROJECT_ID_RE.test(id)) continue;
      try {
        const data = JSON.parse(readFileSync(join(this.root, id, 'project.json'), 'utf8')) as StoredJson;
        if (data.id !== id || typeof data.name !== 'string' || typeof data.run !== 'string' || !Array.isArray(data.setup)) continue;
        if (!existsSync(join(this.root, id, 'files'))) continue;
        this.items.set(id, { ...data, filesVersion: data.filesVersion ?? 1, setupKey: data.setupKey ?? null });
      } catch {
        // A broken project folder is ignored (and left alone).
      }
    }
  }

  private persist(p: StoredJson): void {
    const dir = join(this.root, p.id);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, 'project.json.tmp');
    writeFileSync(tmp, JSON.stringify(p, null, 2));
    renameSync(tmp, join(dir, 'project.json'));
  }

  private record(p: StoredJson): ProjectRecord {
    const dir = join(this.root, p.id);
    const { filesVersion: _v, setupKey: _k, ...info } = p;
    return { ...info, setupDone: p.setup.length === 0 || p.setupKey === setupKey(p.setup, p.filesVersion), dir, filesDir: join(dir, 'files'), venvDir: join(dir, 'venv') };
  }

  list(): ProjectInfo[] {
    return [...this.items.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => {
        const { dir: _d, filesDir: _f, venvDir: _e, ...info } = this.record(p);
        return info;
      });
  }

  get(id: string): ProjectRecord | null {
    const p = PROJECT_ID_RE.test(id) ? this.items.get(id) : undefined;
    return p ? this.record(p) : null;
  }

  findByName(name: string): ProjectRecord | null {
    const key = name.trim().toLowerCase();
    const p = [...this.items.values()].find((x) => x.name.toLowerCase() === key);
    return p ? this.record(p) : null;
  }

  /** Saves code under a name. With overwrite, an existing project of that name gets the new code. */
  create(input: NewProject): ProjectRecord | { error: string } {
    const name = cleanProjectName(input.name);
    if (typeof name !== 'string') return name;
    const existing = this.findByName(name);
    if (existing && !input.overwrite) return { error: `a project called "${existing.name}" already exists` };
    const now = Date.now();
    const id = existing?.id ?? `p_${randomBytes(6).toString('hex')}`;
    const dir = join(this.root, id);
    const filesDir = join(dir, 'files');
    try {
      mkdirSync(dir, { recursive: true });
      const staging = join(dir, 'files.new');
      rmSync(staging, { recursive: true, force: true });
      cpSync(input.sourceDir, staging, { recursive: true });
      rmSync(filesDir, { recursive: true, force: true });
      renameSync(staging, filesDir);
    } catch (err) {
      if (!existing) rmSync(dir, { recursive: true, force: true });
      return { error: `could not save the project: ${(err as Error).message}` };
    }
    const prev = existing ? this.items.get(existing.id)! : null;
    const p: StoredJson = {
      id,
      name,
      kind: input.kind,
      entry: input.entry,
      fileCount: input.fileCount,
      totalBytes: input.totalBytes,
      setup: [...input.setup],
      run: input.run,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      setupDone: false,
      lastRun: prev?.lastRun ?? null,
      filesVersion: (prev?.filesVersion ?? 0) + 1,
      setupKey: null,
    };
    this.items.set(id, p);
    this.persist(p);
    return this.record(p);
  }

  update(id: string, patch: { name?: string; setup?: string[]; run?: string }): ProjectRecord | { error: string } {
    const p = this.items.get(id);
    if (!p) return { error: 'that project does not exist any more' };
    const next = { ...p, updatedAt: Date.now() };
    if (patch.name !== undefined) {
      const name = cleanProjectName(patch.name);
      if (typeof name !== 'string') return name;
      const clash = this.findByName(name);
      if (clash && clash.id !== id) return { error: `a project called "${clash.name}" already exists` };
      next.name = name;
    }
    if (patch.setup !== undefined) next.setup = [...patch.setup];
    if (patch.run !== undefined) next.run = patch.run;
    this.items.set(id, next);
    this.persist(next);
    return this.record(next);
  }

  remove(id: string): boolean {
    if (!this.items.has(id)) return false;
    this.items.delete(id);
    rmSync(join(this.root, id), { recursive: true, force: true });
    return true;
  }

  /** Records the outcome of a setup run with these commands. */
  markSetup(id: string, setup: string[], ok: boolean): void {
    const p = this.items.get(id);
    if (!p) return;
    const key = setupKey(setup, p.filesVersion);
    const next = { ...p, setupKey: ok && JSON.stringify(setup) === JSON.stringify(p.setup) ? key : ok ? p.setupKey : null };
    this.items.set(id, next);
    this.persist(next);
  }

  markRun(id: string, run: { taskId: string; ok: boolean; exitCode: number | null }): void {
    const p = this.items.get(id);
    if (!p) return;
    const next = { ...p, lastRun: { ...run, at: Date.now() } };
    this.items.set(id, next);
    this.persist(next);
  }
}
