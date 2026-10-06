import { useEffect, useState } from 'react';
import { AGENT_DEFS, STATE_WORD } from '@shared/agents';
import type { PortraitKey } from '../assets/manifest';
import { useWorld } from '../net/store';
import { MoodFace, PixelButton, PixelNumber, PixelPanel, PixelProgress, PixelScroll, Portrait } from '../ui';
import { simTime } from './useNow';
import { ui, useUi } from './uiState';

/**
 * True where the card is a bottom sheet: phones, and short narrow screens such as a phone held
 * sideways. Must match the media query of the bottom sheet block in hud.css.
 */
function useBottomSheet(): boolean {
  const query = '(max-width: 760px), (max-width: 1599px) and (max-height: 500px)';
  const [sheet, setSheet] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setSheet(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return sheet;
}

/**
 * Detail card for the clicked agent (the camera follows it meanwhile). It floats over the office,
 * or slides up from the bottom on phones; the arrow folds it away to its title bar and back.
 */
export function AgentDetail() {
  const id = useUi((s) => s.detailId);
  const collapsed = useUi((s) => s.detailCollapsed);
  const sheet = useBottomSheet();
  const agent = useWorld((s) => (id ? s.agents[id] : undefined));
  const task = useWorld((s) => (agent?.taskId ? s.tasks.find((t) => t.id === agent.taskId) : undefined));
  if (!id || !agent) return null;
  const def = AGENT_DEFS.find((d) => d.id === id);
  // The arrow points where the card goes: the phone sheet folds down, the floating card folds up.
  const arrow = sheet ? (collapsed ? 'arrow_up' : 'arrow_down') : collapsed ? 'arrow_down' : 'arrow_up';
  return (
    <PixelPanel
      className={`agent-detail ${collapsed ? 'is-collapsed' : ''}`}
      title={`${agent.name} DETAIL`}
      icon="crosshair_follow"
      actions={
        <>
          <PixelButton
            icon={arrow}
            aria-label={collapsed ? 'expand' : 'collapse'}
            aria-expanded={!collapsed}
            title={collapsed ? 'SHOW DETAILS' : 'HIDE DETAILS'}
            onClick={() => ui.setDetailCollapsed(!collapsed)}
          />
          <PixelButton
            icon="close_x"
            aria-label="close"
            title="CLOSE"
            onClick={() => {
              ui.openDetail(null);
              ui.follow(null);
            }}
          />
        </>
      }
    >
      <PixelScroll autoHide className="agent-detail-body">
        <div className="detail-top">
          <Portrait who={(def?.portrait ?? id) as PortraitKey} scale={2} />
          <dl className="detail-grid">
            <dt>STATE</dt>
            <dd>
              {STATE_WORD[agent.state]} <span className="hud-dim">{agent.activity}</span>
            </dd>
            <dt>TASK</dt>
            <dd>{task ? `${task.id} ${task.title}` : 'NONE'}</dd>
            <dt>MOOD</dt>
            <dd className="detail-inline">
              <MoodFace mood={agent.mood} size={1} /> {agent.mood.toUpperCase()}
            </dd>
            <dt>ENERGY</dt>
            <dd className="detail-inline">
              <PixelProgress value={agent.energy / 100} height={14} scale={1} style={{ width: 90 }} />
              <PixelNumber value={agent.energy} size={1} />
            </dd>
            <dt>XP</dt>
            <dd className="detail-inline">
              <PixelNumber value={agent.xp} size={1} /> LVL <PixelNumber value={agent.level} size={1} />
            </dd>
            <dt>AT</dt>
            <dd>{agent.station ?? `${agent.x},${agent.y}`}</dd>
          </dl>
        </div>
        <div className="detail-history-title">LAST 10 ACTIONS</div>
        <ol className="detail-history">
          {[...agent.history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <span className="hud-dim">{simTime(h.at)}</span> {h.text}
            </li>
          ))}
          {agent.history.length === 0 && <li className="hud-dim">NOTHING YET</li>}
        </ol>
      </PixelScroll>
    </PixelPanel>
  );
}
