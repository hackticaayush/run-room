// RUN PYTHON: pick ONE FILE or a PROJECT FOLDER (uploaded right away, so the box can suggest the
// run command and a pip setup line), type optional setup commands and the run command, optionally
// SAVE AS a project. SAVED lists the saved projects for one click runs.
// Commands are checked here with the same rules the server uses (shared/commands.ts).

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { defaultRunCommand, normalizeSetupLines, parseCommand, parseSetup } from '@shared/commands';
import { MAX_COMMAND_LENGTH, MAX_FILE_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, MAX_PROJECT_NAME, MAX_SETUP_LINES } from '@shared/constants';
import { formatBytes } from '@shared/display';
import { PRIORITIES, type Priority, type ProjectInfo } from '@shared/types';
import { checkPythonFile, checkZipFile, selectFolder, uploadFile, uploadFolder, uploadZip, type UploadSummary } from '../net/api';
import { send } from '../net/socket';
import { useWorld, worldStore } from '../net/store';
import { PixelButton, PixelCheckbox, PixelIcon, PixelInput, PixelModal, PixelTabs, PixelTextArea } from '../ui';
import { ui, useUi, type RunTab } from './uiState';

/** The form survives closing and reopening the box (not a page reload). */
interface Draft {
  tab: RunTab;
  upload: UploadSummary | null;
  setup: string;
  run: string;
  saveAs: string;
  overwrite: boolean;
  priority: Priority;
}

const EMPTY: Draft = { tab: 'file', upload: null, setup: '', run: '', saveAs: '', overwrite: false, priority: 'NORMAL' };
let draft: Draft = { ...EMPTY };

const kb = (n: number) => formatBytes(n);

function checkCommands(setup: string, run: string) {
  const r = run.trim() ? parseCommand(run, 'run') : { error: 'type the run command, e.g. python main.py' };
  const s = parseSetup(setup);
  return { run: r, runError: 'error' in r ? r.error : null, setupError: 'error' in s ? s.error : null };
}

