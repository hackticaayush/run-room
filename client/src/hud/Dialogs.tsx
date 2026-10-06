// Settings, the one-time run consent, error message and toast notices.

import { useEffect } from 'react';
import { ALLOWED_SPEEDS } from '@shared/events';
import { send } from '../net/socket';
import { useWorld, worldStore } from '../net/store';
import { DEFAULT_SETTINGS, updateSettings, useSettings, type Settings } from '../settings';
import { PixelButton, PixelCheckbox, PixelIcon, PixelModal } from '../ui';
import { ui, useUi } from './uiState';

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'crt', label: 'CRT FILTER', hint: 'scanlines, vignette and a slight flicker over the office' },
  { key: 'night', label: 'NIGHT MODE', hint: 'darker room, screens and neon glow brighter' },
  { key: 'sound', label: 'SOUND', hint: 'generated keyboard clacks, ambience, ding and buzzer' },
  { key: 'follow', label: 'CAMERA FOLLOW', hint: 'clicking an agent zooms in and follows it' },
  { key: 'debugGrid', label: 'SHOW GRID / DEBUG', hint: 'collision grid and station markers' },
  { key: 'typewriter', label: 'TYPEWRITER TERMINAL', hint: 'new terminal lines type themselves out' },
];

export function SettingsModal() {
  const s = useSettings();
  const speed = useWorld(() => worldStore.clock.speedMultiplier);
  return (
    <PixelModal
      open
      title="SETTINGS"
      icon="settings"
      onClose={ui.closeModal}
      width={560}
      footer={
        <>
          <PixelButton icon="arrow_left" label="DEFAULTS" onClick={() => updateSettings(DEFAULT_SETTINGS)} />
          <PixelButton icon="check_ok" label="DONE" onClick={ui.closeModal} />
        </>
      }
    >
      <div className="settings">
        {TOGGLES.map((t) => (
          <div key={t.key} className="settings-row">
            <PixelCheckbox
              checked={s[t.key]}
              onChange={(v) => {
                updateSettings({ [t.key]: v });
                if (t.key === 'follow' && !v) ui.follow(null);
              }}
              label={
                <>
                  {t.key === 'sound' && <PixelIcon name={s.sound ? 'speaker_on' : 'speaker_off'} size={1} />} {t.label}
                </>
              }
            />
            <div className="settings-hint">{t.hint}</div>
          </div>
        ))}
        <div className="settings-row">
          <div className="settings-speed">
            <span>SIM SPEED</span>
            {ALLOWED_SPEEDS.map((m) => (
              <PixelButton key={m} label={`${m}X`} active={speed === m} onClick={() => send({ type: 'SET_SPEED', payload: { multiplier: m } })} />
            ))}
          </div>
          <div className="settings-hint">shared by every viewer: the simulation runs on the server</div>
        </div>
        <div className="settings-hint">SAVED IN THIS BROWSER (LOCALSTORAGE).</div>
      </div>
    </PixelModal>
  );
}

/** Asked once per browser before the first run. */
export function RunConsent() {
  return (
    <PixelModal
      open
      title="RUN PYTHON ON THIS COMPUTER?"
      icon="warning_siren"
      onClose={() => ui.answerConsent(false)}
      width={640}
      footer={
        <>
          <PixelButton label="CANCEL" onClick={() => ui.answerConsent(false)} />
          <PixelButton icon="play" label="I UNDERSTAND, RUN IT" tone="danger" size="lg" onClick={() => ui.answerConsent(true)} />
        </>
      }
    >
      <div className="sandbox-warning">
        <p>
          RUN ROOM runs your Python code <strong>ON THE COMPUTER THAT RUNS THE RUN ROOM SERVER</strong>, as a normal program with your own user
          rights. If you started the server yourself, that is <strong>YOUR OWN MACHINE</strong>.
        </p>
        <p className="hud-err">THIS IS NOT A SECURITY SANDBOX.</p>
        <p>
          The program can read and change anything your account can, use the network and start other programs. Setup commands install packages from
          the internet into a private virtual environment of the project. Only run code you wrote yourself or fully trust.
        </p>
        <p className="hud-dim">This browser remembers your answer. Full access (running code) needs the admin password.</p>
      </div>
    </PixelModal>
  );
}

export function ErrorModal() {
  const text = useUi((s) => s.errorText);
  return (
    <PixelModal open title="REJECTED" icon="cross_error" onClose={ui.closeModal} width={520} footer={<PixelButton icon="check_ok" label="OK" onClick={ui.closeModal} />}>
      <p className="error-text">{text}</p>
    </PixelModal>
  );
}

/** Toasts for server notices and local messages. Auto dismiss after 5 s. */
export function Notices() {
  const notices = useWorld((s) => s.notices);
  useEffect(() => {
    const timers = notices.map((n) => window.setTimeout(() => worldStore.dismissNotice(n.id), 5000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [notices]);
  if (!notices.length) return null;
  return (
    <div className="notices" role="status">
      {notices.map((n) => (
        <button key={n.id} type="button" className={`notice notice-${n.level}`} onClick={() => worldStore.dismissNotice(n.id)}>
          <PixelIcon name={n.level === 'error' ? 'cross_error' : n.level === 'warn' ? 'warning_siren' : 'check_ok'} size={1} />
          <span>{n.text.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
