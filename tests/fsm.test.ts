import { describe, expect, it } from 'vitest';
import { AGENT_STATES } from '../shared/types';
import { canTransition, TRANSITIONS } from '../server/sim/fsm';
import { Simulation } from '../server/sim/Simulation';

describe('agent state machine', () => {
  it('defines transitions for every state and allows staying in a state', () => {
    for (const s of AGENT_STATES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it('accepts the transitions the lifecycle needs', () => {
    expect(canTransition('idle', 'walking')).toBe(true);
    expect(canTransition('walking', 'working_at_desk')).toBe(true);
    expect(canTransition('working_at_desk', 'researching')).toBe(true);
    expect(canTransition('researching', 'error')).toBe(true);
    expect(canTransition('error', 'researching')).toBe(true);
    expect(canTransition('handing_over', 'celebrating')).toBe(true);
    expect(canTransition('sleeping', 'walking')).toBe(true);
    expect(canTransition('sleeping', 'idle')).toBe(true);
  });

  it('rejects transitions that skip waking up or recovering', () => {
    expect(canTransition('sleeping', 'working_at_desk')).toBe(false);
    expect(canTransition('sleeping', 'celebrating')).toBe(false);
    expect(canTransition('error', 'celebrating')).toBe(false);
    expect(canTransition('drinking_coffee', 'error')).toBe(false);
  });

  it('reroutes an invalid change through idle and counts it', () => {
    const sim = new Simulation({ idle: false, seed: 1 });
    const ghost = sim.hacker;
    ghost.setState('sleeping', 'sleep', 'NAP');
    expect(ghost.state).toBe('sleeping');
    ghost.setState('working_at_desk', 'typing', 'HACKING');
    expect(ghost.state).toBe('working_at_desk');
    expect(ghost.invalidTransitions).toBe(1);
  });

  it('runs a goto + do plan: walks, arrives facing the station, works, then idles', () => {
    const sim = new Simulation({ idle: false, seed: 1 });
    const byte = sim.assistant;
    const states: string[] = [];
    sim.onFlush((events) => {
      for (const e of events) if (e.type === 'AGENT_STATE' && e.payload.agentId === 'byte') states.push(e.payload.state);
    });
    byte.plan([
      { kind: 'goto', station: 'COFFEE' },
      { kind: 'do', state: 'researching', anim: 'typing', activity: 'BREW', duration: 1000, facing: 'up' },
    ]);
    for (let i = 0; i < 400; i++) sim.step(50);
    expect(byte.x).toBe(16);
    expect(byte.y).toBe(15);
    expect(byte.facing).toBe('up');
    expect(byte.state).toBe('idle');
    expect(states).toContain('walking');
    expect(states).toContain('researching');
    expect(byte.history.map((h) => h.text)).toEqual(expect.arrayContaining(['-> COFFEE', 'BREW']));
  });
});