export function RunBox() {
  const config = useWorld((s) => s.config);
  const projects = useWorld((s) => s.projects);
  const startTab = useUi((s) => s.runTab);
  const [d, setD] = useState<Draft>(() => ({ ...draft, tab: startTab ?? (draft.upload ? draft.tab : projects.length ? 'saved' : draft.tab) }));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  // Phones and tablets cannot pick folders: they upload the project as a .zip instead.
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const canRun = Boolean(config?.canRun);

  const update = (patch: Partial<Draft>) =>
    setD((cur) => {
      const next = { ...cur, ...patch };
      draft = next;
      return next;
    });

  useEffect(() => {
    // Folder picking is not in the JSX types; set the attributes by hand.
    folderInput.current?.setAttribute('webkitdirectory', '');
    folderInput.current?.setAttribute('directory', '');
  }, [d.tab]);

  const upload = d.upload && d.upload.kind === d.tab ? d.upload : null;

  const doUpload = async (start: (progress: (p: number) => void) => Promise<UploadSummary>) => {
    setError(null);
    setBusy('UPLOADING...');
    try {
      const up = await start((p) => setBusy(`UPLOADING ${Math.round(p * 100)}%`));
      update({ upload: up, run: defaultRunCommand(up.entry), setup: up.requirements ? `pip install -r ${up.requirements}` : '', saveAs: '', overwrite: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const problem = checkPythonFile(f);
    if (problem) {
      setError(problem);
      return;
    }
    void doUpload((p) => uploadFile(f, p));
  };

  const pickFolder = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const sel = selectFolder(list);
    if (sel.error) {
      setError(sel.error);
      return;
    }
    void doUpload((p) => uploadFolder(sel, p));
  };

  const pickZip = (f: File | undefined) => {
    if (!f) return;
    const problem = checkZipFile(f);
    if (problem) {
      setError(problem);
      return;
    }
    void doUpload((p) => uploadZip(f, p));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (d.tab !== 'file') return;
    if (e.dataTransfer.files.length !== 1) {
      setError('Drop ONE .py file here. For a whole project use PROJECT FOLDER.');
      return;
    }
    pickFile(e.dataTransfer.files[0]);
  };

  const { run: runCheck, runError, setupError } = checkCommands(d.setup, d.run);
  const target = !('error' in runCheck) ? runCheck.target : null;
  const targetWarn =
    upload && target?.mode === 'file' && !upload.pyFiles.includes(target.path) ? `${target.path} is not one of the Python files of ${upload.name}` : null;
  const name = d.saveAs.trim();
  const clash = name ? projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) : undefined;
  const ready = Boolean(upload) && !runError && !setupError && !busy && canRun;

  const submit = (mode: 'run' | 'save') => {
    if (!upload) return;
    if (mode === 'save' && !name) {
      setError('Type a name under SAVE AS first.');
      return;
    }
    if (clash && !d.overwrite) {
      setError(`A project called "${clash.name}" already exists: tick REPLACE IT or choose another name.`);
      return;
    }
    const setup = normalizeSetupLines(d.setup);
    const go = async () => {
      const sentAt = Date.now();
      const ok =
        mode === 'run'
          ? send({
              type: 'SUBMIT_TASK',
              payload: { source: { kind: 'upload', uploadId: upload.id }, setup, run: d.run.trim(), priority: d.priority, ...(name ? { saveAs: name, overwrite: d.overwrite } : {}) },
            })
          : send({ type: 'SAVE_PROJECT', payload: { uploadId: upload.id, name, setup, run: d.run.trim(), overwrite: d.overwrite } });
      if (!ok) return;
      setBusy(mode === 'run' ? 'SENDING...' : 'SAVING...');
      const reply = await worldStore.waitForEvent(
        (e) =>
          (e.type === 'NOTICE' && e.payload.level === 'error') ||
          (mode === 'run' && e.type === 'TASK_UPDATE' && e.payload.status === 'queued' && e.payload.task.createdAt >= sentAt - 3000) ||
          (mode === 'save' && e.type === 'PROJECTS' && e.payload.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())),
        5000,
      );
      setBusy(null);
      if (reply?.type === 'NOTICE') {
        setError(reply.payload.text);
        return;
      }
      if (mode === 'save') {
        update({ tab: 'saved', saveAs: '', overwrite: false });
        return;
      }
      draft = { ...EMPTY, priority: d.priority, tab: d.tab };
      ui.closeModal();
    };
    if (mode === 'run') ui.withRunConsent(() => void go());
    else void go();
  };

  const footer =
    d.tab === 'saved' ? (
      <PixelButton label="CLOSE" onClick={ui.closeModal} />
    ) : (
      <>
        <PixelButton label="CANCEL" onClick={ui.closeModal} />
        <PixelButton icon="save_disk" label="SAVE ONLY" disabled={!ready || !name} title="SAVE WITHOUT RUNNING" onClick={() => submit('save')} />
        <PixelButton icon="play" label={busy ?? (name ? 'SAVE + RUN' : 'RUN')} size="lg" tone="accent" disabled={!ready} onClick={() => submit('run')} />
      </>
    );

  return (
    <PixelModal open title="RUN PYTHON" icon="play" onClose={ui.closeModal} width={780} footer={footer}>
      <div className="runbox">
        {!config?.runEnabled && <div className="runbox-warn">RUNNING CODE IS SWITCHED OFF ON THIS SERVER (RUNROOM_RUN=off).</div>}
        {config?.runEnabled && !canRun && (
          <div className="runbox-warn">
            YOU ARE WATCHING AS A GUEST. ENTER THE ADMIN PASSWORD FOR FULL ACCESS.
            <PixelButton icon="lock" label="ADMIN" onClick={ui.openLogin} />
          </div>
        )}
        {config?.runEnabled && !config.python && <div className="runbox-warn">NO PYTHON 3.8+ FOUND ON THE SERVER. INSTALL PYTHON 3 OR START THE SERVER WITH PYTHON=PATH-TO-PYTHON.</div>}
        <PixelTabs<RunTab>
          label="code source"
          tabs={[
            { id: 'file', label: 'ONE FILE', icon: 'file_code' },
            { id: 'folder', label: 'PROJECT FOLDER', icon: 'folder' },
            { id: 'saved', label: `SAVED (${projects.length})`, icon: 'save_disk' },
          ]}
          value={d.tab}
          onChange={(tab) => {
            setError(null);
            update({ tab });
          }}
        />
        {error && (
          <div className="runbox-error" role="alert">
            <PixelIcon name="cross_error" size={1} /> {error}
          </div>
        )}

        {d.tab === 'saved' ? (
          <SavedList projects={projects} canRun={canRun} />
        ) : (
          <>
            <div
              className={`taskbox-drop ${dragging ? 'is-dragging' : ''} ${upload ? 'has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (d.tab === 'file') setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".py,.pyw"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={folderInput}
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  pickFolder(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={zipInput}
                type="file"
                hidden
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(e) => {
                  pickZip(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <PixelIcon name={d.tab === 'folder' ? 'folder' : upload ? 'file_code' : 'upload_file'} size={2} />
              <div className="taskbox-drop-text">
                {busy && !upload ? (
                  busy
                ) : upload ? (
                  <>
                    <strong>{upload.name}</strong>{' '}
                    <span className="hud-dim">
                      {upload.kind === 'folder' ? `${upload.fileCount} FILES, ` : ''}
                      {kb(upload.totalBytes)}
                      {upload.skipped ? `, ${upload.skipped} SKIPPED (CACHES / VENV)` : ''}
                    </span>
                  </>
                ) : d.tab === 'file' ? (
                  <>
                    DROP ONE .PY FILE HERE OR PICK ONE
                    <div className="hud-dim">MAX {formatBytes(config?.limits.maxFileBytes ?? MAX_FILE_BYTES).toUpperCase()}</div>
                  </>
                ) : (
                  <>
                    {touch ? 'PICK A .ZIP OF YOUR PYTHON PROJECT' : 'PICK THE FOLDER OF YOUR PYTHON PROJECT, OR A .ZIP OF IT'}
                    <div className="hud-dim">
                      UP TO {config?.limits.maxProjectFiles ?? MAX_PROJECT_FILES} FILES / {formatBytes(config?.limits.maxProjectBytes ?? MAX_PROJECT_BYTES).toUpperCase()}. VENV, .GIT AND CACHES ARE LEFT OUT.
                    </div>
                  </>
                )}
              </div>
              {!(d.tab === 'folder' && touch) && (
                <PixelButton
                  icon={d.tab === 'folder' ? 'folder' : 'upload_file'}
                  label={upload && d.tab === 'file' ? 'CHANGE' : d.tab === 'folder' ? 'PICK FOLDER' : 'PICK FILE'}
                  disabled={Boolean(busy) || !canRun}
                  onClick={() => (d.tab === 'folder' ? folderInput.current : fileInput.current)?.click()}
                />
              )}
              {d.tab === 'folder' && (
                <PixelButton icon="upload_file" label="PICK .ZIP" title="A ZIP OF THE PROJECT FOLDER" disabled={Boolean(busy) || !canRun} onClick={() => zipInput.current?.click()} />
              )}
            </div>

            {upload && upload.kind === 'folder' && upload.pyFiles.length > 1 && (
              <div className="runbox-files">
                <span className="taskbox-label">PYTHON FILES</span>
                {upload.pyFiles.slice(0, 12).map((f) => (
                  <button key={f} type="button" className={`runbox-file ${target?.mode === 'file' && target.path === f ? 'is-active' : ''}`} onClick={() => update({ run: defaultRunCommand(f) })} title={`RUN ${f}`}>
                    {f}
                  </button>
                ))}
                {upload.pyFiles.length > 12 && <span className="hud-dim">+{upload.pyFiles.length - 12} MORE</span>}
              </div>
            )}

            <label className="taskbox-label" htmlFor="run-setup">
              <PixelIcon name="package_box" size={1} /> SETUP COMMANDS (OPTIONAL, ONE PER LINE, RUN ONCE IN A PRIVATE VENV)
            </label>
            <PixelTextArea
              id="run-setup"
              rows={2}
              value={d.setup}
              placeholder="pip install -r requirements.txt"
              onChange={(e) => update({ setup: e.target.value })}
            />
            {setupError ? <div className="runbox-field-error">{setupError}</div> : <div className="hud-dim runbox-hint">PIP AND PYTHON COMMANDS ONLY, AT MOST {MAX_SETUP_LINES}. NO PIPES OR &&.</div>}

            <label className="taskbox-label" htmlFor="run-command">
              <PixelIcon name="terminal" size={1} /> RUN COMMAND
            </label>
            <PixelInput
              id="run-command"
              value={d.run}
              maxLength={MAX_COMMAND_LENGTH}
              placeholder="python main.py"
              onChange={(e) => update({ run: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) submit('run');
              }}
            />
            {runError ? (
              <div className="runbox-field-error">{runError}</div>
            ) : targetWarn ? (
              <div className="runbox-field-warn">{targetWarn}</div>
            ) : (
              <div className="hud-dim runbox-hint">e.g. python main.py --size 3 / python -m mypackage. INPUT() QUESTIONS POP UP FOR YOU TO ANSWER.</div>
            )}

            <div className="runbox-row">
              <label className="taskbox-label" htmlFor="run-save">
                <PixelIcon name="save_disk" size={1} /> SAVE AS
              </label>
              <PixelInput
                id="run-save"
                value={d.saveAs}
                maxLength={MAX_PROJECT_NAME}
                placeholder="optional name, for one click runs"
                frameStyle={{ flex: 1 }}
                onChange={(e) => update({ saveAs: e.target.value, overwrite: false })}
              />
            </div>
            {clash && <PixelCheckbox checked={d.overwrite} onChange={(v) => update({ overwrite: v })} label={`"${clash.name}" EXISTS: REPLACE ITS CODE AND COMMANDS`} />}

            <div className="taskbox-row">
              <span className="taskbox-label">PRIORITY</span>
              {PRIORITIES.map((p) => (
                <PixelButton key={p} label={p} active={d.priority === p} tone={p === 'HIGH' ? 'accent' : 'default'} onClick={() => update({ priority: p })} />
              ))}
            </div>
          </>
        )}
      </div>
    </PixelModal>
  );
}

function SavedList({ projects, canRun }: { projects: ProjectInfo[]; canRun: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (projects.length === 0) {
    return <div className="runbox-empty">NO SAVED PROJECTS YET. PICK A FILE OR A FOLDER, TYPE A NAME UNDER SAVE AS, THEN RUN OR SAVE.</div>;
  }
  const run = (p: ProjectInfo, forceSetup: boolean) =>
    ui.withRunConsent(() => {
      if (send({ type: 'SUBMIT_TASK', payload: { source: { kind: 'project', projectId: p.id }, priority: 'NORMAL', forceSetup } })) ui.closeModal();
    });
  // The dialog body is the one scroller: no list scrolling inside a scrolling dialog on phones.
  return (
    <div className="proj-list">
      {projects.map((p) => (
        <div key={p.id} className="proj-card">
          <div className="proj-head">
            <PixelIcon name={p.kind === 'folder' ? 'folder' : 'file_code'} size={1} />
            <span className="proj-name" title={p.name}>
              {p.name}
            </span>
            <span className="hud-dim">
              {p.fileCount} FILE{p.fileCount === 1 ? '' : 'S'}, {kb(p.totalBytes)}
            </span>
            <span className="px-spacer" />
            {p.lastRun && <span className={p.lastRun.ok ? 'hud-ok' : 'hud-err'}>LAST RUN {p.lastRun.ok ? 'OK' : `ERR${p.lastRun.exitCode !== null ? ` (EXIT ${p.lastRun.exitCode})` : ''}`}</span>}
          </div>
          <div className="proj-cmds">
            {p.setup.map((l, i) => (
              <div key={i} className="proj-cmd proj-cmd-setup">
                {'$ '}
                {l}
              </div>
            ))}
            <div className="proj-cmd">
              {'$ '}
              {p.run}
            </div>
            {p.setup.length > 0 && <div className="hud-dim">{p.setupDone ? 'SETUP DONE: RUN SKIPS IT' : 'THE SETUP RUNS ON THE NEXT RUN'}</div>}
          </div>
          <div className="proj-actions">
            <PixelButton icon="play" label="RUN" tone="accent" size="lg" disabled={!canRun} title={`RUN ${p.name} WITH ITS SAVED COMMANDS`} onClick={() => run(p, false)} />
            {p.setup.length > 0 && <PixelButton icon="package_box" label="SETUP + RUN" disabled={!canRun} title="RUN THE SETUP AGAIN, THEN THE PROGRAM" onClick={() => run(p, true)} />}
            <PixelButton icon="pencil" label="EDIT" disabled={!canRun} onClick={() => setEditing(editing === p.id ? null : p.id)} />
            <PixelButton icon="trash" tone="danger" title="DELETE" aria-label={`delete ${p.name}`} disabled={!canRun} onClick={() => setDeleting(p.id)} />
          </div>
          {deleting === p.id && (
            <div className="proj-confirm">
              DELETE &quot;{p.name}&quot; AND ITS SAVED FILES?
              <PixelButton
                icon="trash"
                label="YES, DELETE"
                tone="danger"
                onClick={() => {
                  send({ type: 'DELETE_PROJECT', payload: { projectId: p.id } });
                  setDeleting(null);
                }}
              />
              <PixelButton label="NO" onClick={() => setDeleting(null)} />
            </div>
          )}
          {editing === p.id && <ProjectEdit p={p} onDone={() => setEditing(null)} />}
        </div>
      ))}
    </div>
  );
}

function ProjectEdit({ p, onDone }: { p: ProjectInfo; onDone: () => void }) {
  const [name, setName] = useState(p.name);
  const [setup, setSetup] = useState(p.setup.join('\n'));
  const [run, setRun] = useState(p.run);
  const [error, setError] = useState<string | null>(null);
  const { runError, setupError } = checkCommands(setup, run);
  const save = async () => {
    const ok = send({ type: 'UPDATE_PROJECT', payload: { projectId: p.id, name: name.trim(), setup: normalizeSetupLines(setup), run: run.trim() } });
    if (!ok) return;
    const reply = await worldStore.waitForEvent((e) => (e.type === 'NOTICE' && e.payload.level === 'error') || e.type === 'PROJECTS', 4000);
    if (reply?.type === 'NOTICE') setError(reply.payload.text);
    else onDone();
  };
  return (
    <div className="proj-edit">
      <label className="taskbox-label">NAME</label>
      <PixelInput value={name} maxLength={MAX_PROJECT_NAME} onChange={(e) => setName(e.target.value)} />
      <label className="taskbox-label">SETUP COMMANDS</label>
      <PixelTextArea rows={2} value={setup} placeholder="pip install -r requirements.txt" onChange={(e) => setSetup(e.target.value)} />
      {setupError && <div className="runbox-field-error">{setupError}</div>}
      <label className="taskbox-label">RUN COMMAND</label>
      <PixelInput value={run} maxLength={MAX_COMMAND_LENGTH} onChange={(e) => setRun(e.target.value)} />
      {runError && <div className="runbox-field-error">{runError}</div>}
      {error && <div className="runbox-field-error">{error}</div>}
      <div className="taskbox-row">
        <PixelButton icon="save_disk" label="SAVE CHANGES" disabled={Boolean(runError || setupError || !name.trim())} onClick={() => void save()} />
        <PixelButton label="CANCEL" onClick={onDone} />
      </div>
    </div>
  );
}
