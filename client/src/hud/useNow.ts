import { useEffect, useState } from 'react';
import { worldStore } from '../net/store';

/** Re-renders every `ms` and returns [wall clock ms, mirrored sim clock ms]. */
export function useNow(ms = 500): [number, number] {
  const [t, setT] = useState(() => [Date.now(), worldStore.simNow()] as [number, number]);
  useEffect(() => {
    const id = window.setInterval(() => setT([Date.now(), worldStore.simNow()]), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
}

export function hhmmss(epochMs: number): string {
  const d = new Date(epochMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function simTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
