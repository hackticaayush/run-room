// Text that comes from a user's program (output lines, input prompts, function names, values) is
// shown in the HUD, which follows the project rules: no emoji, no symbol icons, bitmap fonts only.
// sanitizeDisplay() strips terminal color codes, keeps what a carriage return progress line shows
// last, turns control characters into "?" and replaces emoji and symbols with a plain [U+XXXX].

/** Same ranges as scripts/check-no-emoji.mjs, plus flag tags and supplementary private use. */
const FORBIDDEN: readonly [number, number][] = [
  [0x1f000, 0x1faff],
  [0x2600, 0x27bf],
  [0x2b00, 0x2bff],
  [0x2190, 0x21ff],
  [0x2300, 0x23ff],
  [0x25a0, 0x25ff],
  [0xfe0e, 0xfe0f],
  [0x200d, 0x200d],
  [0x20e3, 0x20e3],
  [0x2022, 0x2023],
  [0x2043, 0x2043],
  [0x2500, 0x259f],
  [0x27f0, 0x27ff],
  [0x2900, 0x297f],
  [0x1fb00, 0x1fbff],
  [0xe000, 0xf8ff],
  [0xe0000, 0xe007f],
  [0xf0000, 0x10ffff],
];

function forbidden(cp: number): boolean {
  for (const [lo, hi] of FORBIDDEN) if (cp >= lo && cp <= hi) return true;
  return false;
}

// CSI sequences (colors, cursor moves), OSC sequences (titles, links) and two byte escapes.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export function sanitizeDisplay(text: string, max = 2000): string {
  let s = String(text).replace(ANSI, '');
  if (s.includes('\r')) {
    const parts = s.split('\r').filter((x) => x.length > 0);
    s = parts.length ? parts[parts.length - 1] : '';
  }
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp === 9) out += '  ';
    else if (cp < 32 || cp === 127) out += '?';
    else if (forbidden(cp)) out += `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`;
    else out += ch;
    if (out.length >= max) return out.slice(0, max);
  }
  return out;
}

/** 512 -> "512 bytes", 1536 -> "1.5 KB", 1073741824 -> "1 GB". */
export function formatBytes(n: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} bytes`;
  return `${Number.isInteger(v) || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Shortens with "..." when longer than max characters. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}
