// Per-viewer settings, persisted in localStorage. (Sim speed is NOT here: it is shared server state.)

import { useSyncExternalStore } from 'react';

export interface Settings {
  crt: boolean;
  night: boolean;
  sound: boolean;
  /** Follow the selected agent with the camera. */
  follow: boolean;
  /** Collision grid and station markers over the map. */
  debugGrid: boolean;
  /** Typewriter effect for new terminal lines. */
  typewriter: boolean;
}

const KEY = 'runroom.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  crt: true,
  night: false,
  sound: false,
  follow: true,
  debugGrid: false,
  typewriter: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage may be unavailable (private mode); settings still work for this session.
  }
  for (const l of listeners) l();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
