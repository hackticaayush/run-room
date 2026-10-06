# RUN ROOM run harness.
#
# Runs the user's own Python program the way "python <script>", "python -m <module>" or
# "python -c <code>" would, and tells the RUN ROOM server what happens inside it:
#   - which of the program's OWN functions are called, with their arguments,
#   - what they return (short value, type name, declared return annotation),
#   - the current call stack (sampled a few times per second),
#   - each time the program waits for input (input(), getpass, sys.stdin reads),
#   - an uncaught exception and the exit code.
# Only files inside the project folder are traced; the standard library and installed packages
# are skipped. Events are JSON lines written to the file descriptor named by RUNROOM_EVENT_FD (a
# pipe opened by the server). The program's own stdout and stderr are left alone.
#
# Usage: python -u -X utf8 runroom_harness.py file   <script> [args...]
#        python -u -X utf8 runroom_harness.py module <name>   [args...]
#        python -u -X utf8 runroom_harness.py code   <source> [args...]
# Environment: RUNROOM_EVENT_FD, RUNROOM_PROJECT_ROOT, RUNROOM_TRACE (auto, monitoring,
# profile or off), RUNROOM_EVENTS_PER_SEC.
#
# This file is plain ASCII and works on Python 3.8 and newer.

import builtins
import json
import os
import reprlib
import runpy
import sys
import threading
import time
import traceback

# ------------------------------------------------------------------------------------------------
# Event channel

_EVENT_FD = None
try:
    _EVENT_FD = int(os.environ.get("RUNROOM_EVENT_FD", ""))
    # Child processes started by the program must not write into our channel.
    os.set_inheritable(_EVENT_FD, False)
except (ValueError, OSError):
    _EVENT_FD = None

_emit_lock = threading.Lock()


