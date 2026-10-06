import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './styles/palette.generated.css';
import './styles/global.css';
import './styles/pixel.css';
import { createRoot } from 'react-dom/client';
import { sampleMove } from '@shared/motion';
import { App } from './App';
import { AssetsTest } from './pages/AssetsTest';
import { connect } from './net/socket';
import { initAuth } from './net/access';
import { worldStore, type WorldStore } from './net/store';
import { installTheme } from './ui/theme';

interface DebugHandle {
  store: WorldStore;
  /** Where every agent is drawn right now (tile coordinates), computed like the renderer does. */
  positions(): Record<string, { x: number; y: number; state: string; anim: string; sim: number }>;
}

declare global {
  interface Window {
    /** Dev-only debug handle used by automated two-tab checks. */
    __runroom?: DebugHandle;
  }
}

installTheme();

const path = location.pathname.replace(/\/+$/, '');
const root = createRoot(document.getElementById('root')!);

if (path === '/assets-test') {
  root.render(<AssetsTest />);
} else {
  if (import.meta.env.DEV) {
    window.__runroom = {
      store: worldStore,
      positions: () => {
        const now = worldStore.simNow();
        const out: ReturnType<DebugHandle['positions']> = {};
        for (const a of Object.values(worldStore.state.agents)) {
          const s = a.move ? sampleMove(a.move, now, a.facing) : null;
          out[a.agentId] = { x: s ? s.x : a.x, y: s ? s.y : a.y, state: a.state, anim: a.anim, sim: Math.round(now) };
        }
        return out;
      },
    };
  }
  initAuth();
  connect();
  root.render(<App />);
}
