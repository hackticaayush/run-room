// Tracks every open WebSocket connection and fans server events out to them.
// The simulation never talks to sockets directly; it hands batches of events to the registry.

import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ServerEvent } from '../../shared/events';

export interface ClientInfo {
  id: string;
  ws: WebSocket;
  joinedAt: number;
  remote: string;
  alive: boolean;
}

export class ClientRegistry {
  private readonly clients = new Map<string, ClientInfo>();

  add(ws: WebSocket, remote: string): ClientInfo {
    const id = 'c_' + randomBytes(4).toString('hex');
    const info: ClientInfo = { id, ws, joinedAt: Date.now(), remote, alive: true };
    this.clients.set(id, info);
    ws.on('pong', () => {
      info.alive = true;
    });
    return info;
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  has(id: string): boolean {
    return this.clients.has(id);
  }

  get count(): number {
    return this.clients.size;
  }

  ids(): string[] {
    return [...this.clients.keys()];
  }

  /** Sends one JSON frame (an array of events) to every open connection. */
  broadcast(events: ServerEvent[]): void {
    if (events.length === 0 || this.clients.size === 0) return;
    const frame = JSON.stringify(events);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(frame);
    }
  }

  /** Sends events to a single connection (HELLO, snapshot, notices, sandbox prompts). */
  sendTo(id: string, events: ServerEvent[]): void {
    const c = this.clients.get(id);
    if (!c || events.length === 0 || c.ws.readyState !== WebSocket.OPEN) return;
    c.ws.send(JSON.stringify(events));
  }

  /** Pings every client and drops the ones that did not answer the previous ping. */
  heartbeat(): void {
    for (const c of this.clients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c.id);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        // Socket already closing; the close handler removes it.
      }
    }
  }

  closeAll(): void {
    for (const c of this.clients.values()) c.ws.terminate();
    this.clients.clear();
  }
}
