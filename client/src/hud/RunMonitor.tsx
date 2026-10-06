// RUN MONITOR: what the running program is doing right now, from the tracing harness. Current
// function and line, the call stack, the last values returned (with their type and the declared
// return type), the busiest functions, counters. Shared by every viewer (RUN_STATE events).

import type { ReactNode } from 'react';
import type { RunState } from '@shared/types';
import { useWorld } from '../net/store';
import { PixelIcon, PixelPanel, PixelScroll } from '../ui';
import { useNow } from './useNow';

const fnName = (fn: string) => (fn === '<module>' ? 'top level' : fn);

function statusOf(run: RunState): { word: string; cls: string } {
  if (run.phase === 'starting') return { word: 'GETTING READY', cls: 'hud-dim' };
  if (run.phase === 'setup') return { word: 'SETUP', cls: 'mon-busy' };
  if (run.phase === 'run') return run.waitingInput ? { word: 'WAITS FOR INPUT', cls: 'mon-wait' } : { word: 'RUNNING', cls: 'mon-busy' };
  if (run.outcome === 'ok') return { word: 'EXIT 0 OK', cls: 'hud-ok' };
  if (run.outcome === 'stopped') return { word: 'STOPPED', cls: 'mon-wait' };
  if (run.outcome === 'setup_failed') return { word: 'SETUP FAILED', cls: 'hud-err' };
  return { word: `EXIT ${run.exitCode ?? '?'} ERR`, cls: 'hud-err' };
}

/** The monitor panel. On a short screen its content scrolls (pixel scrollbar) instead of being cut off. */
function MonitorPanel({ children }: { children: ReactNode }) {
  return (
    <PixelPanel title="RUN MONITOR" icon="stack_layers" className="hud-monitor">
      <PixelScroll autoHide className="mon-scroll">
        <div className="mon-body">{children}</div>
      </PixelScroll>
    </PixelPanel>
  );
}

export function RunMonitor() {
  const run = useWorld((s) => s.run);
  const [now] = useNow(250);
  if (!run) {
    return (
      <MonitorPanel>
        <div className="mon-empty hud-dim">NO PROGRAM HAS RUN YET. PRESS RUN PYTHON.</div>
      </MonitorPanel>
    );
  }
  const st = statusOf(run);
  const secs = Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000);
  const stack = [...run.stack].reverse().slice(0, 6);
  const returns = [...run.lastReturns].reverse().slice(0, 4);
  return (
    <MonitorPanel>
      <div className="mon-head">
        <span className="mon-task">{run.taskId}</span>
        <span className="mon-code" title={run.codeName}>
          {run.codeName}
        </span>
      </div>
      <div className="mon-status">
        <span className={st.cls}>{st.word}</span>
        <span className="hud-dim">{run.phase === 'starting' ? '' : `${secs.toFixed(1)}S`}</span>
      </div>
      <div className="mon-cmd" title={run.command}>
        {'$ '}
        {run.command}
      </div>

      {run.phase === 'run' || run.phase === 'done' ? (
        <>
          <div className="mon-label">
            <PixelIcon name="func_call" size={1} /> NOW
          </div>
          <div className="mon-now" title={run.current ? `${run.current.fn} ${run.current.file}:${run.current.line}` : ''}>
            {run.current ? (
              <>
                {fnName(run.current.fn)}
                {run.current.fn === '<module>' ? '' : '()'} <span className="hud-dim">{`${run.current.file}:${run.current.line}`}</span>
              </>
            ) : (
              <span className="hud-dim">-</span>
            )}
          </div>
          {stack.length > 1 && (
            <>
              <div className="mon-label">CALL STACK</div>
              <ol className="mon-stack">
                {stack.map((f, i) => (
                  <li key={i} style={{ paddingLeft: Math.min(5, i) * 6 }} title={`${f.fn} ${f.file}:${f.line}`}>
                    {i === 0 ? '> ' : '  '}
                    {fnName(f.fn)} <span className="hud-dim">:{f.line}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {returns.length > 0 && (
            <>
              <div className="mon-label">RETURNED</div>
              <ul className="mon-returns">
                {returns.map((r, i) => {
                  const mismatch = r.declared !== null && r.declared !== r.type && !r.declared.includes(r.type);
                  return (
                    <li key={i} title={`${r.fn} -> ${r.type} ${r.value}${r.declared ? ` (declared ${r.declared})` : ''}`}>
                      {fnName(r.fn)} <span className="mon-arrow">{r.yielded ? 'YIELD' : '->'}</span> <span className={mismatch ? 'mon-mismatch' : 'mon-type'}>{r.type}</span>{' '}
                      {r.type !== 'None' && <span className="hud-dim">{r.value}</span>}
                      {mismatch && <span className="mon-mismatch"> (DECLARED {r.declared})</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {run.top.length > 0 && (
            <>
              <div className="mon-label">FUNCTIONS</div>
              <ul className="mon-top">
                {run.top.slice(0, 4).map((f, i) => (
                  <li key={i} title={`${f.fn} in ${f.file}: ${f.calls} call(s), returned ${f.types.join(', ') || '-'}${f.declared ? `, declared ${f.declared}` : ''}`}>
                    {fnName(f.fn)} <span className="hud-dim">x{f.calls}</span> <span className="mon-type">{f.types.join('|') || '-'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {run.exception && (
            <div className="mon-exc" title={run.exception.message}>
              <PixelIcon name="cross_error" size={1} /> {run.exception.type}: {run.exception.message}
              {run.exception.fn ? ` (${fnName(run.exception.fn)}${run.exception.line ? ` line ${run.exception.line}` : ''})` : ''}
            </div>
          )}
          <div className="mon-counts">
            <span title="FUNCTION CALLS TRACED">CALLS {run.calls}</span>
            <span title="OUTPUT LINES">OUT {run.stdoutLines}</span>
            {run.stderrLines > 0 && <span className="hud-err">ERR {run.stderrLines}</span>}
            {run.inputs > 0 && <span>IN {run.inputs}</span>}
          </div>
          <div className="mon-foot hud-dim">
            {run.python ?? ''} {run.traceMode !== '-' ? `TRACE ${run.traceMode.toUpperCase()}` : ''}
          </div>
        </>
      ) : run.phase === 'setup' ? (
        <div className="mon-setup">
          <PixelIcon name="package_box" size={2} /> BYTE INSTALLS THE DEPENDENCIES AT THE SERVER RACKS.
        </div>
      ) : (
        <div className="mon-setup hud-dim">GHOST HEADS TO HIS PC. THE PROGRAM STARTS ONCE HE SITS DOWN.</div>
      )}
    </MonitorPanel>
  );
}
