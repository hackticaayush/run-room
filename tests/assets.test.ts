// Asset generator checks: manifest names exist in atlas JSON, frames lie inside their PNGs,
// character sheets are exactly 96x120, and the generator is idempotent.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CHARACTERS,
  CHROME,
  CURSORS,
  FX,
  MOODS,
  MOOD_FACES,
  PORTRAITS,
  PROPS,
  TILESET,
  UI_ICONS,
  DIGITS,
  BITMAP_FONTS,
  type AtlasInfo,
} from '../client/src/assets/manifest';
import { MOODS as SIM_MOODS } from '../shared/types';

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'client', 'public', 'assets');

function png(file: string): PNG {
  return PNG.sync.read(readFileSync(join(OUT, file)));
}

function generate(): string {
  return execFileSync(process.execPath, [join(ROOT, 'tools', 'assets', 'generate.mjs')], { encoding: 'utf8' });
}

describe('asset generator', () => {
  beforeAll(() => {
    generate();
  }, 60000);

  it('is idempotent: a second run rewrites nothing', () => {
    const out = generate();
    expect(out).toMatch(/ 0 written/);
  }, 60000);

  const atlases: [string, AtlasInfo][] = [
    ['props', PROPS],
    ['fx', FX],
    ['ui_icons', UI_ICONS],
    ['moods', MOODS],
  ];

  for (const [label, atlas] of atlases) {
    it(`${label}: every manifest frame exists in the atlas JSON and lies inside the PNG`, () => {
      const json = JSON.parse(readFileSync(join(OUT, atlas.json), 'utf8')) as {
        frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
        meta: { image: string; size: { w: number; h: number } };
      };
      const image = png(atlas.image);
      expect(json.meta.image).toBe(atlas.image);
      expect(json.meta.size).toEqual({ w: image.width, h: image.height });
      expect(atlas.width).toBe(image.width);
      expect(atlas.height).toBe(image.height);
      const names = Object.keys(atlas.frames);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const f = json.frames[name]?.frame;
        expect(f, `${label}:${name} missing from JSON`).toBeDefined();
        expect(f).toEqual(atlas.frames[name]);
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w).toBeLessThanOrEqual(image.width);
        expect(f.y + f.h).toBeLessThanOrEqual(image.height);
      }
      // And nothing in the JSON is missing from the manifest.
      expect(Object.keys(json.frames).sort()).toEqual(names.sort());
    });
  }

  it('contains every sprite the brief asks for', () => {
    const need = (atlas: AtlasInfo, names: string[]) => {
      for (const n of names) expect(atlas.frames[n], n).toBeDefined();
    };
    need(PROPS, [
      'desk_green', 'desk_red', 'desk_blue', 'desk_off', 'workstation_desk', 'chair', 'server_rack_0', 'server_rack_1',
      'monitor_wall_0', 'monitor_wall_1', 'coffee_machine', 'couch', 'plant', 'pizza_box', 'cat_0', 'cat_1', 'cat_sleep',
      'round_table', 'hologram_0', 'hologram_1', 'neon_sign_on', 'neon_sign_off', 'poster_skull', 'vending_machine',
      'filing_cabinet', 'lab_bench', 'mail_dropbox', 'mail_dropbox_full', 'task_inbox_tray', 'whiteboard', 'bug_0', 'bug_1',
      'robot_courier_0', 'robot_courier_1', 'window_rain_0', 'window_rain_1', 'cables', 'stacked_crates', 'energy_drink_cans',
    ]);
    need(FX, [
      'heart', 'z', 'exclaim', 'spark', 'packet_0', 'smoke_0', 'smoke_1', 'smoke_2', 'siren_0', 'siren_1', 'coin_xp',
      'confetti_0', 'confetti_1', 'confetti_2', 'confetti_3', 'matrix_0', 'matrix_1', 'matrix_2', 'matrix_3', 'file_sprite',
      'dust_puff_0', 'dust_puff_1',
    ]);
    need(UI_ICONS, [
      'play', 'pause', 'fast_forward', 'settings', 'upload_file', 'file_code', 'clipboard_task', 'terminal', 'coffee_cup',
      'bolt_energy', 'check_ok', 'cross_error', 'warning_siren', 'skull', 'heart_full', 'heart_empty', 'zzz', 'speaker_on',
      'speaker_off', 'monitor', 'folder', 'trash', 'copy', 'close_x', 'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down',
      'plus', 'minus', 'eye', 'crosshair_follow', 'lock', 'gear', 'star_xp', 'flag_done', 'clock', 'bug_icon', 'led_on',
      'led_off', 'led_warn', ...DIGITS,
    ]);
    for (const m of SIM_MOODS) expect(MOODS.frames[MOOD_FACES[m]], m).toBeDefined();
    // Brief sizes.
    expect(PROPS.frames.server_rack_0).toMatchObject({ w: 16, h: 32 });
    expect(PROPS.frames.monitor_wall_0).toMatchObject({ w: 48, h: 24 });
    expect(PROPS.frames.couch).toMatchObject({ w: 32, h: 16 });
    expect(PROPS.frames.round_table).toMatchObject({ w: 32, h: 32 });
    expect(PROPS.frames.neon_sign_on).toMatchObject({ w: 25, h: 11 });
    expect(PROPS.frames.vending_machine).toMatchObject({ w: 16, h: 32 });
    expect(PROPS.frames.filing_cabinet).toMatchObject({ w: 16, h: 24 });
    expect(PROPS.frames.lab_bench).toMatchObject({ w: 32, h: 16 });
    expect(PROPS.frames.mail_dropbox).toMatchObject({ w: 16, h: 16 });
    expect(PROPS.frames.window_rain_0).toMatchObject({ w: 16, h: 32 });
    expect(PROPS.frames.bug_0).toMatchObject({ w: 8, h: 8 });
    for (const name of ['heart', 'z', 'exclaim', 'spark', 'coin_xp', 'file_sprite']) {
      expect(FX.frames[name as keyof typeof FX.frames]).toMatchObject({ w: 8, h: 8 });
    }
    for (const name of Object.keys(UI_ICONS.frames).filter((n) => !n.startsWith('digit_'))) {
      expect(UI_ICONS.frames[name as keyof typeof UI_ICONS.frames]).toMatchObject({ w: 16, h: 16 });
    }
  });

  it('character sheets are exactly 96x120 with 16x24 frames', () => {
    const meta = JSON.parse(readFileSync(join(OUT, CHARACTERS.json), 'utf8')) as {
      frameWidth: number;
      frameHeight: number;
      columns: number;
      rows: number;
      animations: Record<string, { frames: number[] }>;
    };
    expect(meta.frameWidth).toBe(16);
    expect(meta.frameHeight).toBe(24);
    expect(meta.columns * meta.frameWidth).toBe(96);
    expect(meta.rows * meta.frameHeight).toBe(120);
    for (const file of Object.values(CHARACTERS.sheets)) {
      const sheet = png(file);
      expect([sheet.width, sheet.height]).toEqual([96, 120]);
    }
    for (const [name, anim] of Object.entries(meta.animations)) {
      for (const f of anim.frames) expect(f, name).toBeLessThan(meta.columns * meta.rows);
    }
  });

  it('tileset indices fit the 8 column sheet', () => {
    const sheet = png(TILESET.image);
    const count = Object.keys(TILESET.tiles).length;
    expect(TILESET.columns).toBe(8);
    expect(sheet.width).toBe(8 * 16);
    expect(sheet.height).toBe(Math.ceil(count / 8) * 16);
    for (const [name, index] of Object.entries(TILESET.tiles)) {
      expect(index, name).toBeLessThan(count);
    }
    for (const required of ['floor_a', 'floor_b', 'floor_neon', 'carpet', 'grate', 'checker', 'cable_h', 'cable_v', 'vent', 'server_floor', 'wall_top', 'wall_face', 'wall_neon_cyan', 'wall_neon_magenta', 'window_night', 'door']) {
      expect(TILESET.tiles[required as keyof typeof TILESET.tiles], required).toBeDefined();
    }
  });

  it('chrome, portraits, cursors and fonts exist with the documented sizes', () => {
    for (const [name, c] of Object.entries(CHROME)) {
      const image = png(c.image);
      expect([image.width, image.height], name).toEqual([c.width, c.height]);
      expect(c.slice.left * 2).toBeLessThan(c.width + 1);
    }
    for (const p of Object.values(PORTRAITS)) {
      const image = png(p.image);
      expect([image.width, image.height]).toEqual([32, 32]);
    }
    for (const c of Object.values(CURSORS)) {
      const image = png(c.image);
      expect([image.width, image.height]).toEqual([c.width, c.height]);
    }
    for (const f of Object.values(BITMAP_FONTS)) {
      expect(existsSync(join(OUT, f.image))).toBe(true);
      expect(readFileSync(join(OUT, f.xml), 'utf8')).toContain(`face="${f.key}"`);
    }
  });
});