def emit(obj):
    if _EVENT_FD is None:
        return
    try:
        data = (json.dumps(obj, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")
    except Exception:
        return
    with _emit_lock:
        try:
            while data:
                written = os.write(_EVENT_FD, data)
                data = data[written:]
        except OSError:
            pass


# ------------------------------------------------------------------------------------------------
# Which code belongs to the user

_HARNESS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_RAW = os.path.abspath(os.environ.get("RUNROOM_PROJECT_ROOT") or os.getcwd())
_ROOT = os.path.normcase(_ROOT_RAW)
_MODE = sys.argv[1] if len(sys.argv) > 1 else ""


def _excluded_dirs():
    dirs = [_HARNESS_DIR, sys.prefix, sys.base_prefix, sys.exec_prefix]
    try:
        import site

        dirs.extend(site.getsitepackages())
        user_site = site.getusersitepackages()
        if isinstance(user_site, str):
            dirs.append(user_site)
    except Exception:
        pass
    out = []
    for d in dirs:
        if not d:
            continue
        n = os.path.normcase(os.path.abspath(d))
        # Never exclude the project itself (e.g. a project that lives inside a prefix).
        if n == _ROOT or _ROOT.startswith(n + os.sep):
            continue
        out.append(n)
    return out


_EXCLUDED = _excluded_dirs()
_file_cache = {}
_code_cache = {}
_SKIP_NAMES = {"<genexpr>", "<listcomp>", "<dictcomp>", "<setcomp>", "<lambda>"}
_CO_NEWLOCALS = 0x0002


def _is_user_file(filename):
    hit = _file_cache.get(filename)
    if hit is not None:
        return hit
    if filename == "<string>":
        hit = _MODE == "code"
    elif not filename or filename.startswith("<"):
        hit = False
    else:
        f = os.path.normcase(os.path.abspath(filename))
        hit = f.startswith(_ROOT + os.sep)
        if hit:
            for ex in _EXCLUDED:
                if f.startswith(ex + os.sep):
                    hit = False
                    break
    _file_cache[filename] = hit
    return hit


def _relpath(filename):
    if not filename or filename.startswith("<"):
        return filename or "?"
    try:
        return os.path.relpath(os.path.abspath(filename), _ROOT_RAW).replace(os.sep, "/")
    except ValueError:
        return os.path.basename(filename)


def code_info(code):
    """(qualified name, relative file) for the user's own functions, False for anything else."""
    info = _code_cache.get(code)
    if info is not None:
        return info
    name = code.co_name
    if name in _SKIP_NAMES or not _is_user_file(code.co_filename):
        info = False
    elif name != "<module>" and not (code.co_flags & _CO_NEWLOCALS):
        # A class body runs once when the class is defined: not a function call.
        info = False
    else:
        info = (getattr(code, "co_qualname", name), _relpath(code.co_filename))
    _code_cache[code] = info
    return info


# ------------------------------------------------------------------------------------------------
# Values, types and declared return annotations

_repr = reprlib.Repr()
_repr.maxstring = 48
_repr.maxother = 48
_repr.maxlist = 6
_repr.maxtuple = 6
_repr.maxset = 6
_repr.maxfrozenset = 6
_repr.maxdeque = 6
_repr.maxdict = 4
_repr.maxlevel = 2
_repr.maxlong = 40


def short_repr(value, limit=80):
    try:
        s = _repr.repr(value)
    except Exception:
        s = "<unprintable %s>" % type(value).__name__
    if len(s) > limit:
        s = s[: limit - 3] + "..."
    return s


def type_name(value):
    if value is None:
        return "None"
    return type(value).__name__


def _format_annotation(a):
    if a is None or a is type(None):
        return "None"
    if isinstance(a, str):
        s = a
    elif isinstance(a, type) and not getattr(a, "__args__", None):
        s = a.__name__
    else:
        s = repr(a).replace("typing.", "")
    return s[:40]


def _find_function(code, frame):
    g = frame.f_globals if frame is not None else {}
    cand = g.get(code.co_name)
    if getattr(cand, "__code__", None) is code:
        return cand
    qual = getattr(code, "co_qualname", None)
    if qual is not None:
        if "<locals>" in qual or "." not in qual:
            return None
        parts = qual.split(".")
        obj = g.get(parts[0])
        for part in parts[1:]:
            d = getattr(obj, "__dict__", None)
            try:
                obj = d.get(part) if d is not None else None
            except Exception:
                obj = None
            if obj is None:
                return None
        fn = getattr(obj, "__func__", obj)
        return fn if getattr(fn, "__code__", None) is code else None
    # Python < 3.11 has no co_qualname: look for the method on the classes of the module.
    for value in list(g.values()):
        if isinstance(value, type):
            m = value.__dict__.get(code.co_name)
            m = getattr(m, "__func__", m)
            if getattr(m, "__code__", None) is code:
                return m
    return None


def declared_return(code, frame):
    try:
        fn = _find_function(code, frame)
        if fn is None:
            return None
        ann = getattr(fn, "__annotations__", None)
        if not ann or "return" not in ann:
            return None
        return _format_annotation(ann["return"])
    except Exception:
        return None


# ------------------------------------------------------------------------------------------------
# Counting and event budget

class _FnStat(object):
    __slots__ = ("fn", "file", "calls", "rets", "types", "value", "decl")

    def __init__(self, info):
        self.fn = info[0]
        self.file = info[1]
        self.calls = 0
        self.rets = 0
        self.types = []
        self.value = ""
        self.decl = None

    def to_json(self):
        return {"fn": self.fn, "file": self.file, "calls": self.calls, "types": self.types, "val": self.value, "decl": self.decl}


_stats = {}
_totals = [0, 0, 0]  # calls, returns, yields
_NO_QUALNAME = not hasattr((lambda: None).__code__, "co_qualname")
_QUIET_EXC = (SystemExit, KeyboardInterrupt, StopIteration, GeneratorExit)
_depths = {}
_RATE = float(os.environ.get("RUNROOM_EVENTS_PER_SEC") or 60)
_bucket = [_RATE * 2, time.perf_counter(), 0]  # tokens, last refill, refusals since refill


def _take_token():
    """Token bucket: at most _RATE events per second (bursts of 2 s). Cheap when refusing."""
    b = _bucket
    if b[0] >= 1.0:
        b[0] -= 1.0
        return True
    b[2] += 1
    if b[2] < 32:
        return False
    b[2] = 0
    now = time.perf_counter()
    b[0] = min(_RATE * 2, b[0] + (now - b[1]) * _RATE)
    b[1] = now
    if b[0] >= 1.0:
        b[0] -= 1.0
        return True
    return False


def _stat_for(code, info):
    st = _stats.get(code)
    if st is None:
        st = _stats[code] = _FnStat(info)
    return st


def _args_summary(code, frame):
    if frame is None:
        return ""
    try:
        n = code.co_argcount + code.co_kwonlyargcount
        if code.co_flags & 0x04:
            n += 1
        if code.co_flags & 0x08:
            n += 1
        names = code.co_varnames[:n]
        loc = frame.f_locals
        parts = []
        for name in names[:4]:
            if name in ("self", "cls"):
                parts.append(name)
            elif name in loc:
                parts.append("%s=%s" % (name, short_repr(loc[name], 24)))
        if len(names) > 4:
            parts.append("...")
        return ", ".join(parts)[:90]
    except Exception:
        return ""


def _on_call(code, info, frame, resumed=False):
    tid = threading.get_ident()
    depth = _depths.get(tid, 0) + 1
    _depths[tid] = depth
    if resumed:
        return
    st = _stat_for(code, info)
    if st.calls == 0 and _NO_QUALNAME and frame is not None:
        info = _qualify_method(code, info, frame, st)
    st.calls += 1
    _totals[0] += 1
    if st.calls == 1 and frame is not None:
        st.decl = declared_return(code, frame)
    if _take_token():
        line = frame.f_lineno if frame is not None else code.co_firstlineno
        emit({"t": "call", "fn": info[0], "file": info[1], "line": line, "args": _args_summary(code, frame), "d": depth})


def _qualify_method(code, info, frame, st):
    """Python < 3.11: name methods "Class.method" from their self / cls argument."""
    try:
        first = code.co_varnames[0] if code.co_argcount else None
        if first in ("self", "cls"):
            obj = frame.f_locals.get(first)
            cls = obj if first == "cls" and isinstance(obj, type) else type(obj)
            info = ("%s.%s" % (cls.__name__, code.co_name), info[1])
            _code_cache[code] = info
            st.fn = info[0]
    except Exception:
        pass
    return info


def _on_return(code, info, value, yielded):
    tid = threading.get_ident()
    depth = _depths.get(tid, 1)
    _depths[tid] = max(0, depth - 1)
    st = _stat_for(code, info)
    st.rets += 1
    _totals[2 if yielded else 1] += 1
    tname = type_name(value)
    if tname not in st.types and len(st.types) < 4:
        st.types.append(tname)
    if _take_token():
        st.value = short_repr(value)
        emit({"t": "ret", "fn": info[0], "type": tname, "val": st.value, "decl": st.decl, "d": depth, "y": 1 if yielded else 0})


def _on_unwind(code, info, exc):
    tid = threading.get_ident()
    _depths[tid] = max(0, _depths.get(tid, 1) - 1)
    if not isinstance(exc, _QUIET_EXC) and _take_token():
        emit({"t": "unwind", "fn": info[0], "type": type(exc).__name__, "msg": str(exc)[:120]})


# ------------------------------------------------------------------------------------------------
# Tracing: sys.monitoring on Python 3.12+, sys.setprofile before that

TRACE_MODE = (os.environ.get("RUNROOM_TRACE") or "auto").lower()
_tool = [None]


def _install_monitoring():
    mon = getattr(sys, "monitoring", None)
    if mon is None:
        return False
    tool = None
    for tid in (2, 4, 3, 5, 1, 0):
        if mon.get_tool(tid) is None:
            tool = tid
            break
    if tool is None:
        return False
    mon.use_tool_id(tool, "runroom")
    disable = mon.DISABLE
    ev = mon.events

    def info_of(code):
        info = _code_cache.get(code)
        return code_info(code) if info is None else info

    def frame_of():
        try:
            return sys._getframe(2)
        except ValueError:
            return None

    def on_start(code, offset):
        info = info_of(code)
        if not info:
            return disable
        _on_call(code, info, frame_of())

    def on_resume(code, offset):
        info = info_of(code)
        if not info:
            return disable
        _on_call(code, info, None, resumed=True)

    def on_return(code, offset, retval):
        info = info_of(code)
        if not info:
            return disable
        _on_return(code, info, retval, False)

    def on_yield(code, offset, retval):
        info = info_of(code)
        if not info:
            return disable
        _on_return(code, info, retval, True)

    def on_unwind(code, offset, exc):
        info = info_of(code)
        if info:
            _on_unwind(code, info, exc)

    mon.register_callback(tool, ev.PY_START, on_start)
    mon.register_callback(tool, ev.PY_RESUME, on_resume)
    mon.register_callback(tool, ev.PY_RETURN, on_return)
    mon.register_callback(tool, ev.PY_YIELD, on_yield)
    mon.register_callback(tool, ev.PY_UNWIND, on_unwind)
    mon.set_events(tool, ev.PY_START | ev.PY_RESUME | ev.PY_RETURN | ev.PY_YIELD | ev.PY_UNWIND)
    _tool[0] = tool
    return True


def _profile(frame, event, arg):
    if event == "call":
        code = frame.f_code
        info = _code_cache.get(code)
        if info is None:
            info = code_info(code)
        if info:
            _on_call(code, info, frame)
    elif event == "return":
        code = frame.f_code
        info = _code_cache.get(code)
        if info is None:
            info = code_info(code)
        if info:
            _on_return(code, info, arg, False)


def install_tracing():
    global TRACE_MODE
    if TRACE_MODE == "off":
        return
    if TRACE_MODE in ("auto", "monitoring") and _install_monitoring():
        TRACE_MODE = "monitoring"
        return
    sys.setprofile(_profile)
    threading.setprofile(_profile)
    TRACE_MODE = "profile"


def stop_tracing():
    if TRACE_MODE == "monitoring" and _tool[0] is not None:
        try:
            sys.monitoring.set_events(_tool[0], 0)
            sys.monitoring.free_tool_id(_tool[0])
        except Exception:
            pass
    elif TRACE_MODE == "profile":
        sys.setprofile(None)
        threading.setprofile(None)


# ------------------------------------------------------------------------------------------------
# Stack sampler (a background thread, so long loops inside one function still show their line)

_stop = threading.Event()
_main_ident = threading.get_ident()


def _stack_of(frame, limit=12):
    out = []
    f = frame
    while f is not None and len(out) < 60:
        info = code_info(f.f_code)
        if info:
            out.append({"fn": info[0], "file": info[1], "line": f.f_lineno})
        f = f.f_back
    out.reverse()
    return out[-limit:]


def emit_stats():
    top = sorted(list(_stats.values()), key=lambda s: -s.calls)[:8]
    emit({"t": "stats", "calls": _totals[0], "rets": _totals[1], "ylds": _totals[2], "top": [s.to_json() for s in top]})


def _sampler():
    last_key = None
    last_stats = 0.0
    while not _stop.wait(0.2):
        try:
            frame = sys._current_frames().get(_main_ident)
            stack = _stack_of(frame)
            key = tuple((s["fn"], s["line"]) for s in stack)
            if key != last_key:
                last_key = key
                emit({"t": "stack", "frames": stack})
            now = time.monotonic()
            if now - last_stats >= 1.0:
                last_stats = now
                emit_stats()
        except Exception:
            pass


# ------------------------------------------------------------------------------------------------
# Input: every read of stdin is announced so the office can pop up a prompt for the viewers

_real_stdin = sys.stdin
_input_seq = [0]
_tail = [""]  # what the program printed last without a newline (the question)


class _StdoutTail(object):
    """Passes writes through and remembers the last unfinished line (used as the prompt)."""

    def __init__(self, inner):
        self._inner = inner

    def write(self, s):
        n = self._inner.write(s)
        try:
            if s:
                i = s.rfind("\n")
                _tail[0] = (_tail[0] + s)[-300:] if i < 0 else s[i + 1:][-300:]
        except Exception:
            pass
        return n

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _asking_function():
    try:
        f = sys._getframe(2)
    except ValueError:
        return None
    while f is not None:
        info = code_info(f.f_code)
        if info:
            return info[0]
        f = f.f_back
    return None


def _request_line(prompt, secret):
    _input_seq[0] += 1
    rid = _input_seq[0]
    try:
        sys.stdout.flush()
    except Exception:
        pass
    emit({"t": "input", "id": rid, "prompt": str(prompt)[-300:], "secret": bool(secret), "fn": _asking_function()})
    try:
        line = _real_stdin.readline() if _real_stdin is not None else ""
    finally:
        emit({"t": "input_done", "id": rid})
    _tail[0] = ""
    return line


def _strip_newline(line):
    if line.endswith("\n"):
        line = line[:-1]
    if line.endswith("\r"):
        line = line[:-1]
    return line


def _ghost_input(prompt=""):
    p = str(prompt)
    if p:
        sys.stdout.write(p)
    line = _request_line(p or _tail[0], False)
    if not line:
        raise EOFError("EOF when reading a line")
    return _strip_newline(line)


def _ghost_getpass(prompt="Password: ", stream=None):
    line = _request_line(str(prompt), True)
    if not line:
        raise EOFError("EOF when reading a line")
    return _strip_newline(line)


class _GhostStdin(object):
    """sys.stdin replacement: reads still come from the real stdin, but each one is announced."""

    def __init__(self, inner):
        self._inner = inner
        self._buf = ""

    def readline(self, size=-1):
        if "\n" not in self._buf:
            self._buf += _request_line(_tail[0], False)
        if "\n" in self._buf:
            i = self._buf.index("\n") + 1
        else:
            i = len(self._buf)
        if size is not None and size >= 0:
            i = min(i, size)
        line, self._buf = self._buf[:i], self._buf[i:]
        return line

    def read(self, size=-1):
        while size is None or size < 0 or len(self._buf) < size:
            line = _request_line(_tail[0], False)
            if not line:
                break
            self._buf += line
        if size is None or size < 0:
            data, self._buf = self._buf, ""
        else:
            data, self._buf = self._buf[:size], self._buf[size:]
        return data

    def readlines(self, hint=-1):
        return list(iter(self.readline, ""))

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self._inner, name)


def install_input_hooks():
    builtins.input = _ghost_input
    try:
        import getpass

        getpass.getpass = _ghost_getpass
    except Exception:
        pass
    if _real_stdin is not None:
        sys.stdin = _GhostStdin(_real_stdin)
    if sys.stdout is not None:
        sys.stdout = _StdoutTail(sys.stdout)


# ------------------------------------------------------------------------------------------------
# Running the program

def _set_path0(path):
    """Make sys.path[0] what plain "python <target>" would have used instead of this file's folder."""
    first = os.path.normcase(os.path.abspath(sys.path[0] or ".")) if sys.path else None
    if first == os.path.normcase(_HARNESS_DIR):
        if path is None or sys.flags.isolated:
            del sys.path[0]
        else:
            sys.path[0] = path
    elif path is not None and not sys.flags.isolated:
        sys.path.insert(0, path)


def _exit_code(code):
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    try:
        sys.stderr.write(str(code) + "\n")
    except Exception:
        pass
    return 1


def _report_exception(exc):
    tb = exc.__traceback__
    while tb is not None and not _is_user_file(tb.tb_frame.f_code.co_filename):
        tb = tb.tb_next
    fn = None
    file = None
    line = None
    t = tb
    while t is not None:
        info = code_info(t.tb_frame.f_code)
        if info:
            fn, file, line = info[0], info[1], t.tb_lineno
        t = t.tb_next
    if fn is None and isinstance(exc, SyntaxError):
        file = _relpath(exc.filename or "")
        line = exc.lineno
    emit({"t": "exc", "type": type(exc).__name__, "msg": str(exc)[:500], "fn": fn, "file": file, "line": line})
    try:
        traceback.print_exception(type(exc), exc, tb)
    except Exception:
        pass


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("file", "module", "code"):
        sys.stderr.write("usage: runroom_harness.py file|module|code <target> [args...]\n")
        return 2
    mode, target, args = sys.argv[1], sys.argv[2], sys.argv[3:]

    threading.Thread(target=_sampler, name="runroom-sampler", daemon=True).start()
    install_input_hooks()
    install_tracing()
    emit({
        "t": "hello",
        "py": "%d.%d.%d" % tuple(sys.version_info[:3]),
        "exe": sys.executable,
        "trace": TRACE_MODE,
        "pid": os.getpid(),
    })

    code = 0
    try:
        if mode == "file":
            path = os.path.abspath(target)
            sys.argv = [target] + args
            _set_path0(os.path.dirname(path))
            runpy.run_path(path, run_name="__main__")
        elif mode == "module":
            sys.argv = [target] + args
            _set_path0(os.getcwd())
            runpy.run_module(target, run_name="__main__", alter_sys=True)
        else:
            sys.argv = ["-c"] + args
            _set_path0("")
            glb = {"__name__": "__main__", "__builtins__": builtins, "__doc__": None, "__spec__": None, "__loader__": None, "__package__": None}
            exec(compile(target, "<string>", "exec"), glb)
    except SystemExit as e:
        code = _exit_code(e.code)
    except KeyboardInterrupt:
        code = 130
    except BaseException as e:
        code = 1
        _report_exception(e)
    finally:
        stop_tracing()
        _stop.set()
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
        emit_stats()
        emit({"t": "exit", "code": code})
    return code


if __name__ == "__main__":
    sys.exit(main())
