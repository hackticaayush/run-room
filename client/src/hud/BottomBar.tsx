import { VISIBLE_TASK_STEPS, type TaskInfo, type TaskStatus } from '@shared/types';
import { send } from '../net/socket';
import { useWorld } from '../net/store';
import { PixelButton, PixelIcon, PixelNumber, PixelProgress, PixelScroll } from '../ui';
import { ui } from './uiState';

const STATUS_WORD: Record<TaskStatus, string> = {
  queued: 'WAIT',
  active: 'RUN',
  done: 'OK',
  failed: 'ERR',
  cancelled: 'STOPPED',
};

const STEP_LABEL: Record<string, string> = {
  INTAKE: 'INTAKE',
  HANDOVER: 'HANDOV',
  SETUP: 'SETUP',
  RUN: 'RUN',
  DELIVER: 'DELIVR',
};

function TaskRow({ t, hasResult, canRun }: { t: TaskInfo; hasResult: boolean; canRun: boolean }) {
  const live = t.status === 'queued' || t.status === 'active';
  const running = t.status === 'active' && t.stepIndex === VISIBLE_TASK_STEPS.indexOf('RUN');
  const finished = !live;
  const status = t.status === 'active' && t.note ? t.note : finished && t.note ? t.note : STATUS_WORD[t.status];
  return (
    <div className={`task-row status-${t.status}`}>
      <span className="task-id">{t.id}</span>
      <span className={`task-prio prio-${t.priority}`}>{t.priority}</span>
      <span className="task-title" title={`${t.codeName}: ${t.run}${t.setup.length ? ` (setup: ${t.setup.join(' / ')})` : ''}`}>
        <PixelIcon name={t.projectId ? 'save_disk' : t.codeKind === 'folder' ? 'folder' : 'file_code'} size={1} /> {t.projectName ?? t.codeName}
        <span className="task-cmd"> {t.run}</span>
      </span>
      <div className="task-steps">
        {VISIBLE_TASK_STEPS.map((step, i) => (
          <div key={step} className={`task-step ${t.status === 'active' && i === t.stepIndex ? 'is-current' : ''}`} title={`${step} ${Math.round((t.stepProgress[i] ?? 0) * 100)}%`}>
            <PixelProgress value={t.stepProgress[i] ?? 0} height={12} scale={1} />
            <span className="task-step-label">{step === 'SETUP' && t.setup.length === 0 ? 'NO SET' : step === 'SETUP' && t.setupCached ? 'CACHED' : STEP_LABEL[step]}</span>
          </div>
        ))}
      </div>
      <span className={`task-status status-word-${t.status}`} title={`STATUS ${status}`}>
        {status}
        {finished && t.exitCode !== null && <span className="task-exit"> EXIT {t.exitCode}</span>}
      </span>
      {live && canRun && (
        <PixelButton
          icon={running ? 'stop_square' : 'close_x'}
          label={running ? 'STOP' : 'CANCEL'}
          tone="danger"
          title={`${running ? 'STOP' : 'CANCEL'} ${t.id}`}
          onClick={() => send({ type: 'CANCEL_TASK', payload: { taskId: t.id } })}
        />
      )}
      {!live && hasResult && <PixelButton icon="eye" label="VIEW" title="OPEN RESULT" onClick={() => ui.openResult(t.id)} />}
    </div>
  );
}

export function BottomBar() {
  const tasks = useWorld((s) => s.tasks);
  const results = useWorld((s) => s.results);
  const projects = useWorld((s) => s.projects);
  const canRun = useWorld((s) => Boolean(s.config?.canRun));
  // Guests only watch: no RUN PYTHON for them (same rule as the top bar).
  const admin = useWorld((s) => s.config?.role === 'admin');
  const resultIds = new Set(results.map((r) => r.taskId));
  const quick = projects.slice(0, 3);
  return (
    <footer className="hud-bottom">
      <div className="queue">
        <div className="queue-title">
          <PixelIcon name="clipboard_task" size={1} /> RUN QUEUE
          <span className="px-spacer" />
          {canRun && quick.length > 0 && (
            <span className="quick-runs">
              <span className="hud-dim">ONE CLICK:</span>
              {quick.map((p) => (
                <PixelButton
                  key={p.id}
                  icon="play"
                  label={p.name.length > 14 ? `${p.name.slice(0, 13)}.` : p.name}
                  title={`RUN ${p.name}: ${p.run}`}
                  onClick={() => ui.withRunConsent(() => send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'project', projectId: p.id }, priority: 'NORMAL' } }))}
                />
              ))}
            </span>
          )}
        </div>
        <PixelScroll autoHide className="queue-scroll">
          <div className="queue-list">
            {tasks.length === 0 && (
              <div className="queue-empty">{admin ? 'QUEUE EMPTY - PRESS RUN PYTHON, PICK A .PY FILE OR A PROJECT FOLDER, TYPE THE RUN COMMAND' : 'QUEUE EMPTY'}</div>
            )}
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} hasResult={resultIds.has(t.id)} canRun={canRun} />
            ))}
          </div>
        </PixelScroll>
      </div>
      <div className="hud-bottom-actions">
        {admin && <PixelButton icon="play" label="RUN PYTHON" size="lg" tone="accent" onClick={() => ui.openRunBox()} />}
        <PixelButton icon="save_disk" label="PROJECTS" onClick={() => ui.openRunBox('saved')}>
          <PixelNumber value={projects.length} size={1} />
        </PixelButton>
        <PixelButton icon="flag_done" label="RESULTS" onClick={() => ui.openResult(results[0]?.taskId ?? null)}>
          <PixelNumber value={results.length} size={1} />
        </PixelButton>
      </div>
    </footer>
  );
}
