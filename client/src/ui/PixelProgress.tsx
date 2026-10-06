import type { CSSProperties } from 'react';
import { chromeStyle } from './theme';

interface ProgressProps {
  /** 0..1 */
  value: number;
  /** Total height in CSS pixels. */
  height?: number;
  /** Integer scale of the frame chrome (1 for compact bars). */
  scale?: 1 | 2;
  title?: string;
  style?: CSSProperties;
}

/** Progress bar: progress_bar_empty frame with a progress_bar_fill 9-slice inside. */
export function PixelProgress({ value, height = 20, scale = 2, title, style }: ProgressProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className="px-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      title={title}
      style={{ ...chromeStyle('progress_bar_empty', scale), height, ...style }}
    >
      {v > 0 && <div className="px-progress-fill" style={{ ...chromeStyle('progress_bar_fill', scale), width: `${v * 100}%` }} />}
    </div>
  );
}
