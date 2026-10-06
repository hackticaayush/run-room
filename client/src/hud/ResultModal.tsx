import type { ReactNode } from 'react';
import type { ResultInfo } from '@shared/types';
import { useWorld, worldStore } from '../net/store';
import { PixelButton, PixelModal, PixelScroll } from '../ui';
import { ui, useUi } from './uiState';

/** Light Markdown styling: headings, list items, quotes, table rows and code fences by line. */
function renderReport(md: string): ReactNode[] {
  let inFence = false;
  return md.split('\n').map((line, i) => {
    let cls = 'rp-line';
    if (line.startsWith('```')) {
      inFence = !inFence;
      cls += ' rp-fence';
    } else if (inFence) cls += ' rp-code';
    else if (line.startsWith('# ')) cls += ' rp-h1';
    else if (line.startsWith('## ') || line.startsWith('### ')) cls += ' rp-h2';
    else if (line.startsWith('> ')) cls += ' rp-quote';
    else if (line.startsWith('|')) cls += ' rp-table';
    else if (/^\s*(-|\d+\.)\s/.test(line)) cls += ' rp-item';
    else if (line.startsWith('---')) cls += ' rp-rule';
    return (
      <div key={i} className={cls}>
        {line || ' '}
      </div>
    );
  });
}

function download(r: ResultInfo): void {
  const blob = new Blob([r.report], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.taskId}-${r.codeName.replace(/[^A-Za-z0-9._-]+/g, '_')}-run.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const OUTCOME: Record<ResultInfo['outcome'], string> = { ok: 'OK', error: 'ERR', stopped: 'STOPPED', setup_failed: 'SETUP FAILED' };

export function ResultModal() {
  const results = useWorld((s) => s.results);
  const wanted = useUi((s) => s.resultId);
  const r = results.find((x) => x.taskId === wanted) ?? results[0];

  return (
    <PixelModal
      open
      title={r ? `RESULT ${r.taskId}: ${r.title}` : 'RESULTS'}
      icon={r ? (r.ok ? 'check_ok' : 'cross_error') : 'flag_done'}
      onClose={ui.closeModal}
      width={920}
      footer={
        r && (
          <>
            <PixelButton
              icon="copy"
              label="COPY"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(r.report);
                  worldStore.pushNotice('info', 'REPORT COPIED');
                } catch {
                  worldStore.pushNotice('warn', 'CLIPBOARD NOT AVAILABLE');
                }
              }}
            />
            <PixelButton icon="folder" label="SAVE REPORT" size="lg" onClick={() => download(r)} />
          </>
        )
      }
    >
      {!r ? (
        <p className="hud-dim">NO RESULTS YET. PRESS RUN PYTHON AND WATCH THE CREW RUN YOUR CODE.</p>
      ) : (
        <div className="result">
          <PixelScroll autoHide className="result-list">
            <nav className="result-picks" aria-label="past results">
              {results.map((x) => (
                <button key={x.taskId} type="button" className={`result-pick ${x.taskId === r.taskId ? 'is-active' : ''}`} onClick={() => ui.openResult(x.taskId)}>
                  <span className={x.ok ? 'hud-ok' : 'hud-err'}>{x.ok ? 'OK ' : x.outcome === 'stopped' ? 'STP' : 'ERR'}</span> {x.taskId}
                  <div className="result-pick-title">{x.title}</div>
                </button>
              ))}
            </nav>
          </PixelScroll>
          <section className="result-main">
            <dl className="result-meta">
              <dt>STATUS</dt>
              <dd className={r.ok ? 'hud-ok' : 'hud-err'}>{OUTCOME[r.outcome]}</dd>
              <dt>EXIT CODE</dt>
              <dd>{r.exitCode ?? '-'}</dd>
              <dt>CODE</dt>
              <dd>{r.projectName ? `${r.projectName} (SAVED)` : r.codeName}</dd>
              <dt>COMMAND</dt>
              <dd className="result-cmd">{r.command}</dd>
              <dt>TIME</dt>
              <dd>{(r.runtimeMs / 1000).toFixed(2)} S</dd>
              <dt>CALLS</dt>
              <dd>{r.calls}</dd>
              <dt>OUTPUT</dt>
              <dd>{r.outputLines} LINES</dd>
            </dl>
            <div className="result-summary">{r.summary}</div>
            <div className="result-report">
              <PixelScroll>
                <div className="rp">{renderReport(r.report)}</div>
              </PixelScroll>
            </div>
          </section>
        </div>
      )}
    </PixelModal>
  );
}
