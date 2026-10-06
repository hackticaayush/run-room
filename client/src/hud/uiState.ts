// Local (per viewer) HUD state: open modal, followed agent, selected result, mobile tab.

import { useSyncExternalStore } from 'react';
import type { AgentId } from '@shared/types';
import { bridge } from '../game/bridge';
import { updateSettings } from '../settings';

export type ModalKind = 'run' | 'result' | 'settings' | 'error' | 'consent' | 'login' | null;
export type PanelTab = 'roster' | 'terminal' | 'queue';
export type RunTab = 'file' | 'folder' | 'saved';

export interface UiState {
  modal: ModalKind;
  /** Which tab the RUN PYTHON box opens on. */
  runTab: RunTab | null;
  resultId: string | null;
  errorText: string | null;
  /** Agent whose detail card is open. */
  detailId: AgentId | null;
  /** The detail card is folded away to its title bar (the camera keeps following). */
  detailCollapsed: boolean;
  /** Agent the camera follows. */
  followId: AgentId | null;
  panelTab: PanelTab;
  /** Incremented to flash the terminal (monitor clicked). */
  terminalPulse: number;
  /** The guest/admin entry screen has been answered (chose to watch, or logged in). */
  authGateDone: boolean;
}

let state: UiState = {
  modal: null,
  runTab: null,
  resultId: null,
  errorText: null,
  detailId: null,
  detailCollapsed: false,
  followId: null,
  panelTab: 'terminal',
  terminalPulse: 0,
  authGateDone: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const CONSENT_KEY = 'runroom.runConsent.v1';
let pendingRun: (() => void) | null = null;

function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export const ui = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  openRunBox: (tab: RunTab | null = null) => set({ modal: 'run', runTab: tab }),
  openSettings: () => set({ modal: 'settings' }),
  openLogin: () => set({ modal: 'login' }),
  /** Chose to watch as a guest: close the entry screen for this visit. */
  enterAsGuest: () => set({ authGateDone: true, modal: null }),
  openResult: (taskId: string | null) => set({ modal: 'result', resultId: taskId }),
  showError: (text: string) => set({ modal: 'error', errorText: text }),
  closeModal: () => set({ modal: null, errorText: null }),
  /** Opening (or switching) an agent always shows its details unfolded. */
  openDetail: (id: AgentId | null) => set({ detailId: id, detailCollapsed: false }),
  setDetailCollapsed: (collapsed: boolean) => set({ detailCollapsed: collapsed }),
  setPanelTab: (tab: PanelTab) => set({ panelTab: tab }),
  pulseTerminal: () => set({ terminalPulse: state.terminalPulse + 1, panelTab: 'terminal' }),
  /** Camera follow (null = whole office). Turning follow on also enables the setting. */
  follow: (id: AgentId | null) => {
    if (id) updateSettings({ follow: true });
    set({ followId: id });
    bridge.emit('follow', id);
  },
  toggleFollow: (id: AgentId) => ui.follow(state.followId === id ? null : id),
  /**
   * Runs code only after this browser accepted, once, that programs run on this computer with
   * the user's permissions and that this is not a security sandbox.
   */
  withRunConsent: (run: () => void) => {
    if (hasConsent()) {
      run();
      return;
    }
    pendingRun = run;
    set({ modal: 'consent' });
  },
  answerConsent: (accept: boolean) => {
    const run = pendingRun;
    pendingRun = null;
    set({ modal: null });
    if (!accept) return;
    try {
      localStorage.setItem(CONSENT_KEY, '1');
    } catch {
      // Without storage the question simply comes back next time.
    }
    run?.();
  },
};

export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => selector(state));
}
