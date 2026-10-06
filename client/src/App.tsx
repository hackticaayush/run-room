// RUN ROOM HUD. Every viewer renders the same server driven office; the HUD state here is
// local (which panel is open, who the camera follows).

import { useEffect, useState } from 'react';
import { AGENT_DEFS } from '@shared/agents';
import { OfficeView } from './components/OfficeView';
import { bridge } from './game/bridge';
import { send } from './net/socket';
import { useWorld, worldStore } from './net/store';
import { sound } from './audio/sound';
import { getSettings } from './settings';
import { PixelButton, PixelTabs } from './ui';
import { TopBar } from './hud/TopBar';
import { Roster } from './hud/Roster';
import { Terminal } from './hud/Terminal';
import { BottomBar } from './hud/BottomBar';
import { RunBox } from './hud/RunBox';
import { RunMonitor } from './hud/RunMonitor';
import { InputPrompt } from './hud/InputPrompt';
import { ResultModal } from './hud/ResultModal';
import { AgentDetail } from './hud/AgentDetail';
import { ErrorModal, Notices, RunConsent, SettingsModal } from './hud/Dialogs';
import { AuthGate, LoginModal } from './hud/Auth';
import { ui, useUi, type PanelTab } from './hud/uiState';
import './hud/hud.css';

function useNarrow(): boolean {
  // Below this width a 2x office canvas no longer fits next to both side panels.
  const query = '(max-width: 1599px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

let soundStarted = false;

export function App() {
  const modal = useUi((s) => s.modal);
  const followId = useUi((s) => s.followId);
  const panelTab = useUi((s) => s.panelTab);
  const narrow = useNarrow();
  const config = useWorld((s) => s.config);
  const authGateDone = useUi((s) => s.authGateDone);
  const showGate = Boolean(config?.passwordRequired && config.role === 'guest' && !authGateDone);
  // The agent detail card: open, folded to its bar, or closed (the phone layout pads for the bar).
  const detail = useUi((s) => (s.detailId === null ? undefined : s.detailCollapsed ? 'bar' : 'open'));

  useEffect(() => {
    if (!soundStarted) {
      soundStarted = true;
      sound.init();
    }
    const timers: number[] = [];
    const offs = [
      bridge.on('agentClicked', (id) => {
        ui.openDetail(id);
        if (getSettings().follow) ui.follow(id);
      }),
      bridge.on('monitorClicked', () => ui.pulseTerminal()),
      bridge.on('catClicked', () => {
        // Guests only watch: petting the cat is an admin action.
        if (worldStore.state.config?.role !== 'admin') return;
        send({ type: 'PET_CAT', payload: {} });
        sound.purr();
      }),
      worldStore.onEvent((e) => {
        if (e.type !== 'RESULT') return;
        const taskId = e.payload.taskId;
        // Let everyone see the confetti and XP coins first, then open the Result panel.
        timers.push(
          window.setTimeout(() => {
            if (ui.get().modal === null) ui.openResult(taskId);
            else worldStore.pushNotice('info', `RESULT ${taskId} READY - SEE RESULTS`);
          }, 2600),
        );
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const followName = followId ? (AGENT_DEFS.find((d) => d.id === followId)?.name ?? followId) : null;

  return (
    <div className={`app ${narrow ? 'is-narrow' : ''}`} data-tab={panelTab} data-detail={detail}>
      <TopBar />
      <aside className="app-left">
        <Roster />
        <RunMonitor />
      </aside>
      <main className="app-center">
        <OfficeView />
        <AgentDetail />
        <Notices />
        {followName && (
          <div className="follow-chip">
            <span>FOLLOW: {followName}</span>
            <PixelButton icon="close_x" aria-label="stop following" title="SHOW WHOLE OFFICE" onClick={() => ui.follow(null)} />
          </div>
        )}
      </main>
      <aside className="app-right">
        <Terminal />
      </aside>
      {narrow && (
        <nav className="app-tabs">
          <PixelTabs<PanelTab>
            label="panels"
            tabs={[
              { id: 'roster', label: 'CREW + RUN', icon: 'stack_layers' },
              { id: 'terminal', label: 'TERMINAL', icon: 'terminal' },
              { id: 'queue', label: 'QUEUE', icon: 'clipboard_task' },
            ]}
            value={panelTab}
            onChange={ui.setPanelTab}
          />
        </nav>
      )}
      <BottomBar />
      {modal === 'run' && <RunBox />}
      {modal === 'result' && <ResultModal />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'error' && <ErrorModal />}
      {modal === 'consent' && <RunConsent />}
      {modal === 'login' && <LoginModal />}
      <InputPrompt />
      {showGate && <AuthGate />}
    </div>
  );
}
