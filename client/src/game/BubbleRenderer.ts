// Speech and thought bubbles: generated 9-slice chrome (bubble_speech / bubble_thought) with the
// generated 5x7 bitmap font. Thought bubbles show their text (e.g. the function Ghost runs);
// an empty thought shows cycling matrix rain frames instead.

import type Phaser from 'phaser';
import type { AgentId, DialogueInfo } from '@shared/types';
import { BITMAP_FONTS, CHROME } from '../assets/manifest';
import { TEX } from './BootScene';
import { DEPTH } from './PropRenderer';
import type { AgentScreenPos } from './AgentRenderer';

const MAX_CHARS = 22;
const MAX_LINES = 3;
const PAD = 4;
const MAP_W = 512;

interface BubbleView {
  box: Phaser.GameObjects.NineSlice;
  tail: Phaser.GameObjects.Image;
  text?: Phaser.GameObjects.BitmapText;
  matrix?: Phaser.GameObjects.Image[];
  w: number;
  h: number;
}

/** Word wrap to MAX_CHARS per line, at most MAX_LINES (ASCII only, upper case font). */
export function wrapText(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const w = word.length > MAX_CHARS ? `${word.slice(0, MAX_CHARS - 1)}-` : word;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= MAX_CHARS) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1].slice(0, MAX_CHARS - 3)}...`;
    return kept;
  }
  return lines;
}

export class BubbleRenderer {
  private readonly views = new Map<string, BubbleView>();

  constructor(private readonly scene: Phaser.Scene) {}

  private create(d: DialogueInfo): BubbleView {
    const thought = d.kind === 'thought';
    const chrome = thought ? CHROME.bubble_thought : CHROME.bubble_speech;
    const s = chrome.slice;
    let w: number;
    let h: number;
    let text: Phaser.GameObjects.BitmapText | undefined;
    let matrix: Phaser.GameObjects.Image[] | undefined;
    const font = BITMAP_FONTS.bubble;
    if (thought && !d.text.trim()) {
      w = 24 + PAD * 2;
      h = 8 + PAD * 2;
      matrix = [0, 1, 2].map(() => this.scene.add.image(0, 0, TEX.fx, 'matrix_0').setOrigin(0, 0).setDepth(DEPTH.bubbles + 1));
    } else {
      const lines = wrapText(d.text.toUpperCase());
      const longest = Math.max(...lines.map((l) => l.length));
      w = Math.max(20, longest * font.advance - 1 + PAD * 2);
      h = lines.length * font.lineHeight - 2 + PAD * 2;
      text = this.scene.add
        .bitmapText(0, 0, font.key, lines.join('\n'), font.size)
        .setLineSpacing(0)
        .setTint(0x0b0f1a)
        .setDepth(DEPTH.bubbles + 1);
    }
    const box = this.scene.add
      .nineslice(0, 0, thought ? TEX.bubbleThought : TEX.bubbleSpeech, undefined, w, h, s.left, s.right, s.top, s.bottom)
      .setOrigin(0, 0)
      .setDepth(DEPTH.bubbles);
    const tail = this.scene.add
      .image(0, 0, TEX.fx, thought ? 'bubble_tail_thought' : 'bubble_tail_speech')
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.bubbles + 1);
    return { box, tail, text, matrix, w, h };
  }

  private destroy(v: BubbleView): void {
    v.box.destroy();
    v.tail.destroy();
    v.text?.destroy();
    v.matrix?.forEach((m) => m.destroy());
  }

  update(now: number, dialogues: readonly DialogueInfo[], positions: Map<AgentId, AgentScreenPos>): void {
    const alive = new Set<string>();
    // Older bubbles keep their place; a newer one that would cover one moves up above it.
    const placed: { left: number; top: number; w: number; h: number }[] = [];
    const ordered = [...dialogues].sort((a, b) => a.startClock - b.startClock);
    for (const d of ordered) {
      const age = now - d.startClock;
      if (d.duration <= 0 || age < 0 || age > d.duration) continue;
      const pos = positions.get(d.from);
      if (!pos) continue;
      alive.add(d.id);
      let v = this.views.get(d.id);
      if (!v) {
        v = this.create(d);
        this.views.set(d.id, v);
      }
      // Small pop when the bubble appears.
      const pop = age < 90 ? 2 : 0;
      const tailH = d.kind === 'thought' ? 6 : 3;
      const left = Math.max(2, Math.min(MAP_W - v.w - 2, Math.round(pos.x - v.w / 2)));
      let top = Math.max(2, pos.top - tailH - v.h - 2 - pop);
      for (let guard = 0; guard < 4; guard++) {
        const hit = placed.find((p) => left < p.left + p.w && p.left < left + v.w && top < p.top + p.h && p.top < top + v.h);
        if (!hit || hit.top - v.h - 3 < 2) break;
        top = hit.top - v.h - 3;
      }
      placed.push({ left, top, w: v.w, h: v.h });
      v.box.setPosition(left, top);
      const tailX = Math.max(left + 5, Math.min(left + v.w - 5, pos.x));
      v.tail.setPosition(tailX, top + v.h - 1);
      if (v.text) v.text.setPosition(left + PAD, top + PAD);
      if (v.matrix) {
        const f = Math.floor(age / 120);
        v.matrix.forEach((m, i) => m.setFrame(`matrix_${(f + i) % 4}`).setPosition(left + PAD + i * 8, top + PAD));
      }
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.destroy(v);
        this.views.delete(id);
      }
    }
  }
}
