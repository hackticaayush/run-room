// Agent registry. The simulation and the HUD are generic over this list: adding an agent means
// adding an entry here, a character sheet (tools/assets/art/characters.mjs) and a portrait.

import type { StationId } from './officeLayout';
import type { AgentId, AgentStateName, Mood } from './types';

/** Short ASCII word per agent state for the HUD ("RUN", "IDLE", "COFFEE" ...). */
export const STATE_WORD: Readonly<Record<AgentStateName, string>> = {
  idle: 'IDLE',
  walking: 'MOVE',
  working_at_desk: 'RUN',
  researching: 'SCAN',
  handing_over: 'HAND',
  drinking_coffee: 'COFFEE',
  celebrating: 'OK',
  error: 'ERR',
  sleeping: 'ZZZ',
};

export type IdleProfile = 'hacker' | 'assistant';

export interface AgentDef {
  id: AgentId;
  name: string;
  role: string;
  /** Character sheet key in the asset manifest (CHARACTERS.sheets). */
  sprite: string;
  /** Portrait key in the asset manifest (PORTRAITS). */
  portrait: string;
  home: StationId;
  /** Walk speed in tiles per sim second. */
  speed: number;
  idle: IdleProfile;
  startMood: Mood;
  /** HUD accent color (palette CSS variable name). */
  accent: string;
}

export const AGENT_DEFS: readonly AgentDef[] = [
  {
    id: 'ghost',
    name: 'GHOST',
    role: 'HACKER',
    sprite: 'ghost',
    portrait: 'ghost',
    home: 'DESK_GHOST',
    speed: 3.4,
    idle: 'hacker',
    startMood: 'focused',
    accent: '--c-cyan-2',
  },
  {
    id: 'byte',
    name: 'BYTE',
    role: 'ASSISTANT',
    sprite: 'byte',
    portrait: 'byte',
    home: 'BYTE_HOME',
    speed: 4.2,
    idle: 'assistant',
    startMood: 'focused',
    accent: '--c-yel-2',
  },
];

export const HACKER_ID: AgentId = 'ghost';
export const ASSISTANT_ID: AgentId = 'byte';

/** XP needed for a level: level = 1 + floor(sqrt(xp / 50)). */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}

export function xpForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}
