import { describe, expect, it } from 'vitest';
import { defaultRunCommand, normalizeSetupLines, parseCommand, parseSetup, splitWords, targetLabel } from '../shared/commands';
import { commandArgs } from '../server/runners/PythonRunner';

describe('command words', () => {
  it('splits on spaces, groups quotes and keeps backslashes (Windows paths)', () => {
    expect(splitWords('python main.py --n 3')).toEqual(['python', 'main.py', '--n', '3']);
    expect(splitWords('python "my app.py" \'two words\'')).toEqual(['python', 'my app.py', 'two words']);
    expect(splitWords('python src\\app.py "say \\"hi\\""')).toEqual(['python', 'src\\app.py', 'say "hi"']);
    expect(splitWords('python "unclosed')).toEqual({ error: expect.stringMatching(/closing double quote/) });
  });

  it('refuses shell syntax: pipes, redirects, && and ;', () => {
    for (const bad of ['python a.py | more', 'python a.py > out.txt', 'python a.py && rm x', 'python a.py; ls', 'python `x`']) {
      expect(splitWords(bad)).toEqual({ error: expect.stringMatching(/one command per line/) });
    }
    // Quoted, they are plain text.
    expect(splitWords('python a.py "a|b>c"')).toEqual(['python', 'a.py', 'a|b>c']);
  });
});

describe('run commands', () => {
  it('accepts python / python3 / py -3 with a script, a module or code', () => {
    expect(parseCommand('python main.py --size 3', 'run')).toMatchObject({ tool: 'python', target: { mode: 'file', path: 'main.py' }, args: ['--size', '3'] });
    expect(parseCommand('python3 -u src\\app.py', 'run')).toMatchObject({ pyOptions: ['-u'], target: { mode: 'file', path: 'src/app.py' } });
    expect(parseCommand('py -3.12 ./tool.py x', 'run')).toMatchObject({ target: { mode: 'file', path: 'tool.py' }, args: ['x'] });
    expect(parseCommand('python -m mypkg.cli serve', 'run')).toMatchObject({ target: { mode: 'module', name: 'mypkg.cli' }, args: ['serve'] });
    expect(parseCommand('python -c "print(6*7)"', 'run')).toMatchObject({ target: { mode: 'code', code: 'print(6*7)' } });
    expect(parseCommand('python -X dev -W ignore -OO main.py', 'run')).toMatchObject({ pyOptions: ['-X', 'dev', '-W', 'ignore', '-OO'] });
    expect(parseCommand('PYTHON.EXE main.py', 'run')).toMatchObject({ tool: 'python' });
    expect(parseCommand('$ python main.py', 'run')).toMatchObject({ text: 'python main.py' });
  });

  it('refuses other programs, pip, the REPL and paths outside the project', () => {
    const err = (cmd: string, re: RegExp) => expect(parseCommand(cmd, 'run')).toEqual({ error: expect.stringMatching(re) });
    err('node app.js', /only Python commands/);
    err('bash run.sh', /only Python commands/);
    err('C:\\Python\\python.exe main.py', /only Python commands/);
    err('pip install requests', /setup commands/);
    err('python -m pip install x', /setup commands/);
    err('python', /say what to run/);
    err('python -i main.py', /interactive/);
    err('python ../secret.py', /not allowed/);
    err('python C:\\other\\x.py', /inside the project/);
    err('python /etc/x.py', /inside the project/);
    err('python -m "bad name"', /not a module name/);
    err('py -2 old.py', /Python 2/);
    err(`python ${'x'.repeat(400)}.py`, /longer than/);
  });

  it('labels the target for titles', () => {
    expect(targetLabel(parseCommand('python src/main.py', 'run') as never)).toBe('main.py');
    expect(targetLabel(parseCommand('python -m app', 'run') as never)).toBe('-m app');
    expect(defaultRunCommand('my tool.py')).toBe('python "my tool.py"');
    expect(defaultRunCommand(null)).toBe('python main.py');
  });
});

describe('setup commands', () => {
  it('accepts pip and python commands, one per line, skipping blanks and comments', () => {
    const lines = normalizeSetupLines('pip install -r requirements.txt\n\n# a comment\npython -m pip install -e .\npython setup.py develop');
    expect(lines).toEqual(['pip install -r requirements.txt', 'python -m pip install -e .', 'python setup.py develop']);
    const parsed = parseSetup(lines);
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed.map((p) => p.tool)).toEqual(['pip', 'pip', 'python']);
    // pip always runs as "python -m pip" with the chosen interpreter.
    expect(commandArgs(parsed[0])).toEqual(['-m', 'pip', 'install', '-r', 'requirements.txt']);
    expect(commandArgs(parsed[2])).toEqual(['setup.py', 'develop']);
    expect(parseSetup(['python --version'])).toEqual([expect.objectContaining({ tool: 'python', target: null })]);
  });

  it('names the bad line and limits the number of lines', () => {
    expect(parseSetup(['pip install a', 'npm install'])).toEqual({ error: expect.stringMatching(/^setup line 2: only Python/), line: 2 });
    expect(parseSetup(['pip install a && pip install b'])).toMatchObject({ line: 1 });
    expect(parseSetup(Array.from({ length: 6 }, (_, i) => `pip install p${i}`))).toMatchObject({ error: expect.stringMatching(/at most 5/) });
    expect(parseSetup(['python'])).toMatchObject({ line: 1 });
  });
});
