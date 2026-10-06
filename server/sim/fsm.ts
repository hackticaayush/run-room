// Per-agent finite state machine: which state may follow which.
// The Agent class routes every state change through canTransition(); an invalid change is
// rerouted through 'idle' and counted (tests assert the lifecycle never needs that).

import type { AgentStateName } from '../../shared/types';

export const TRANSITIONS: Readonly<Record<AgentStateName, readonly AgentStateName[]>> = {
  idle: ['idle', 'walking', 'working_at_desk', 'researching', 'handing_over', 'drinking_coffee', 'celebrating', 'error', 'sleeping'],
  walking: ['walking', 'idle', 'working_at_desk', 'researching', 'handing_over', 'drinking_coffee', 'celebrating', 'error', 'sleeping'],
  working_at_desk: ['working_at_desk', 'idle', 'walking', 'researching', 'handing_over', 'celebrating', 'error', 'sleeping'],
  researching: ['researching', 'idle', 'walking', 'working_at_desk', 'handing_over', 'celebrating', 'error'],
  handing_over: ['handing_over', 'idle', 'walking', 'working_at_desk', 'researching', 'celebrating'],
  drinking_coffee: ['drinking_coffee', 'idle', 'walking', 'celebrating', 'sleeping'],
  celebrating: ['celebrating', 'idle', 'walking', 'working_at_desk', 'researching', 'drinking_coffee'],
  error: ['error', 'idle', 'walking', 'working_at_desk', 'researching'],
  // A sleeping agent has to wake up (idle) or get up and walk before doing anything else.
  sleeping: ['sleeping', 'idle', 'walking'],
};

export function canTransition(from: AgentStateName, to: AgentStateName): boolean {
  return TRANSITIONS[from].includes(to);
}

export { STATE_WORD } from '../../shared/agents';
