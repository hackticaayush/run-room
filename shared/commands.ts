// Setup and run commands. RUN ROOM only runs Python: every command starts with python, py or
// pip. There is no shell: a command is split into words (quotes group words, backslashes stay
// literal for Windows paths) and started directly, so pipes, redirects and && are rejected with a
// clear message. The interpreter is always the one RUN ROOM picked (the project's own virtual
// environment once it has one), whatever "python" spelling was typed.
// Shared by the browser (instant feedback) and the server (which checks again).

import { MAX_COMMAND_LENGTH, MAX_SETUP_LINES } from './constants';

export type CommandRole = 'setup' | 'run';

export type PythonTarget = { mode: 'file'; path: string } | { mode: 'module'; name: string } | { mode: 'code'; code: string };

export interface ParsedCommand {
  /** The command as typed, trimmed. */
  text: string;
  /** python = the interpreter, pip = "python -m pip". */
  tool: 'python' | 'pip';
  /** Interpreter options placed before the target, e.g. ["-O"]. */
  pyOptions: string[];
  /** What python runs (null for pip and for "python --version"). */
  target: PythonTarget | null;
  /** Program arguments after the target, or the pip arguments. */
  args: string[];
}

export interface ParseError {
  error: string;
}

const SHELL_CHARS = new Set(['|', '&', ';', '<', '>', '`']);
const MODULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
/** Single letter interpreter switches without a value, possibly combined (e.g. -uB). */
const FLAG_RE = /^-[bBdEIOqsSuvRx]+$/;
const VERSION_FLAGS = new Set(['-V', '-VV', '--version']);

/** Splits a command line into words. Quotes group words; backslashes stay literal. */
export function splitWords(text: string): string[] | ParseError {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === '\\' && text[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (inWord) {
        words.push(cur);
        cur = '';
        inWord = false;
      }
      continue;
    }
    if (SHELL_CHARS.has(ch) || ch === '\n' || ch === '\r') {
      return { error: 'pipes, redirects, ";" and "&&" are not supported: put one command per line' };
    }
    cur += ch;
    inWord = true;
  }
  if (quote) return { error: `missing closing ${quote === '"' ? 'double' : 'single'} quote` };
  if (inWord) words.push(cur);
  return words;
}

