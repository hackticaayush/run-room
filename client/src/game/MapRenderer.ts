// Bakes the static tile map (floors, walls, shadows) into a RenderTexture, plus a second one
// holding only the light emitting tile pixels (neon tubes, lit windows) for night time.

import type Phaser from 'phaser';
import { MAP_H, MAP_W, resolveTiles, buildCollisionGrid, STATIONS, STATION_IDS } from '@shared/officeLayout';
import { TILE } from '@shared/constants';
import { EMISSIVE, TILESET, type TileName } from '../assets/manifest';
import { TEX } from './BootScene';
import { DEPTH } from './PropRenderer';

export interface MapLayers {
  base: Phaser.GameObjects.RenderTexture;
  emissive: Phaser.GameObjects.RenderTexture;
}

export function buildMap(scene: Phaser.Scene): MapLayers {
  const base = scene.add.renderTexture(0, 0, MAP_W * TILE, MAP_H * TILE).setOrigin(0, 0).setDepth(0);
  const emissive = scene.add.renderTexture(0, 0, MAP_W * TILE, MAP_H * TILE).setOrigin(0, 0).setDepth(1);
  const glowing = new Set<string>(EMISSIVE.tileset.tiles);
  const grid = resolveTiles();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      for (const name of grid[y][x].layers) {
        const index = TILESET.tiles[name as TileName];
        if (index === undefined) throw new Error(`tile ${name} missing from tileset`);
        base.drawFrame(TEX.tiles, index, x * TILE, y * TILE);
        if (glowing.has(name)) emissive.drawFrame(TEX.tilesEmissive, index, x * TILE, y * TILE);
      }
    }
  }
  return { base, emissive };
}

/** Collision grid and station markers (settings: show grid / debug). */
export function buildDebugOverlay(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(DEPTH.debug);
  const g = scene.add.graphics();
  const grid = buildCollisionGrid();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y][x]) {
        g.fillStyle(0xff3355, 0.22);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
      g.lineStyle(1, 0x00f0ff, 0.12);
      g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }
  for (const id of STATION_IDS) {
    const s = STATIONS[id];
    g.fillStyle(0xffe14d, 0.85);
    g.fillRect(s.x * TILE + 6, s.y * TILE + 6, 4, 4);
  }
  c.add(g);
  c.setVisible(false);
  return c;
}
