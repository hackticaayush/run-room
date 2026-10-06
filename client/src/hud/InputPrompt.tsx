// The program waits for input (input(), getpass, sys.stdin): a full screen prompt for every
// viewer. The first answer goes to the program's stdin. Enter sends, Ctrl+D ends the input,
// Escape tucks the prompt away into a blinking chip (the program keeps waiting).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_INPUT_LENGTH } from '@shared/constants';
import { send } from '../net/socket';
import { useWorld } from '../net/store';
import { chromeStyle, PixelButton, PixelIcon, PixelInput } from '../ui';

export function InputPrompt() {
  const req = useWorld((s) => s.input);
  const canRun = useWorld((s) => Boolean(s.config?.canRun));
  const task = useWorld((s) => (s.input ? s.tasks.find((t) => t.id === s.input?.taskId) : undefined));
  const [value, setValue] = useState('');
  const [tucked, setTucked] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const key = req ? `${req.taskId}:${req.requestId}` : '';

  useEffect(() => {
    setValue('');
    setTucked(false);
    setSent(false);
  }, [key]);

  useEffect(() => {
    if (req && !tucked) inputRef.current?.focus();
  }, [req, tucked]);

  if (!req) return null;

  const answer = (eof: boolean) => {
    if (sent) return;
    if (send({ type: 'PROVIDE_INPUT', payload: { taskId: req.taskId, requestId: req.requestId, value: eof ? '' : value, eof } })) setSent(true);
  };

  if (tucked) {
    return createPortal(
      <button type="button" className="input-chip" onClick={() => setTucked(false)}>
        <PixelIcon name="keyboard" size={1} /> {req.taskId} WAITS FOR INPUT - ANSWER
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="input-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="the program needs input"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setTucked(true);
      }}
    >
      <div className="input-panel" style={chromeStyle('modal_frame')}>
        <header className="input-head">
          <PixelIcon name="keyboard" size={3} />
          <div>
            <div className="input-title">THE PROGRAM NEEDS INPUT</div>
            <div className="hud-dim">
              {req.taskId} {task ? `${task.codeName} - ${task.run}` : ''}
              {req.fn ? ` - ASKED IN ${req.fn === '<module>' ? 'THE TOP LEVEL CODE' : `${req.fn}()`}` : ''}
            </div>
          </div>
          <span className="px-spacer" />
          <PixelButton icon="minus" title="HIDE (THE PROGRAM KEEPS WAITING)" aria-label="hide" onClick={() => setTucked(true)} />
        </header>

        {req.context.length > 0 && (
          <div className="input-context" aria-label="last output">
            {req.context.map((line, i) => (
              <div key={i}>{line || ' '}</div>
            ))}
          </div>
        )}
        <div className="input-question">{req.prompt || 'TYPE A LINE FOR THE PROGRAM'}</div>

        {canRun ? (
          <form
            className="input-form"
            onSubmit={(e) => {
              e.preventDefault();
              answer(false);
            }}
          >
            <PixelInput
              ref={inputRef}
              type={req.secret ? 'password' : 'text'}
              value={value}
              maxLength={MAX_INPUT_LENGTH}
              aria-label="your answer"
              placeholder={req.secret ? 'hidden input' : 'your answer'}
              frameStyle={{ flex: 1 }}
              disabled={sent}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key.toLowerCase() === 'd' && e.ctrlKey) {
                  e.preventDefault();
                  answer(true);
                }
              }}
            />
            <PixelButton type="submit" icon="check_ok" label={sent ? 'SENT' : 'SEND'} size="lg" tone="accent" disabled={sent} />
          </form>
        ) : (
          <div className="runbox-warn">YOU ARE WATCHING AS A GUEST. AN ADMIN ANSWERS THE PROGRAM'S INPUT.</div>
        )}

        <footer className="input-foot">
          {canRun && <PixelButton icon="close_x" label="END INPUT (CTRL+D)" title="CLOSE THE PROGRAM'S INPUT, LIKE CTRL+D IN A TERMINAL" disabled={sent} onClick={() => answer(true)} />}
          {canRun && <PixelButton icon="stop_square" label="STOP PROGRAM" tone="danger" onClick={() => send({ type: 'CANCEL_TASK', payload: { taskId: req.taskId } })} />}
          <span className="px-spacer" />
          <span className="hud-dim">{req.secret ? 'HIDDEN INPUT: NOT SHOWN TO ANYONE. ' : ''}EVERY VIEWER SEES THIS QUESTION; THE FIRST ANSWER IS USED.</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
