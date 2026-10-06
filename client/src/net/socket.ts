// WebSocket link to the authoritative simulation server.
// Reconnects with backoff; after every (re)connect the server sends HELLO + STATE_SNAPSHOT.

import type { ClientCommand, ServerEvent } from '@shared/events';
import { WS_PATH } from '@shared/constants';
import { worldStore } from './store';
import { adminToken } from './access';

let socket: WebSocket | null = null;
let retry = 0;
let started = false;
let reconnectTimer: number | undefined;

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = adminToken();
  return `${proto}//${location.host}${WS_PATH}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

function open(): void {
  const ws = new WebSocket(url());
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    worldStore.setConnected(true);
  };
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(String(msg.data)) as ServerEvent[] | ServerEvent;
      worldStore.apply(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.warn('runroom: bad frame', err);
    }
  };
  ws.onclose = () => {
    // A newer socket (from reconnect) has taken over: let this stale one die quietly.
    if (socket !== ws) return;
    socket = null;
    worldStore.setConnected(false);
    const delay = Math.min(5000, 400 * 2 ** retry++);
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(open, delay);
  };
  ws.onerror = () => ws.close();
}

/** Drop the current connection and open a fresh one (used after login / logout changes the token). */
export function reconnect(): void {
  const old = socket;
  window.clearTimeout(reconnectTimer);
  retry = 0;
  socket = null; // detach: the old socket's onclose sees socket !== ws and bails out
  try {
    old?.close();
  } catch {
    // Already closing.
  }
  if (started) open();
}

export function connect(): void {
  if (started) return;
  started = true;
  open();
  // A hidden tab may miss nothing (frames still arrive) but its clock estimate can drift;
  // ask for a fresh snapshot when it becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send({ type: 'REQUEST_SNAPSHOT', payload: {} });
  });
}

export function send(command: ClientCommand): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    worldStore.pushNotice('warn', 'OFFLINE - command not sent');
    return false;
  }
  socket.send(JSON.stringify(command));
  return true;
}
