import { describe, expect, it } from 'vitest';
import { scanText, scanPackageJson, run, DEFAULT_TARGETS } from '../scripts/check-no-emoji.mjs';

// Forbidden import lines are assembled at runtime so this file never contains one literally.
const Q = "'";
const fromImport = (mod: string) => ['import { X } from ', Q, mod, Q, ';'].join('');
const sideImport = (mod: string) => ['import ', Q, mod, Q, ';'].join('');
const requireCall = (mod: string) => ['const x = require(', Q, mod, Q, ');'].join('');
const dynamicImport = (mod: string) => ['const y = await import(', Q, mod, Q, ');'].join('');

describe('check-no-emoji', () => {
  it('accepts plain ASCII text', () => {
    expect(scanText('const ok = "OK -> RUN"; // ERR words only\n')).toEqual([]);
  });

  it('flags emoji, symbol icons and private use glyphs', () => {
    const codes = [0x1f600, 0x2713, 0x25b6, 0x2192, 0x2550, 0xe001, 0xfe0f, 0x2022];
    const text = codes.map((c) => String.fromCodePoint(c)).join(' ');
    expect(scanText(text).length).toBe(codes.length);
  });

  it('flags icon library imports but not prose mentions', () => {
    const bad = [
      fromImport('lucide-react'),
      requireCall('react-icons/fa'),
      sideImport('@fortawesome/fontawesome-free/css/all.css'),
      dynamicImport('@tabler/icons-react'),
      fromImport('@mui/icons-material'),
      fromImport('@heroicons/react/24/solid'),
    ];
    for (const line of bad) expect(scanText(line).length).toBe(1);
    expect(scanText('We never use lucide or react-icons in this project.')).toEqual([]);
  });

  it('flags icon packages in package.json', () => {
    const pkg = JSON.stringify({ dependencies: { 'react-icons': '^5.0.0', react: '^19.0.0' } });
    expect(scanPackageJson(pkg).length).toBe(1);
  });

  it('passes on the whole repository', () => {
    const lines: string[] = [];
    const { failures } = run(DEFAULT_TARGETS, (m: string) => lines.push(m));
    expect(lines).toEqual([]);
    expect(failures).toBe(0);
  });
});
