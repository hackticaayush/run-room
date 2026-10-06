// Loads every texture through the manifest, then registers character animations
// from characters.json (never from hard-coded frame numbers).

import Phaser from 'phaser';
import { ASSET_BASE, BITMAP_FONTS, CHARACTERS, CHROME, EMISSIVE, FX, PROPS, TILESET } from '../assets/manifest';

export const TEX = {
  tiles: 'tiles',
  tilesEmissive: EMISSIVE.tileset.key,
  props: PROPS.key,
  propsEmissive: EMISSIVE.props.key,
  fx: FX.key,
  bubbleSpeech: 'bubble_speech',
  bubbleThought: 'bubble_thought',
} as const;

/** Texture key of a character's emissive sheet. */
export function emissiveKey(who: string): string {
  return `${who}_emissive`;
}

interface CharactersJson {
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, { frames: number[]; fps: number; repeat: number }>;
  characters: Record<string, { image: string }>;
}

/** Animation key for a character animation, e.g. ghost_walk_down. */
export function animKey(who: string, anim: string): string {
  return `${who}_${anim}`;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.setPath(ASSET_BASE);
    const tileFrame = { frameWidth: TILESET.tileSize, frameHeight: TILESET.tileSize };
    this.load.spritesheet(TEX.tiles, TILESET.image, tileFrame);
    this.load.spritesheet(TEX.tilesEmissive, EMISSIVE.tileset.image, tileFrame);
    this.load.atlas(TEX.props, PROPS.image, PROPS.json);
    this.load.atlas(TEX.propsEmissive, EMISSIVE.props.image, EMISSIVE.props.json);
    this.load.atlas(TEX.fx, FX.image, FX.json);
    const charFrame = { frameWidth: CHARACTERS.frameWidth, frameHeight: CHARACTERS.frameHeight };
    for (const [who, file] of Object.entries(CHARACTERS.sheets)) this.load.spritesheet(who, file, charFrame);
    for (const [who, file] of Object.entries(EMISSIVE.characters)) this.load.spritesheet(emissiveKey(who), file, charFrame);
    this.load.json('characters', CHARACTERS.json);
    this.load.image(TEX.bubbleSpeech, CHROME.bubble_speech.image);
    this.load.image(TEX.bubbleThought, CHROME.bubble_thought.image);
    for (const f of Object.values(BITMAP_FONTS)) this.load.bitmapFont(f.key, f.image, f.xml);
  }

  create(): void {
    const meta = this.cache.json.get('characters') as CharactersJson;
    for (const who of Object.keys(meta.characters)) {
      for (const [name, a] of Object.entries(meta.animations)) {
        const key = animKey(who, name);
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(who, { frames: a.frames }),
          frameRate: a.fps,
          repeat: a.repeat,
        });
      }
    }
    this.scene.start('office');
  }
}