/** Quotes a word for display when it contains spaces or quotes. */
export function quoteWord(word: string): string {
  if (word && !/[\s"']/.test(word)) return word;
  return `"${word.replace(/"/g, '\\"')}"`;
}

function programKind(word: string): 'python' | 'py' | 'pip' | null {
  if (/[\\/]/.test(word)) return null;
  const w = word.toLowerCase().replace(/\.exe$/, '');
  if (/^python(3(\.\d+)?)?$/.test(w)) return 'python';
  if (w === 'py') return 'py';
  if (/^pip(3(\.\d+)?)?$/.test(w)) return 'pip';
  return null;
}

const PIP_IN_RUN = 'pip belongs in the setup commands; the run command starts your program, e.g. python main.py';

/** Parses one command. Never throws. */
export function parseCommand(input: string, role: CommandRole): ParsedCommand | ParseError {
  // Allow commands pasted from docs with a prompt in front ("$ pip install x").
  const text = input.trim().replace(/^(\$|>)\s+/, '');
  if (!text) return { error: role === 'run' ? 'type the run command, e.g. python main.py' : 'empty command' };
  if (text.length > MAX_COMMAND_LENGTH) return { error: `the command is longer than ${MAX_COMMAND_LENGTH} characters` };
  const words = splitWords(text);
  if (!Array.isArray(words)) return words;
  if (words.length === 0) return { error: 'empty command' };
  const kind = programKind(words[0]);
  if (!kind) {
    return { error: `only Python commands are allowed (python ..., py ..., pip ...), not "${words[0].slice(0, 30)}"` };
  }
  let rest = words.slice(1);
  if (kind === 'py') {
    if (rest[0] && /^-2/.test(rest[0])) return { error: 'Python 2 is not supported' };
    // The Windows launcher's version picker: RUN ROOM picks the interpreter itself.
    if (rest[0] && /^-3(\.\d+)?(-(32|64))?$/.test(rest[0])) rest = rest.slice(1);
  }
  if (kind === 'pip') {
    if (role === 'run') return { error: PIP_IN_RUN };
    return { text, tool: 'pip', pyOptions: [], target: null, args: rest };
  }

  const pyOptions: string[] = [];
  let target: PythonTarget | null = null;
  let i = 0;
  while (i < rest.length) {
    const w = rest[i];
    if (w === '-m') {
      const name = rest[i + 1];
      if (!name) return { error: 'python -m needs a module name' };
      if (!MODULE_RE.test(name)) return { error: `"${name.slice(0, 40)}" is not a module name` };
      if (name === 'pip') {
        if (role === 'run') return { error: PIP_IN_RUN };
        return { text, tool: 'pip', pyOptions, target: null, args: rest.slice(i + 2) };
      }
      target = { mode: 'module', name };
      i += 2;
      break;
    }
    if (w === '-c') {
      const code = rest[i + 1];
      if (code === undefined || !code.trim()) return { error: 'python -c needs some code' };
      target = { mode: 'code', code };
      i += 2;
      break;
    }
    if (w === '-W' || w === '-X') {
      if (rest[i + 1] === undefined) return { error: `${w} needs a value` };
      pyOptions.push(w, rest[i + 1]);
      i += 2;
      continue;
    }
    if (/^-[WX]./.test(w) || FLAG_RE.test(w)) {
      pyOptions.push(w);
      i++;
      continue;
    }
    if (w === '-i') return { error: 'interactive mode (-i) is not supported' };
    if (w === '-') return { error: 'reading the program from stdin is not supported' };
    if (VERSION_FLAGS.has(w) && role === 'setup') {
      pyOptions.push(w);
      i++;
      continue;
    }
    if (w.startsWith('-')) return { error: `unsupported python option "${w.slice(0, 20)}"` };
    const path = w.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (/^([A-Za-z]:|\/)/.test(path)) return { error: 'use a path inside the project, e.g. python main.py or python src/app.py' };
    if (path.split('/').some((seg) => seg === '..')) return { error: '".." is not allowed in the script path' };
    if (!path) return { error: 'missing script path' };
    target = { mode: 'file', path };
    i++;
    break;
  }
  const args = rest.slice(i);
  if (!target) {
    if (role === 'setup' && pyOptions.some((o) => VERSION_FLAGS.has(o))) return { text, tool: 'python', pyOptions, target: null, args };
    return {
      error:
        role === 'run'
          ? 'say what to run, e.g. python main.py, python -m mypackage or python -c "print(1)"'
          : 'a python setup command needs a script, -m module or -c code (or use pip install ...)',
    };
  }
  return { text, tool: 'python', pyOptions, target, args };
}

/** Setup text (one command per line) to clean lines: blank lines and # comments are dropped. */
export function normalizeSetupLines(input: string | readonly string[]): string[] {
  const lines = typeof input === 'string' ? input.split(/\r?\n/) : [...input];
  return lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** Parses all setup lines. On error, line is 1-based. */
export function parseSetup(input: string | readonly string[]): ParsedCommand[] | (ParseError & { line: number }) {
  const lines = normalizeSetupLines(input);
  if (lines.length > MAX_SETUP_LINES) return { error: `at most ${MAX_SETUP_LINES} setup commands`, line: MAX_SETUP_LINES + 1 };
  const out: ParsedCommand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const p = parseCommand(lines[i], 'setup');
    if ('error' in p) return { error: `setup line ${i + 1}: ${p.error}`, line: i + 1 };
    out.push(p);
  }
  return out;
}

/** Short label of what a run command starts, e.g. "main.py", "-m mypkg" or "-c code". */
export function targetLabel(cmd: ParsedCommand): string {
  const t = cmd.target;
  if (!t) return cmd.tool;
  if (t.mode === 'file') return t.path.split('/').pop() ?? t.path;
  if (t.mode === 'module') return `-m ${t.name}`;
  return '-c code';
}

/** The default run command for an entry file, e.g. python main.py. */
export function defaultRunCommand(entry: string | null): string {
  return entry ? `python ${quoteWord(entry)}` : 'python main.py';
}
