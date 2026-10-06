// Minimal WebSocket test client that records every server event it receives.
import WebSocket from 'ws';
import type { ClientCommand, ServerEvent, ServerEventType } from '../../shared/events';

export class TestClient {
  readonly events: ServerEvent[] = [];
  readonly frames: string[] = [];
  private ws: WebSocket;
  private waiters: { pred: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const text = data.toString();
      this.frames.push(text);
      const list = JSON.parse(text) as ServerEvent[];
      for (const e of list) {
        this.events.push(e);
        this.waiters = this.waiters.filter((w) => {
          if (w.pred(e)) {
            w.resolve(e);
            return false;
          }
          return true;
        });
      }
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(command: ClientCommand): void {
    this.ws.send(JSON.stringify(command));
  }

  /** Resolves with the first event (already received or future) that matches. */
  waitFor(pred: (e: ServerEvent) => boolean, timeoutMs = 15000, includePast = true): Promise<ServerEvent> {
    if (includePast) {
      const hit = this.events.find(pred);
      if (hit) return Promise.resolve(hit);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for event')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
      });
    });
  }

  waitForType<K extends ServerEventType>(type: K, timeoutMs?: number, includePast = true) {
    return this.waitFor((e) => e.type === type, timeoutMs, includePast) as Promise<Extract<ServerEvent, { type: K }>>;
  }

  ofType<K extends ServerEventType>(type: K): Extract<ServerEvent, { type: K }>[] {
    return this.events.filter((e) => e.type === type) as Extract<ServerEvent, { type: K }>[];
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}
