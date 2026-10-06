// Which files of an uploaded project folder are kept, and which file is the likely entry point.
// Shared by the browser (so virtual environments and caches are never uploaded) and the server
// (which checks every path again before writing anything).

/** Directories that are never uploaded, wherever they are. */
export const ALWAYS_SKIPPED_DIRS = [
  '__pycache__',
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.idea',
  '.ipynb_checkpoints',
  '.eggs',
  '__MACOSX',
];
const SKIPPED_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
const SKIPPED_EXT = ['.pyc', '.pyo'];

/**
 * Normalizes a relative path coming from the browser ("proj\\src/a.py" -> "proj/src/a.py").
 * Returns null for anything unsafe: absolute paths, drive letters, "..", empty or odd segments,
 * characters Windows cannot store and reserved device names.
 */
export function normalizeRelPath(p: string): string | null {
  const s = String(p).replace(/\\/g, '/');
  if (!s || s.length > 400) return null;
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null;
  const segs = s.split('/');
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..') return null;
    if (seg.length > 120) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f<>:"|?*]/.test(seg)) return null;
    if (/[ .]$/.test(seg)) return null;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(seg)) return null;
  }
  return segs.join('/');
}

/** Folders that hold a virtual environment (they contain pyvenv.cfg). "" = the root itself. */
export function venvDirs(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (p === 'pyvenv.cfg') out.add('');
    else if (p.endsWith('/pyvenv.cfg')) out.add(p.slice(0, -'/pyvenv.cfg'.length));
  }
  return out;
}

/** True for caches, VCS folders, virtual environments and compiled files. */
export function isSkippedPath(path: string, venvs: ReadonlySet<string>): boolean {
  if (venvs.has('')) return true;
  const segs = path.split('/');
  const name = segs[segs.length - 1];
  if (SKIPPED_FILES.includes(name)) return true;
  const lower = name.toLowerCase();
  if (SKIPPED_EXT.some((e) => lower.endsWith(e))) return true;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (ALWAYS_SKIPPED_DIRS.includes(seg) || seg.endsWith('.egg-info')) return true;
    if (venvs.has(segs.slice(0, i + 1).join('/'))) return true;
  }
  return false;
}

/** The first folder shared by every path ("proj/a.py", "proj/b/c.py" -> "proj"), or null. */
export function commonRoot(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const first = paths[0].split('/')[0];
  if (!first || paths.some((p) => !p.includes('/') || p.split('/')[0] !== first)) return null;
  return first;
}

export const isPythonFile = (p: string): boolean => /\.pyw?$/i.test(p);

/** The likely entry file: main.py, app.py, run.py ... at the top level first. */
export function guessEntry(paths: readonly string[]): string | null {
  const py = paths.filter(isPythonFile);
  const top = py.filter((p) => !p.includes('/'));
  for (const name of ['main.py', 'app.py', 'run.py', '__main__.py', 'cli.py', 'start.py', 'game.py']) {
    if (top.includes(name)) return name;
  }
  if (top.length) return [...top].sort()[0];
  for (const name of ['main.py', '__main__.py', 'app.py']) {
    const hit = [...py].sort().find((p) => p.endsWith(`/${name}`));
    if (hit) return hit;
  }
  return [...py].sort()[0] ?? null;
}

/** A requirements file at the top level, if any. */
export function findRequirements(paths: readonly string[]): string | null {
  for (const name of ['requirements.txt', 'requirements-dev.txt', 'requirements.in']) if (paths.includes(name)) return name;
  return null;
}
