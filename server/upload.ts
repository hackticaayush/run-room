// Code uploads for the RUN PYTHON box. Rules:
//   - a single file: .py or .pyw, at most 1 GB, text only (no NUL bytes); the name is sanitized
//   - a project folder: at most 2000 files and 1 GB (1 GB per file), at least one .py file;
//     every relative path is checked (no "..", no absolute paths, no odd names), caches, version
//     control folders and virtual environments are skipped
//   - uploads stream to server/uploads/.incoming on disk (never held in memory), then each upload
//     is moved into its own folder server/uploads/<id>/files and is NEVER served back
//   - a project can also come as one .zip (phones cannot pick folders): it is unpacked with the
//     same rules, entry sizes are checked while unpacking (zip bombs), "../" and absolute names,
//     symlinks and encrypted entries are refused
//   - runs refer to uploads only through the opaque upload id issued here

import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import {
  MAX_FILE_BYTES,
  MAX_PER_FILE_BYTES,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  PYTHON_EXTENSIONS,
} from '../shared/constants';
import { formatBytes } from '../shared/display';
import { UPLOAD_ID_RE } from '../shared/events';
import { commonRoot, findRequirements, guessEntry, isPythonFile, isSkippedPath, normalizeRelPath, venvDirs } from '../shared/projectFiles';
import type { CodeKind } from '../shared/types';

/** Keeps a safe file name: no paths, no control characters, ASCII word characters only. */
export function sanitizeFilename(name: string): string {
  const base = basename(String(name).replace(/\\/g, '/')).trim();
  let ext = extname(base).toLowerCase();
  let stem = base.slice(0, base.length - ext.length);
  // A bare dotfile such as ".py" is an unnamed file of that type.
  if (!ext && base.startsWith('.') && !base.slice(1).includes('.')) {
    ext = base.toLowerCase();
    stem = '';
  }
  stem = stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(0, 60);
  if (!stem) stem = 'upload';
  const safeExt = ext.replace(/[^a-z0-9.]/g, '');
  return `${stem}${safeExt}`;
}

export interface FileCheck {
  ok: boolean;
  error?: string;
  filename?: string;
}

/** Validates a single Python file upload (pure, unit tested). */
export function validateSingleFile(originalName: string, size: number, content?: Buffer): FileCheck {
  if (!originalName) return { ok: false, error: 'missing file name' };
  const filename = sanitizeFilename(originalName);
  const ext = extname(filename).toLowerCase();
  if (!(PYTHON_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `only Python files can run (${PYTHON_EXTENSIONS.join(' ')}); for a whole project pick the folder` };
  }
  if (size <= 0) return { ok: false, error: 'the file is empty' };
  if (size > MAX_FILE_BYTES) return { ok: false, error: `the file is ${formatBytes(size)}, the limit is ${formatBytes(MAX_FILE_BYTES)}` };
  if (content) {
    const n = Math.min(content.length, 64 * 1024);
    for (let i = 0; i < n; i++) if (content[i] === 0) return { ok: false, error: 'this is not a text file' };
  }
  return { ok: true, filename };
}

export interface FolderPlan {
  /** Folder name shown in the HUD. */
  name: string;
  /** Kept files: path relative to the project root and the index of the uploaded part. */
  files: { rel: string; index: number; size: number }[];
  skipped: number;
  totalBytes: number;
  entry: string | null;
  pyFiles: string[];
  requirements: string | null;
}

/**
 * Validates a folder upload from its manifest (browser relative paths, in upload order) and the
 * part sizes. Pure, unit tested. The selected folder's own name is stripped from the paths.
 */
