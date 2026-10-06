// Adapter interfaces so the simulated office can later be driven by real agent events.
//
//   TaskSource  - where runs come from. Today: the in-app RUN PYTHON box (SUBMIT_TASK over WebSocket).
//                 Tomorrow: a queue, a webhook, a cron job... Anything that calls submit().
//   EventSource - who drives the visible lifecycle. By default the built-in TaskDirector
//                 SIMULATES it (and runs a TaskRunner). A real agent backend can implement
//                 EventSource instead and push steps, logs, speech and results through the sink;
//                 the office animates whatever it receives.

import type { RunSource } from '../../shared/events';
import type { AgentId, BubbleKind, LogLevel, Priority, ResultInfo, TaskStep } from '../../shared/types';

/** A run entering the simulation, whatever produced it. */
export interface TaskInput {
  /** An upload id issued by POST /api/upload/* or a saved project id (resolved server side). */
  source: RunSource;
  /** Setup commands; for a saved project they default to the saved ones. */
  setup?: string[];
  /** The run command, e.g. "python main.py"; for a saved project it defaults to the saved one. */
  run?: string;
  priority: Priority;
  /** Also save the uploaded code under this name (the run then uses the saved project). */
  saveAs?: string;
  overwrite?: boolean;
  /** Run the setup again even if it already ran OK for this saved project. */
  forceSetup?: boolean;
  /** WebSocket client that submitted it (its permission to run code is checked). */
  clientId?: string;
}

export interface TaskSource {
  /** Called once when the source is attached; push tasks with submit(). */
  attach(submit: (task: TaskInput) => { taskId: string } | { error: string }): void;
  detach(): void;
}

/** Hooks an external lifecycle driver calls. The simulation turns them into office events. */
export interface LifecycleSink {
  /** Moves the task to a lifecycle step; the agents walk to that step's stations. */
  step(taskId: string, step: TaskStep, progress?: number): void;
  log(level: LogLevel, source: string, text: string): void;
  say(agentId: AgentId, text: string, kind?: BubbleKind): void;
  /** Publishes the final result and completes the task. */
  result(result: Omit<ResultInfo, 'createdAt'>): void;
}

export interface EventSource {
  name: string;
  start(sink: LifecycleSink): void;
  stop(): void;
}
