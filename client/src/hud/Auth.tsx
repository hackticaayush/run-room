// Guest / admin access. When the server has an admin password, the first screen asks how to enter:
// WATCH AS GUEST (watch only) or the admin password (full access). The same login form is reachable
// later from the ADMIN button in the top bar. No links, QR codes or device checks are involved.

import { useState } from 'react';
import { login } from '../net/access';
import { chromeStyle, PixelButton, PixelIcon, PixelInput } from '../ui';
import { ui } from './uiState';

/** Password field + submit. onDone runs after a successful login. */
function LoginForm({ onDone }: { onDone?: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(pw);
      onDone?.();
    } catch (e) {
      setError((e as Error).message.toUpperCase());
      setBusy(false);
      setPw('');
    }
  };

  return (
    <form
      className="login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="taskbox-label" htmlFor="admin-pw">
        <PixelIcon name="lock" size={1} /> ADMIN PASSWORD
      </label>
      <PixelInput
        id="admin-pw"
        type="password"
        value={pw}
        autoFocus
        frameStyle={{ width: '100%' }}
        placeholder="password"
        aria-label="admin password"
        disabled={busy}
        onChange={(e) => setPw(e.target.value)}
      />
      {error && (
        <div className="runbox-field-error" role="alert">
          {error}
        </div>
      )}
      <PixelButton type="submit" icon="lock" label={busy ? 'CHECKING...' : 'ENTER AS ADMIN'} size="lg" tone="accent" disabled={!pw || busy} />
    </form>
  );
}

/** The full-screen entry screen, shown once when a password is set and this viewer is a guest. */
export function AuthGate() {
  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-label="choose how to enter RUN ROOM">
      <div className="auth-gate-box" style={chromeStyle('modal_frame')}>
        <PixelIcon name="lock" size={3} />
        <h1 className="auth-gate-title">RUN ROOM</h1>
        <p>RUN YOUR OWN PYTHON IN A LIVE PIXEL OFFICE. CHOOSE HOW TO ENTER.</p>
        <LoginForm />
        <div className="auth-or">OR</div>
        <PixelButton icon="eye" label="WATCH AS GUEST" onClick={ui.enterAsGuest} />
        <p className="hud-dim">GUESTS WATCH EVERYTHING. ADMIN CAN UPLOAD, RUN AND CONTROL THE OFFICE.</p>
      </div>
    </div>
  );
}

/** The ADMIN button in the top bar opens this. */
export function LoginModal() {
  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-label="admin access">
      <div className="auth-gate-box" style={chromeStyle('modal_frame')}>
        <PixelIcon name="lock" size={3} />
        <h1 className="auth-gate-title">ADMIN ACCESS</h1>
        <p>ENTER THE ADMIN PASSWORD FOR FULL ACCESS: UPLOAD AND RUN PYTHON, SAVE PROJECTS AND CONTROL THE OFFICE.</p>
        <LoginForm onDone={ui.closeModal} />
        <PixelButton label="CANCEL" onClick={ui.closeModal} />
        <p className="hud-dim">WITHOUT THE PASSWORD YOU WATCH AS A GUEST.</p>
      </div>
    </div>
  );
}