export function planFolder(paths: string[], sizes: number[], fallbackName = 'project'): FolderPlan | { error: string } {
  if (paths.length === 0) return { error: 'the folder is empty' };
  if (paths.length !== sizes.length) return { error: 'the upload is incomplete, try again' };
  const norm: string[] = [];
  for (const p of paths) {
    const n = normalizeRelPath(p);
    if (!n) return { error: `unsafe path in the folder: ${String(p).slice(0, 80)}` };
    norm.push(n);
  }
  // macOS adds a __MACOSX folder next to the real one in zips: it must not hide the real root.
  const root = commonRoot(norm.filter((p) => !p.startsWith('__MACOSX/')));
  const rel = root ? norm.map((p) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)) : norm;
  const venvs = venvDirs(rel);
  const files: FolderPlan['files'] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let totalBytes = 0;
  for (let i = 0; i < rel.length; i++) {
    if (isSkippedPath(rel[i], venvs)) {
      skipped++;
      continue;
    }
    const key = rel[i].toLowerCase();
    if (seen.has(key)) return { error: `two files would get the same name: ${rel[i].slice(0, 80)}` };
    seen.add(key);
    if (sizes[i] > MAX_PER_FILE_BYTES) return { error: `${rel[i].slice(0, 80)} is larger than ${formatBytes(MAX_PER_FILE_BYTES)}` };
    totalBytes += sizes[i];
    files.push({ rel: rel[i], index: i, size: sizes[i] });
  }
  if (files.length > MAX_PROJECT_FILES) return { error: `the folder has ${files.length} files, the limit is ${MAX_PROJECT_FILES}` };
  if (totalBytes > MAX_PROJECT_BYTES) return { error: `the folder is ${formatBytes(totalBytes)}, the limit is ${formatBytes(MAX_PROJECT_BYTES)}` };
  const keptPaths = files.map((f) => f.rel);
  const pyFiles = keptPaths.filter(isPythonFile).sort();
  if (pyFiles.length === 0) return { error: 'no .py file in this folder: only Python projects can run' };
  return {
    name: (root ?? fallbackName).slice(0, 60),
    files,
    skipped,
    totalBytes,
    entry: guessEntry(keptPaths),
    pyFiles: pyFiles.slice(0, 300),
    requirements: findRequirements(keptPaths),
  };
}

export interface StoredCode {
  id: string;
  kind: CodeKind;
  /** File name or folder name. */
  name: string;
  /** server/uploads/<id> */
  dir: string;
  /** The code itself (the program's working directory). */
  filesDir: string;
  /** Virtual environment of this upload (created by its first setup). */
  venvDir: string;
  fileCount: number;
  totalBytes: number;
  entry: string | null;
  pyFiles: string[];
  requirements: string | null;
  skipped: number;
  createdAt: number;
}

/** What the browser gets back after an upload. */
export type UploadSummary = Pick<StoredCode, 'id' | 'kind' | 'name' | 'fileCount' | 'totalBytes' | 'entry' | 'pyFiles' | 'requirements' | 'skipped'>;

export function summaryOf(c: StoredCode): UploadSummary {
  const { id, kind, name, fileCount, totalBytes, entry, pyFiles, requirements, skipped } = c;
  return { id, kind, name, fileCount, totalBytes, entry, pyFiles, requirements, skipped };
}

