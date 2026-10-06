// Sprite primitives: every image in the HUD is a generated sprite looked up in the manifest.

import type { CSSProperties } from 'react';
import {
  CHARACTERS,
  DIGITS,
  MOODS,
  MOOD_FACES,
  PORTRAITS,
  TILESET,
  UI_ICONS,
  assetUrl,
  type AtlasInfo,
  type CharacterKey,
  type IconName,
  type PortraitKey,
} from '../assets/manifest';
import type { Mood } from '@shared/types';

export type PixelScale = 1 | 2 | 3 | 4 | 5 | 6;

interface SpriteProps {
  atlas: AtlasInfo;
  frame: string;
  scale?: PixelScale;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** One frame of a packed atlas, scaled by an integer factor with CSS background-position. */
export function PixelSprite({ atlas, frame, scale = 2, className, style, title }: SpriteProps) {
  const f = atlas.frames[frame];
  if (!f) return null;
  return (
    <span
      className={`px-sprite ${className ?? ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        width: f.w * scale,
        height: f.h * scale,
        backgroundImage: `url("${assetUrl(atlas.image)}")`,
        backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        backgroundPosition: `${-f.x * scale}px ${-f.y * scale}px`,
        ...style,
      }}
    />
  );
}

interface IconProps {
  name: IconName;
  size?: 1 | 2 | 3;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/** A 16x16 UI icon from the generated icon atlas. size is the integer scale. */
export function PixelIcon({ name, size = 2, className, title, style }: IconProps) {
  return <PixelSprite atlas={UI_ICONS} frame={name} scale={size} className={`px-icon ${className ?? ''}`} title={title} style={style} />;
}

/** A number drawn with the badge digit sprites. */
export function PixelNumber({ value, size = 2, minDigits = 1 }: { value: number; size?: 1 | 2 | 3; minDigits?: number }) {
  const text = String(Math.max(0, Math.floor(value))).padStart(minDigits, '0');
  return (
    <span className="px-number" role="img" aria-label={text}>
      {[...text].map((d, i) => (
        <PixelSprite key={i} atlas={UI_ICONS} frame={DIGITS[Number(d)]} scale={size} style={i > 0 ? { marginLeft: -size } : undefined} />
      ))}
    </span>
  );
}

/** Mood face sprite for a simulation mood. */
export function MoodFace({ mood, size = 2, title }: { mood: Mood; size?: 1 | 2 | 3; title?: string }) {
  return <PixelSprite atlas={MOODS} frame={MOOD_FACES[mood]} scale={size} title={title ?? mood.toUpperCase()} />;
}

/** 32x32 roster portrait. */
export function Portrait({ who, scale = 2 }: { who: PortraitKey; scale?: PixelScale }) {
  const p = PORTRAITS[who];
  return (
    <span
      className="px-sprite"
      role="img"
      aria-label={`${who} portrait`}
      style={{
        width: p.width * scale,
        height: p.height * scale,
        backgroundImage: `url("${assetUrl(p.image)}")`,
        backgroundSize: `${p.width * scale}px ${p.height * scale}px`,
      }}
    />
  );
}

/** One frame (by index) of a character sheet. */
export function CharacterFrame({ who, frame, scale = 2 }: { who: CharacterKey; frame: number; scale?: PixelScale }) {
  const { frameWidth: fw, frameHeight: fh, columns, rows } = CHARACTERS;
  const col = frame % columns;
  const row = Math.floor(frame / columns);
  return (
    <span
      className="px-sprite"
      style={{
        width: fw * scale,
        height: fh * scale,
        backgroundImage: `url("${assetUrl(CHARACTERS.sheets[who])}")`,
        backgroundSize: `${fw * columns * scale}px ${fh * rows * scale}px`,
        backgroundPosition: `${-col * fw * scale}px ${-row * fh * scale}px`,
      }}
    />
  );
}

/** One tile of the tileset by index. */
export function TileSprite({ index, scale = 2 }: { index: number; scale?: PixelScale }) {
  const size = TILESET.tileSize;
  const col = index % TILESET.columns;
  const row = Math.floor(index / TILESET.columns);
  const rowsTotal = Math.ceil(Object.keys(TILESET.tiles).length / TILESET.columns);
  return (
    <span
      className="px-sprite"
      style={{
        width: size * scale,
        height: size * scale,
        backgroundImage: `url("${assetUrl(TILESET.image)}")`,
        backgroundSize: `${TILESET.columns * size * scale}px ${rowsTotal * size * scale}px`,
        backgroundPosition: `${-col * size * scale}px ${-row * size * scale}px`,
      }}
    />
  );
}
