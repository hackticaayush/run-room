// Terminal log: VT323, green on dark, color by level, typewriter effect for new lines,
// auto-scroll with a pixel scrollbar, filter tabs, copy and clear.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { LogChannel, LogEntry } from '@shared/types';
import { useWorld, worldStore } from '../net/store';
import { useSettings } from '../settings';
import { PixelButton, PixelPanel, PixelScroll, PixelTabs } from '../ui';
import { hhmmss } from './useNow';
import { useUi } from './uiState';

type Filter = 'ALL' | 'OUTPUT' | 'TRACE' | 'CREW' | 'SYSTEM';

const FILTER_CHANNELS: Record<Exclude<Filter, 'ALL'>, readonly LogChannel[]> = {
  OUTPUT: ['stdout', 'stderr', 'input', 'setup'],
  TRACE: ['trace'],
  CREW: ['chat'],
  SYSTEM: ['system', 'runner'],
};
/** Program output and trace lines appear at once (they can come fast). */
const INSTANT: readonly LogChannel[] = ['stdout', 'stderr', 'trace', 'setup', 'input'];
const MAX_SHOWN = 300;
const CHARS_PER_MS = 0.12;
const MAX_REVEAL_MS = 450;

function revealMs(text: string): number {
  return Math.min(MAX_REVEAL_MS, text.length / CHARS_PER_MS);
}

/** One line. Memoized: while a new line types itself out, only that line renders again, not all 300. */
const TermLine = memo(function TermLine({ entry, text }: { entry: LogEntry; text: string }) {
  return (
    <div className={`term-line lvl-${entry.level} ch-${entry.channel}`}>
      <span className="term-time">{hhmmss(entry.timestamp)}</span>
      <span className="term-src">{entry.source.slice(0, 6).padEnd(6, ' ')}</span>
      <span className="term-text">{text}</span>
    </div>
  );
});

export function Terminal() {
  const logs = useWorld((s) => s.logs);
  const epoch = useWorld((s) => s.logEpoch);
  const settings = useSettings();
  const pulse = useUi((s) => s.terminalPulse);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [flash, setFlash] = useState(false);
  const [, setFrame] = useState(0);
  const firstSeen = useRef(new Map<number, number>());
  const mountedAt = useRef(performance.now());

  // Lines present at mount (or after a snapshot) appear instantly; later ones type out.
  useEffect(() => {
    mountedAt.current = performance.now();
    firstSeen.current.clear();
    for (const l of worldStore.state.logs) firstSeen.current.set(l.id, 0);
  }, [epoch]);

  useEffect(() => {
    if (!pulse) return;
    setFilter('ALL');
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(t);
  }, [pulse]);

  const visible = useMemo(() => {
    const list = filter === 'ALL' ? logs : logs.filter((l) => FILTER_CHANNELS[filter].includes(l.channel));
    return list.slice(-MAX_SHOWN);
  }, [logs, filter]);

  const now = performance.now();
  for (const l of visible) if (!firstSeen.current.has(l.id)) firstSeen.current.set(l.id, now);
  const shown = (l: LogEntry): string => {
    // The source column already names the speaker: drop a repeated "NAME: " prefix.
    const prefix = `${l.source}: `;
    const text = l.text.startsWith(prefix) ? l.text.slice(prefix.length) : l.text;
    return reveal(l, text);
  };
  const reveal = (l: LogEntry, text: string): string => {
    if (!settings.typewriter || INSTANT.includes(l.channel)) return text;
    const seen = firstSeen.current.get(l.id) ?? 0;
    if (seen === 0) return text;
    const age = now - seen;
    const total = revealMs(text);
    if (age >= total) return text;
    return text.slice(0, Math.max(1, Math.floor((age / total) * text.length)));
  };
  const revealing = settings.typewriter && visible.some((l) => {
    if (INSTANT.includes(l.channel)) return false;
    const seen = firstSeen.current.get(l.id) ?? 0;
    return seen > 0 && now - seen < revealMs(l.text);
  });

  useEffect(() => {
    if (!revealing) return;
    let raf = 0;
    const loop = () => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [revealing]);

  const copy = async () => {
    const text = visible.map((l) => `[${hhmmss(l.timestamp)}] ${l.source} ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      worldStore.pushNotice('info', `COPIED ${visible.length} LINES`);
    } catch {
      worldStore.pushNotice('warn', 'CLIPBOARD NOT AVAILABLE');
    }
  };

  return (
    <PixelPanel
      title="TERMINAL"
      icon="terminal"
      className={`hud-terminal ${flash ? 'is-flash' : ''}`}
      actions={
        <>
          <PixelButton icon="copy" title="COPY VISIBLE LINES" aria-label="copy" onClick={copy} />
          <PixelButton icon="trash" title="CLEAR (THIS VIEW ONLY)" aria-label="clear" tone="danger" onClick={() => worldStore.clearLogs()} />
        </>
      }
    >
      <PixelTabs<Filter>
        label="log filter"
        tabs={[
          { id: 'ALL', label: 'ALL' },
          { id: 'OUTPUT', label: 'OUTPUT' },
          { id: 'TRACE', label: 'TRACE' },
          { id: 'CREW', label: 'CREW' },
          { id: 'SYSTEM', label: 'SYS' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <div className="term-screen">
        <PixelScroll stickToBottom watch={`${visible.length}:${visible.at(-1)?.id ?? 0}:${filter}`}>
          <div className="term-lines">
            {visible.length === 0 && <div className="term-line lvl-debug">-- NO OUTPUT YET --</div>}
            {visible.map((l) => (
              <TermLine key={l.id} entry={l} text={shown(l)} />
            ))}
            <div className="term-cursor">{'>'} _</div>
          </div>
        </PixelScroll>
      </div>
    </PixelPanel>
  );
}
