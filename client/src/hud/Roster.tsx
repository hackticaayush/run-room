import { AGENT_DEFS, STATE_WORD, xpForLevel } from '@shared/agents';
import type { AgentState } from '@shared/types';
import type { PortraitKey } from '../assets/manifest';
import { useWorld } from '../net/store';
import { MoodFace, PixelButton, PixelIcon, PixelNumber, PixelPanel, PixelProgress, Portrait } from '../ui';
import { ui, useUi } from './uiState';

function AgentCard({ agent }: { agent: AgentState }) {
  const def = AGENT_DEFS.find((d) => d.id === agent.agentId);
  const following = useUi((s) => s.followId === agent.agentId);
  const task = useWorld((s) => (agent.taskId ? s.tasks.find((t) => t.id === agent.taskId) : undefined));
  const nextLevelXp = xpForLevel(agent.level + 1);
  const thisLevelXp = xpForLevel(agent.level);
  const xpProgress = (agent.xp - thisLevelXp) / Math.max(1, nextLevelXp - thisLevelXp);
  return (
    <div
      className={`agent-card ${following ? 'is-following' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        ui.openDetail(agent.agentId);
        ui.follow(agent.agentId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ui.openDetail(agent.agentId);
      }}
      style={{ ['--accent' as string]: `var(${def?.accent ?? '--c-cyan-2'})` }}
    >
      <div className="agent-card-portrait">
        <Portrait who={(def?.portrait ?? agent.agentId) as PortraitKey} scale={2} />
        <PixelButton
          icon="crosshair_follow"
          active={following}
          title={following ? 'STOP FOLLOWING' : 'FOLLOW WITH CAMERA'}
          aria-label="follow"
          onClick={(e) => {
            e.stopPropagation();
            ui.toggleFollow(agent.agentId);
          }}
        />
      </div>
      <div className="agent-card-body">
        <div className="agent-card-head">
          <span className="agent-name">{agent.name}</span>
          <span className={`agent-state state-${agent.state}`} title={agent.state.toUpperCase()}>
            {STATE_WORD[agent.state]}
          </span>
        </div>
        <div className="agent-role">{agent.role}</div>
        <div className="agent-card-row">
          <MoodFace mood={agent.mood} size={1} />
          <span className="agent-mood">{agent.mood.toUpperCase()}</span>
        </div>
        <div className="agent-card-row" title={`ENERGY ${agent.energy}`}>
          <PixelIcon name="bolt_energy" size={1} />
          <PixelProgress value={agent.energy / 100} height={14} scale={1} style={{ flex: 1 }} />
          <PixelNumber value={agent.energy} size={1} />
        </div>
        <div className="agent-card-row" title={`XP ${agent.xp} / NEXT LEVEL ${nextLevelXp}`}>
          <PixelIcon name="star_xp" size={1} />
          <span className="agent-lvl">LVL</span>
          <PixelNumber value={agent.level} size={1} />
          <PixelProgress value={xpProgress} height={14} scale={1} style={{ flex: 1 }} />
          <PixelNumber value={agent.xp} size={1} />
        </div>
        <div className="agent-activity">
          {'-> '}
          {agent.activity}
          {task ? ` [${task.id}]` : ''}
        </div>
      </div>
    </div>
  );
}

export function Roster() {
  const agents = useWorld((s) => s.agents);
  const order = useWorld((s) => s.agentOrder);
  return (
    <PixelPanel title="ROSTER" icon="eye" className="hud-roster">
      <div className="roster-list">
        {order.length === 0 && <div className="hud-dim">WAITING FOR THE SERVER...</div>}
        {order.map((id) => agents[id] && <AgentCard key={id} agent={agents[id]} />)}
      </div>
      <div className="roster-hint hud-dim">CLICK A CARD OR AN AGENT TO FOLLOW</div>
    </PixelPanel>
  );
}
