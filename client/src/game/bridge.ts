// Tiny typed event bus between React (HUD) and Phaser (office canvas).

import type { AgentId } from '@shared/types';

export interface BridgeEvents {
  /** HUD -> game: camera follows this agent (null = whole office). */
  follow: AgentId | null;
  /** game -> HUD: an agent sprite was clicked. */
  agentClicked: AgentId;
  /** game -> HUD: a monitor was clicked (opens the terminal panel). */
  monitorClicked: undefined;
  /** game -> HUD: the cat was clicked. */
  catClicked: undefined;
  /** game -> HUD: scene finished loading. */
  ready: undefined;
}

type Handler<T> = (payload: T) => void;

class Bridge {
  private handlers = new Map<keyof BridgeEvents, Set<Handler<never>>>();

  on<K extends keyof BridgeEvents>(event: K, handler: Handler<BridgeEvents[K]>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof BridgeEvents>(event: K, payload: BridgeEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<BridgeEvents[K]>)(payload);
  }
}

export const bridge = new Bridge();

/** Camera follow target shared by HUD and game. */
export const followState = { agentId: null as AgentId | null };
