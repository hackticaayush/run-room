// HTTP helpers. Code goes to POST /api/upload/file (one .py file) or /api/upload/folder (a whole
// project). The returned opaque upload id is what SUBMIT_TASK and SAVE_PROJECT send.

import { MAX_FILE_BYTES, MAX_PER_FILE_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, PYTHON_EXTENSIONS } from '@shared/constants';
import { formatBytes } from '@shared/display';
import { commonRoot, isPythonFile, isSkippedPath, normalizeRelPath, venvDirs } from '@shared/projectFiles';
import type { CodeKind } from '@shared/types';
import { adminToken } from './access';

/** What the server tells us about stored code. */
export interface UploadSummary {
  id: string;
  kind: CodeKind;
  name: string;
  fileCount: number;
  totalBytes: number;
  entry: string | null;
  pyFiles: string[];
  requirements: string | null;
  skipped: number;
}

/** Client side mirror of the server rules for one file, for instant feedback. */
export function checkPythonFile(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!(PYTHON_EXTENSIONS as readonly string[]).includes(ext)) {
    return `"${file.name}" is not a Python file. Pick a .py file, or use PROJECT FOLDER for a whole project.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_FILE_BYTES) return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`;
  return null;
}

/** The files of a picked folder that will be uploaded. */
export interface FolderSelection {
  name: string;
  /** Upload path (with the folder name, as the browser gave it) and the file. */
  files: { path: string; rel: string; file: File }[];
  skipped: number;
  totalBytes: number;
  pyCount: number;
  error: string | null;
}

/** Applies the shared rules: unsafe names refused, caches and virtual environments left out. */
export function selectFolder(list: FileList | File[]): FolderSelection {
  const all = [...list].map((f) => ({ raw: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
  const empty: FolderSelection = { name: '', files: [], skipped: 0, totalBytes: 0, pyCount: 0, error: null };
  if (all.length === 0) return { ...empty, error: 'the folder is empty' };
  const norm: { path: string; file: File }[] = [];
  for (const x of all) {
    const p = normalizeRelPath(x.raw);
    if (!p) return { ...empty, error: `a file name cannot be used: ${x.raw.slice(0, 80)}` };
    norm.push({ path: p, file: x.file });
  }
  const root = commonRoot(norm.map((x) => x.path));
  const withRel = norm.map((x) => ({ ...x, rel: root ? x.path.slice(root.length + 1) : x.path }));
  const venvs = venvDirs(withRel.map((x) => x.rel));
  const files = withRel.filter((x) => !isSkippedPath(x.rel, venvs));
  const totalBytes = files.reduce((n, x) => n + x.file.size, 0);
  const sel: FolderSelection = {
    name: root ?? 'project',
    files,
    skipped: all.length - files.length,
    totalBytes,
    pyCount: files.filter((x) => isPythonFile(x.rel)).length,
    error: null,
  };
  if (sel.pyCount === 0) sel.error = 'no .py file in this folder: only Python projects can run';
  else if (files.length > MAX_PROJECT_FILES) sel.error = `the folder has ${files.length} files, the limit is ${MAX_PROJECT_FILES}`;
  else if (totalBytes > MAX_PROJECT_BYTES) sel.error = `the folder is ${formatBytes(totalBytes)}, the limit is ${formatBytes(MAX_PROJECT_BYTES)}`;
  else {
    const big = files.find((x) => x.file.size > MAX_PER_FILE_BYTES);
    if (big) sel.error = `${big.rel} is larger than ${formatBytes(MAX_PER_FILE_BYTES)}`;
  }
  return sel;
}

/** POST with upload progress (0..1). */
function post(url: string, form: FormData, onProgress?: (p: number) => void): Promise<UploadSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    const token = adminToken();
    if (token) xhr.setRequestHeader('X-RunRoom-Token', token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as Partial<UploadSummary> & { error?: string };
      if (xhr.status === 200 && body.id) resolve(body as UploadSummary);
      else reject(new Error(body.error ?? `upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('upload failed: the server is not reachable'));
    xhr.send(form);
  });
}

export function uploadFile(file: File, onProgress?: (p: number) => void): Promise<UploadSummary> {
  const form = new FormData();
  form.append('file', file, file.name);
  return post('/api/upload/file', form, onProgress);
}

/** A whole project as one .zip (phones cannot pick folders). */
export function checkZipFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.zip')) return `"${file.name}" is not a .zip file.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_PROJECT_BYTES) return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_PROJECT_BYTES)}.`;
  return null;
}

export function uploadZip(file: File, onProgress?: (p: number) => void): Promise<UploadSummary> {
  const form = new FormData();
  form.append('file', file, file.name);
  return post('/api/upload/zip', form, onProgress);
}

export function uploadFolder(sel: FolderSelection, onProgress?: (p: number) => void): Promise<UploadSummary> {
  const form = new FormData();
  form.append('manifest', JSON.stringify(sel.files.map((x) => x.path)));
  for (const x of sel.files) form.append('files', x.file, x.file.name);
  return post('/api/upload/folder', form, onProgress);
}
