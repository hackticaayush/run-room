// Who may talk to the server, and who gets full (admin) access.
//
// Watching is open: any browser, on any device or network, may connect and watch the office.
// Running code, saving projects and every other command is ADMIN only. Admin is unlocked with the
// password in RUNROOM_ACCESS_PASSWORD, exchanged once (POST /api/login) for a short lived session
// token the browser then sends on the WebSocket (?token=) and on uploads (the X-RunRoom-Token
// header). No links, QR codes or network checks: the token is the only thing that grants access.
//
// When NO password is set the server runs in "open" mode: everyone is admin. That is meant for
// your own computer (127.0.0.1). While the server listens only on this computer (password or not),
// the Host / Origin checks below stop a foreign web page or a DNS rebinding page from reaching it:
// with a guessable password such a page could otherwise log in and run code. When a password is
// set AND the server listens on the network, the office is public: watching needs nothing and
// admin needs the token, so those checks step aside (put the deployment behind HTTPS).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export interface AccessOptions {
  /** The address the server listens on. */
  bindHost: string;
  /** Extra browser origins allowed to connect in open mode, e.g. "http://192.168.1.10:5173". */
  allowedOrigins: string[];
}

export type Role = 'admin' | 'guest';

/** Constant time secret compare: hash to a fixed length first, so the length never leaks. */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/**
 * The admin password and the session tokens handed out for it. Tokens live in memory only, so
 * restarting the server signs everyone out. Nothing here is written to disk.
 */
export class AdminAuth {
  private readonly password: string | null;
  private readonly ttlMs: number;
  /** token -> expiry (epoch ms). */
  private readonly tokens = new Map<string, number>();

  constructor(password: string | null | undefined, ttlMs = 12 * 60 * 60 * 1000) {
    const p = (password ?? '').trim();
    this.password = p.length > 0 ? p : null;
    this.ttlMs = ttlMs;
  }

  /** True when a password is set, so admin has to log in. False = open mode (everyone is admin). */
  get required(): boolean {
    return this.password !== null;
  }

  /** Checks a password; on success returns a fresh session token, otherwise null. */
  login(password: unknown): string | null {
    if (!this.password || typeof password !== 'string' || password.length === 0) return null;
    if (!sameSecret(password, this.password)) return null;
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, Date.now() + this.ttlMs);
    return token;
  }

  /** Is this a live admin token? Expired tokens are dropped as they are seen. */
  valid(token: string | null): boolean {
    if (!token) return false;
    const exp = this.tokens.get(token);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string | null): void {
    if (token) this.tokens.delete(token);
  }

  /** The role of a request: admin in open mode, or when it carries a live token; else guest. */
  role(req: IncomingMessage): Role {
    if (!this.required) return 'admin';
    return this.valid(tokenOf(req)) ? 'admin' : 'guest';
  }
}

/** The session token a request presents: the X-RunRoom-Token header or ?token= on the WebSocket. */
export function tokenOf(req: IncomingMessage): string | null {
  const header = req.headers['x-runroom-token'];
  if (typeof header === 'string' && header) return header;
  try {
    return new URL(req.url ?? '/', 'http://local').searchParams.get('token');
  } catch {
    return null;
  }
}

export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '').toLowerCase();
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || isLoopbackAddress(h);
}

/** Hostname of a Host header ("localhost:5173" -> "localhost", "[::1]:8787" -> "::1"). */
export function hostnameOf(host: string | undefined): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/**
 * The browser's address. The Vite dev proxy (on this computer) APPENDS it to X-Forwarded-For, so
 * only the last entry is trusted: earlier entries come from the browser itself and could claim to
 * be 127.0.0.1. Used for rate limiting and logs, never for access decisions.
 */
export function clientAddress(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? '';
  const xff = req.headers['x-forwarded-for'];
  if (isLoopbackAddress(peer) && typeof xff === 'string' && xff.trim()) {
    const last = xff.split(',').at(-1)!.trim();
    if (isIP(last.replace(/^::ffff:/i, ''))) return last;
  }
  return peer;
}

/** Host names a request may use: localhost names, IP addresses and the hosts of allowed origins. */
function hostAllowed(hostname: string, opts: AccessOptions): boolean {
  if (isLoopbackHost(hostname) || isIP(hostname) !== 0) return true;
  return opts.allowedOrigins.some((o) => {
    try {
      return new URL(o).hostname === hostname;
    } catch {
      return false;
    }
  });
}

export function originAllowed(origin: string, host: string | undefined, opts: AccessOptions): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (opts.allowedOrigins.includes(u.origin)) return true;
  if (host && u.host === host.toLowerCase()) return true;
  return isLoopbackHost(u.hostname);
}

/**
 * Reason to refuse a request (HTTP or WebSocket upgrade), or null. write = it could change
 * something (uploads, WebSocket commands).
 *
 * Public mode (a password is set AND the server listens on the network): watching is open from any
 * host name and admin actions are gated by the token, so there is no host or origin restriction.
 * Otherwise (no password, or listening only on this computer) only localhost names, IP addresses
 * and allowed origins may connect, which keeps a foreign page or a DNS rebinding page away. Behind a
 * reverse proxy on the same machine, list the public origin in RUNROOM_ALLOWED_ORIGINS.
 */
export function refuseReason(req: IncomingMessage, opts: AccessOptions, auth: AdminAuth, write: boolean): string | null {
  if (auth.required && !isLoopbackHost(opts.bindHost)) return null;
  const host = req.headers.host;
  const hn = hostnameOf(host);
  if (!hn || !hostAllowed(hn, opts)) return 'unknown host';
  if (write) {
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin, host, opts)) return 'requests from other web sites are refused';
  }
  return null;
}
