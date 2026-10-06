import { ALLOWED_SPEEDS } from '@shared/events';
import { send } from '../net/socket';
import { logout } from '../net/access';
import { useWorld, worldStore } from '../net/store';
import { updateSettings, useSettings } from '../settings';
import { PixelButton, PixelIcon, PixelNumber } from '../ui';
import { hhmmss, simTime, useNow } from './useNow';
import { ui } from './uiState';

export function TopBar() {
  const connected = useWorld((s) => s.connected);
  const clients = useWorld((s) => s.clients);
  const passwordRequired = useWorld((s) => Boolean(s.config?.passwordRequired));
  const admin = useWorld((s) => s.config?.role === 'admin');
  const paused = useWorld(() => worldStore.clock.isPaused);
  const speed = useWorld(() => worldStore.clock.speedMultiplier);
  const settings = useSettings();
  const [wall, sim] = useNow(500);

  return (
    <header className="hud-top">
      <h1 className="glitch" data-text="RUN ROOM">
        RUN ROOM
      </h1>
      <div className="hud-top-item hud-top-clock" title="LOCAL TIME / SIM CLOCK">
        <PixelIcon name="clock" size={1} />
        <span>{hhmmss(wall)}</span>
        <span className="hud-dim">SIM {simTime(sim)}</span>
      </div>
      <div className="hud-top-item" title={connected ? 'CONNECTED TO THE SIMULATION SERVER' : 'RECONNECTING'}>
        <PixelIcon name={connected ? 'led_on' : 'led_off'} size={1} />
        <span className={connected ? 'hud-ok' : 'hud-err'}>LINK {connected ? 'OK' : 'ERR'}</span>
        <PixelIcon name="eye" size={1} title="VIEWERS" />
        <PixelNumber value={clients} size={1} />
      </div>
      <div className="hud-top-spacer" />
      <div className="hud-top-controls">
        {admin && <PixelButton icon="play" label="RUN PYTHON" className="hud-top-newtask" onClick={() => ui.openRunBox()} />}
        {admin && (
          <PixelButton
            icon={paused ? 'play' : 'pause'}
            title={paused ? 'RESUME (SHARED)' : 'PAUSE (SHARED)'}
            aria-label={paused ? 'resume' : 'pause'}
            onClick={() => send({ type: paused ? 'RESUME' : 'PAUSE', payload: {} })}
          />
        )}
        {admin &&
          ALLOWED_SPEEDS.map((m) => (
            <PixelButton
              key={m}
              icon={m === 1 ? undefined : 'fast_forward'}
              label={`${m}X`}
              active={speed === m}
              title={`SIM SPEED ${m}X (SHARED)`}
              onClick={() => send({ type: 'SET_SPEED', payload: { multiplier: m } })}
            />
          ))}
        {admin && <PixelButton icon="coffee_cup" title="SEND BYTE FOR COFFEE" aria-label="coffee" onClick={() => send({ type: 'GIVE_COFFEE', payload: {} })} />}
        <PixelButton
          icon={settings.sound ? 'speaker_on' : 'speaker_off'}
          title={settings.sound ? 'SOUND ON' : 'SOUND OFF'}
          aria-label="sound"
          active={settings.sound}
          onClick={() => updateSettings({ sound: !settings.sound })}
        />
        {passwordRequired &&
          (admin ? (
            <PixelButton icon="lock" label="LOG OUT" title="DROP ADMIN ACCESS (WATCH AS A GUEST)" onClick={() => void logout()} />
          ) : (
            <PixelButton icon="lock" label="ADMIN" title="ENTER THE ADMIN PASSWORD FOR FULL ACCESS" onClick={ui.openLogin} />
          ))}
        <PixelButton icon="settings" title="SETTINGS" aria-label="settings" onClick={ui.openSettings} />
      </div>
    </header>
  );
}
