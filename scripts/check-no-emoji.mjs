#!/usr/bin/env node
// RUN ROOM hard-rule checker.
// Fails (exit code 1) when a scanned source file contains:
//   - emoji, pictographs or symbol icons (ranges below, written with \u{...} escapes only),
//   - any other non-ASCII character (all project sources are kept plain ASCII),
//   - imports of icon libraries or icon fonts,
//   - icon library packages in package.json.
// Usage: node scripts/check-no-emoji.mjs [paths...]

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Paths required by the brief, plus tests, samples, art overrides, the GitHub facing files (docs,
// .github, .env.example, .gitignore) and root config files. Missing paths are skipped.
export const DEFAULT_TARGETS = [
  'client/src',
  'client/index.html',
  'client/vite.config.ts',
  'server',
  'shared',
  'scripts',
  'tools',
  'tests',
  'samples',
  'art',
  'docs',
  '.github',
  'README.md',
  'CLAUDE.md',
  '.env.example',
  '.gitignore',
  'package.json',
  'eslint.config.js',
  'vitest.config.ts',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'uploads', '.vite', 'coverage']);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.cur',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.7z', '.rar', '.pdf',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.pyc',
]);

// Forbidden code point ranges. Written as \u{...} escapes so this file stays plain ASCII.
const RANGES = [
  ['\u{1F000}', '\u{1FAFF}', 'emoji or pictograph'],
  ['\u{2600}', '\u{27BF}', 'misc symbol or dingbat'],
  ['\u{2B00}', '\u{2BFF}', 'misc symbol or arrow'],
  ['\u{2190}', '\u{21FF}', 'arrow symbol'],
  ['\u{2300}', '\u{23FF}', 'technical symbol'],
  ['\u{25A0}', '\u{25FF}', 'geometric shape'],
  ['\u{FE0F}', '\u{FE0F}', 'emoji variation selector'],
  // Extra guards in the spirit of the rules (no symbol icons, no icon fonts).
  ['\u{FE0E}', '\u{FE0E}', 'text variation selector'],
  ['\u{200D}', '\u{200D}', 'zero width joiner'],
  ['\u{20E3}', '\u{20E3}', 'keycap combining mark'],
  ['\u{2022}', '\u{2023}', 'bullet'],
  ['\u{2043}', '\u{2043}', 'bullet'],
  ['\u{2500}', '\u{257F}', 'box drawing'],
  ['\u{2580}', '\u{259F}', 'block element'],
  ['\u{27F0}', '\u{27FF}', 'arrow symbol'],
  ['\u{2900}', '\u{297F}', 'arrow symbol'],
  ['\u{1FB00}', '\u{1FBFF}', 'legacy computing symbol'],
  ['\u{E000}', '\u{F8FF}', 'private use glyph (icon font)'],
].map(([lo, hi, label]) => ({ lo: lo.codePointAt(0), hi: hi.codePointAt(0), label }));

// Icon libraries and icon fonts that must never be imported or installed.
const FORBIDDEN_MODULES = [
  'lucide',
  '@fortawesome',
  'fortawesome',
  'font-awesome',
  'react-icons',
  '@mui/icons',
  'heroicons',
  '@heroicons',
  '@tabler',
  'material-icons',
  'material-symbols',
  '@iconify',
  'emoji-mart',
  '@emoji-mart',
  'emoji-picker',
  'bootstrap-icons',
  'ionicons',
  'feather-icons',
  'remixicon',
  '@phosphor-icons',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const MODULE_ALT = FORBIDDEN_MODULES.map(escapeRe).join('|');
const QUOTE = '[\'"\\x60]';
const IMPORT_PATTERNS = [
  new RegExp('\\bfrom\\s*' + QUOTE + '\\s*(?:' + MODULE_ALT + ')', 'i'),
  new RegExp('\\bimport\\s*' + QUOTE + '\\s*(?:' + MODULE_ALT + ')', 'i'),
  new RegExp('\\bimport\\s*\\(\\s*' + QUOTE + '\\s*(?:' + MODULE_ALT + ')', 'i'),
  new RegExp('\\brequire\\s*\\(\\s*' + QUOTE + '\\s*(?:' + MODULE_ALT + ')', 'i'),
  new RegExp('@import\\s+(?:url\\()?\\s*' + QUOTE + '?\\s*(?:' + MODULE_ALT + ')', 'i'),
];

function classify(cp) {
  for (const r of RANGES) {
    if (cp >= r.lo && cp <= r.hi) return r.label;
  }
  if (cp > 0x7e) return 'non-ASCII character';
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return 'control character';
  return null;
}

function hex(cp) {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

function isBinary(file, buf) {
  if (BINARY_EXT.has(extname(file).toLowerCase())) return true;
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function walk(target, out) {
  if (!existsSync(target)) return;
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (SKIP_DIRS.has(name)) continue;
      walk(join(target, name), out);
    }
  } else if (st.isFile()) {
    out.push(target);
  }
}

/** Returns a list of { line, col, message } problems found in a text. */
export function scanText(text) {
  const problems = [];
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let col = 0;
    for (const ch of line) {
      col++;
      const cp = ch.codePointAt(0);
      if (cp === 0x0d) continue;
      const label = classify(cp);
      if (label) problems.push({ line: li + 1, col, message: `${label} ${hex(cp)}` });
    }
    for (const re of IMPORT_PATTERNS) {
      if (re.test(line)) {
        problems.push({ line: li + 1, col: 1, message: 'import of a forbidden icon library' });
        break;
      }
    }
  }
  return problems;
}

/** Flags icon packages listed as dependencies. */
export function scanPackageJson(text) {
  const problems = [];
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return problems;
  }
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const s of sections) {
    for (const dep of Object.keys(pkg[s] || {})) {
      const lower = dep.toLowerCase();
      if (FORBIDDEN_MODULES.some((m) => lower === m || lower.startsWith(m))) {
        problems.push({ line: 1, col: 1, message: `forbidden icon package "${dep}" in ${s}` });
      }
    }
  }
  return problems;
}

/** Scans the given targets (paths relative to the repo root or absolute). */
export function run(targets, log = console.error) {
  const files = [];
  for (const t of targets) walk(resolve(ROOT, t), files);
  let failures = 0;
  let scanned = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    if (isBinary(file, buf)) continue;
    scanned++;
    const text = buf.toString('utf8');
    const problems = scanText(text);
    if (file.endsWith('package.json')) problems.push(...scanPackageJson(text));
    for (const p of problems) {
      failures++;
      log(`${relative(ROOT, file)}:${p.line}:${p.col}  ${p.message}`);
    }
  }
  return { failures, scanned };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const extra = process.argv.slice(2);
  const { failures, scanned } = run(extra.length ? extra : DEFAULT_TARGETS);
  if (failures > 0) {
    console.error(`check-no-emoji: FAIL - ${failures} problem(s) in ${scanned} scanned file(s).`);
    process.exit(1);
  }
  console.log(`check-no-emoji: OK - ${scanned} file(s) scanned, no emoji, symbols or icon libraries.`);
}