const MAX_ZIP_ENTRIES = MAX_PROJECT_FILES * 10;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Reads the zip's table of contents (nothing is unpacked yet). */
async function listZip(path: string): Promise<{ zip: ZipFile; entries: Entry[] }> {
  // decodeStrings makes yauzl refuse absolute and "../" names; validateEntrySizes makes it check
  // every unpacked size against the table of contents (a lying zip bomb fails while unpacking).
  const zip = await openPromise(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  const entries: Entry[] = [];
  try {
    await new Promise<void>((resolveList, reject) => {
      zip.on('entry', (e: Entry) => {
        entries.push(e);
        if (entries.length > MAX_ZIP_ENTRIES) reject(new Error(`more than ${MAX_ZIP_ENTRIES} entries`));
        else zip.readEntry();
      });
      zip.on('end', () => resolveList());
      zip.on('error', reject);
      zip.readEntry();
    });
  } catch (err) {
    zip.close();
    throw err;
  }
  return { zip, entries };
}

function zipProblem(err: unknown): string {
  const msg = (err as Error).message || String(err);
  if (/invalid relative path|absolute path|invalid characters/i.test(msg)) return `unsafe path in the zip (${msg.slice(0, 80)})`;
  if (/end of central directory|not a zip|invalid comment length|signature/i.test(msg)) return 'this is not a valid .zip file';
  return `could not read the zip: ${msg.slice(0, 120)}`;
}

const MAX_KEEP = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INCOMING_MAX_AGE_MS = 60 * 60 * 1000;

/** File content: in memory (tests, small files) or already on disk in the incoming folder. */
export type UploadPart = Buffer | { path: string; size: number };

const partSize = (p: UploadPart) => (Buffer.isBuffer(p) ? p.length : p.size);

/** The first bytes of a part (enough to tell text from binary). */
function headOf(p: UploadPart, n = 64 * 1024): Buffer {
  if (Buffer.isBuffer(p)) return p.subarray(0, n);
  const buf = Buffer.alloc(Math.min(n, p.size));
  const fd = openSync(p.path, 'r');
  try {
    const read = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Writes (or moves) a part to its final place. */
function place(p: UploadPart, target: string): void {
  if (Buffer.isBuffer(p)) {
    writeFileSync(target, p, { mode: 0o600 });
    return;
  }
  try {
    renameSync(p.path, target);
  } catch {
    copyFileSync(p.path, target);
    unlinkSync(p.path);
  }
}

/** Registry of uploaded code: upload id -> folder inside the uploads directory. */
export class UploadStore {
  private readonly items = new Map<string, StoredCode>();
  readonly dir: string;
  /** Where uploads stream to before they are checked (the HTTP layer writes here). */
  readonly incomingDir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    this.incomingDir = join(this.dir, '.incoming');
    mkdirSync(this.incomingDir, { recursive: true, mode: 0o700 });
    this.sweep(true);
  }

  /** Removes incoming files that were not moved into an upload (refused or failed uploads). */
  discard(parts: UploadPart[]): void {
    for (const p of parts) {
      if (Buffer.isBuffer(p)) continue;
      try {
        unlinkSync(p.path);
      } catch {
        // Already moved or gone.
      }
    }
  }

  private newRecord(kind: CodeKind, name: string): StoredCode {
    const id = `up_${randomBytes(8).toString('hex')}`;
    const dir = join(this.dir, id);
    const filesDir = join(dir, 'files');
    mkdirSync(filesDir, { recursive: true, mode: 0o700 });
    return {
      id,
      kind,
      name,
      dir,
      filesDir,
      venvDir: join(dir, 'venv'),
      fileCount: 0,
      totalBytes: 0,
      entry: null,
      pyFiles: [],
      requirements: null,
      skipped: 0,
      createdAt: Date.now(),
    };
  }

  /** Validates and stores a single Python file. */
  saveFile(originalName: string, content: UploadPart): StoredCode | { error: string } {
    const size = partSize(content);
    const check = validateSingleFile(originalName, size, headOf(content));
    if (!check.ok) return { error: check.error! };
    const rec = this.newRecord('file', check.filename!);
    try {
      place(content, join(rec.filesDir, check.filename!));
    } catch (err) {
      rmSync(rec.dir, { recursive: true, force: true });
      return { error: `could not store the file: ${(err as Error).message}` };
    }
    Object.assign(rec, { fileCount: 1, totalBytes: size, entry: check.filename!, pyFiles: [check.filename!] });
    this.items.set(rec.id, rec);
    this.sweep(false);
    return rec;
  }

  /** Validates and stores a project folder (parts in the same order as the manifest paths). */
  saveFolder(paths: string[], parts: UploadPart[]): StoredCode | { error: string } {
    const plan = planFolder(paths, parts.map(partSize));
    if ('error' in plan) return plan;
    const rec = this.newRecord('folder', plan.name);
    const root = resolve(rec.filesDir);
    try {
      for (const f of plan.files) {
        const target = resolve(root, ...f.rel.split('/'));
        if (!target.startsWith(root + sep)) throw new Error(`unsafe path ${f.rel}`);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        place(parts[f.index], target);
      }
    } catch (err) {
      rmSync(rec.dir, { recursive: true, force: true });
      return { error: `could not store the folder: ${(err as Error).message}` };
    }
    Object.assign(rec, {
      fileCount: plan.files.length,
      totalBytes: plan.totalBytes,
      entry: plan.entry,
      pyFiles: plan.pyFiles,
      requirements: plan.requirements,
      skipped: plan.skipped,
    });
    this.items.set(rec.id, rec);
    this.sweep(false);
    return rec;
  }

  /** Unpacks a project .zip (already on disk) with the folder rules. The zip itself is not kept. */
  async saveZip(originalName: string, part: { path: string; size: number }): Promise<StoredCode | { error: string }> {
    const zipName = sanitizeFilename(originalName);
    if (extname(zipName).toLowerCase() !== '.zip') return { error: 'pick a .zip file of the project' };
    if (part.size > MAX_PROJECT_BYTES) return { error: `the zip is ${formatBytes(part.size)}, the limit is ${formatBytes(MAX_PROJECT_BYTES)}` };
    let listing: { zip: ZipFile; entries: Entry[] };
    try {
      listing = await listZip(part.path);
    } catch (err) {
      return { error: zipProblem(err) };
    }
    const { zip, entries } = listing;
    try {
      const files = entries.filter((e) => !e.fileName.endsWith('/'));
      if (files.some((e) => ((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK)) return { error: 'the zip contains symbolic links, which are not supported' };
      if (files.some((e) => e.isEncrypted())) return { error: 'password protected zips are not supported' };
      const plan = planFolder(
        files.map((e) => e.fileName),
        files.map((e) => e.uncompressedSize),
        zipName.slice(0, -4) || 'project',
      );
      if ('error' in plan) return plan;
      const rec = this.newRecord('folder', plan.name);
      const root = resolve(rec.filesDir);
      try {
        for (const f of plan.files) {
          const target = resolve(root, ...f.rel.split('/'));
          if (!target.startsWith(root + sep)) throw new Error(`unsafe path ${f.rel}`);
          mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
          const stream = await zip.openReadStreamPromise(files[f.index]);
          await pipeline(stream, createWriteStream(target, { mode: 0o600 }));
        }
      } catch (err) {
        rmSync(rec.dir, { recursive: true, force: true });
        return { error: zipProblem(err) };
      }
      Object.assign(rec, {
        fileCount: plan.files.length,
        totalBytes: plan.totalBytes,
        entry: plan.entry,
        pyFiles: plan.pyFiles,
        requirements: plan.requirements,
        skipped: plan.skipped,
      });
      this.items.set(rec.id, rec);
      this.sweep(false);
      return rec;
    } finally {
      zip.close();
    }
  }

  /** Resolves an upload id. Anything that is not a known id (paths, traversal) returns null. */
  resolve(id: string): StoredCode | null {
    if (!UPLOAD_ID_RE.test(id)) return null;
    const rec = this.items.get(id);
    if (!rec || !existsSync(rec.filesDir)) return null;
    return rec;
  }

  /** Deletes stale uploads (older than a day or beyond the newest 100). */
  sweep(includeUnknown: boolean): void {
    const now = Date.now();
    const known = [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt);
    known.forEach((rec, i) => {
      if (i >= MAX_KEEP || now - rec.createdAt > MAX_AGE_MS) {
        this.items.delete(rec.id);
        rmSync(rec.dir, { recursive: true, force: true });
      }
    });
    if (!includeUnknown) return;
    for (const name of readdirSync(this.incomingDir)) {
      const p = join(this.incomingDir, name);
      try {
        if (now - statSync(p).mtimeMs > INCOMING_MAX_AGE_MS) rmSync(p, { force: true });
      } catch {
        // Ignore races with uploads in progress.
      }
    }
    for (const name of readdirSync(this.dir)) {
      if (!name.startsWith('up_')) continue;
      const p = join(this.dir, name);
      try {
        if (now - statSync(p).mtimeMs > MAX_AGE_MS) rmSync(p, { recursive: true, force: true });
      } catch {
        // Ignore races with other processes.
      }
    }
  }
}
