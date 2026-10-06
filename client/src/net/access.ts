// Admin access. Watching is open to everyone; full access (upload, run, save, control the office)
// needs the admin password set on the server in RUNROOM_ACCESS_PASSWORD. The password is exchanged
// once (POST /api/login) for a session token kept in this browser and sent on the WebSocket
// (?token=) and on uploads (the X-RunRoom-Token header). Guests send no token and simply watch.

import { reconnect } from './socket';

const STORE = 'runroom.adminToken.v1';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

let token: string | null = null;

export function initAuth(): void {
  try {
    const stored = localStorage.getItem(STORE);
    token = stored && TOKEN_RE.test(stored) ? stored : null;
  } catch {
    token = null;
  }
}

export function adminToken(): string | null {
  return token;
}

function store(t: string | null): void {
  token = t;
  try {
    if (t) localStorage.setItem(STORE, t);
    else localStorage.removeItem(STORE);
  } catch {
    // Private mode: the token still works for this visit.
  }
}

/** Exchange the password for a token, then reconnect so the server greets this browser as admin. */
export async function login(password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `could not log in (HTTP ${res.status})`);
  store(body.token);
  reconnect();
}

/** Drop admin access and reconnect as a guest. */
export async function logout(): Promise<void> {
  const t = token;
  store(null);
  reconnect();
  if (t) {
    try {
      await fetch('/api/logout', { method: 'POST', headers: { 'X-RunRoom-Token': t } });
    } catch {
      // The token is already forgotten in this browser; the server copy expires on its own.
    }
  }
}
