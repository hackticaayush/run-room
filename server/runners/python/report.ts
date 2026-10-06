// The Markdown report of one run: outcome, exception, function table with return types, inputs,
// output and files the program changed. Everything that came from the program goes through
// sanitizeDisplay() because the report is shown in the HUD.

import { clip, sanitizeDisplay } from '../../../shared/display';
import type { RunFnStat, RunOutcome } from '../../../shared/types';

/** Lines kept from a stream: the tail, with a count of what was dropped from the start. */
export class CapturedLines {
  readonly lines: string[] = [];
  dropped = 0;
  total = 0;
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  push(line: string): void {
    this.lines.push(line);
    this.total++;
    this.bytes += line.length + 1;
    while (this.bytes > this.maxBytes && this.lines.length > 1) {
      this.bytes -= this.lines.shift()!.length + 1;
      this.dropped++;
    }
  }
}

export interface FileChange {
  path: string;
  size: number;
  kind: 'created' | 'changed' | 'deleted';
}

export interface ReportInput {
  taskId: string;
  codeName: string;
  command: string;
  python: string | null;
  usedVenv: boolean;
  traceMode: string;
  outcome: RunOutcome;
  exitCode: number | null;
  runtimeMs: number;
  waitedMs: number;
  stdout: CapturedLines;
  stderr: CapturedLines;
  calls: number;
  returns: number;
  top: RunFnStat[];
  exception: { type: string; message: string; fn: string | null; file: string | null; line: number | null } | null;
  inputs: { prompt: string; value: string | null; secret: boolean }[];
  files: FileChange[];
  note?: string;
}

const OUTPUT_LINES = 200;
const s = (t: string, max = 400) => sanitizeDisplay(t, max);
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
const cell = (t: string) => s(t, 80).replace(/\|/g, '/');

function fence(lines: string[]): string[] {
  return ['```', ...(lines.length ? lines.map((l) => s(l, 300).replace(/^```/, "'''")) : ['(nothing)']), '```'];
}

export function summarize(i: ReportInput): string {
  if (i.outcome === 'stopped') return `Stopped by a viewer after ${secs(i.runtimeMs)}.`;
  if (i.exception) {
    const where = i.exception.fn ? ` in ${i.exception.fn}${i.exception.line ? ` (line ${i.exception.line})` : ''}` : '';
    return clip(s(`Crashed: ${i.exception.type}: ${i.exception.message}${where}.`), 200);
  }
  if (i.outcome === 'ok') return `Ran OK in ${secs(i.runtimeMs)}: exit code 0, ${i.calls} function call(s) traced.`;
  return `Exit code ${i.exitCode ?? 'unknown'} after ${secs(i.runtimeMs)}.`;
}

export function buildRunReport(i: ReportInput): string {
  const status = i.outcome === 'ok' ? 'OK' : i.outcome === 'stopped' ? 'STOPPED' : 'ERR';
  const lines: string[] = [
    `# RUN ${i.taskId}: ${s(i.codeName, 80)}`,
    '',
    `- Result: ${status}, exit code ${i.exitCode ?? 'none'}`,
    `- Command: ${s(i.command, 300)}`,
    `- Interpreter: ${i.python ?? 'unknown'}${i.usedVenv ? ' in the project virtual environment' : ''}`,
    `- Time: ${secs(i.runtimeMs)}${i.waitedMs > 0 ? ` (of which ${secs(i.waitedMs)} waiting for input)` : ''}`,
    `- Traced: ${i.calls} call(s), ${i.returns} return(s) (${i.traceMode})`,
  ];
  if (i.note) lines.push(`- Note: ${s(i.note, 300)}`);

  if (i.exception) {
    lines.push('', '## Uncaught exception', '', `${s(i.exception.type, 80)}: ${s(i.exception.message, 400)}`);
    if (i.exception.fn || i.exception.file) {
      lines.push(`- in ${s(i.exception.fn ?? '?', 80)} (${s(i.exception.file ?? '?', 120)} line ${i.exception.line ?? '?'})`);
    }
  }

  lines.push('', '## Functions', '');
  if (i.top.length === 0) {
    lines.push('No function of the program was called (or tracing is off).');
  } else {
    lines.push('| Function | File | Calls | Returned | Declared | Last value |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of i.top) {
      lines.push(
        `| ${cell(f.fn === '<module>' ? '(top level)' : f.fn)} | ${cell(f.file)} | ${f.calls} | ${cell(f.types.join(', ') || '-')} | ${cell(f.declared ?? '-')} | ${cell(f.value || '-')} |`,
      );
    }
  }

  if (i.inputs.length) {
    lines.push('', '## Input', '');
    i.inputs.forEach((inp, n) => {
      const shown = inp.value === null ? '(end of input)' : inp.secret ? '(hidden)' : s(inp.value, 200);
      lines.push(`${n + 1}. ${s(inp.prompt, 120).trim() || '(no prompt)'} -> ${shown}`);
    });
  }

  const out = i.stdout.lines.slice(-OUTPUT_LINES);
  const hidden = i.stdout.total - out.length;
  lines.push('', `## Output${hidden > 0 ? ` (last ${out.length} of ${i.stdout.total} lines)` : ''}`, '', ...fence(out));

  if (i.stderr.total > 0) {
    const err = i.stderr.lines.slice(-OUTPUT_LINES);
    lines.push('', `## Errors (stderr${i.stderr.total > err.length ? `, last ${err.length} of ${i.stderr.total} lines` : ''})`, '', ...fence(err));
  }

  if (i.files.length) {
    lines.push('', '## Files the program changed', '');
    for (const f of i.files.slice(0, 40)) lines.push(`- ${f.kind}: ${s(f.path, 200)}${f.kind === 'deleted' ? '' : ` (${f.size} bytes)`}`);
    if (i.files.length > 40) lines.push(`- ... and ${i.files.length - 40} more`);
  }
  lines.push('');
  return lines.join('\n');
}
