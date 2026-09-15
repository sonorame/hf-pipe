# Dirty-side hotfolder client.
#
# Matrix (default for Cursor):
#   set HOT_TRANSPORT=matrix
#   python dirty.py ask hostname          send + wait + print (target ~5s)
#   python dirty.py ask shell whoami
#   python dirty.py ask --timeout 12 shell dir C:\Users\Kirill\Desktop
#
# Fire-and-forget still available:
#   python dirty.py send ping
#   python dirty.py get <id>
#
# Share/DFS path still works if HOT_TRANSPORT is unset and dirty daemon is up.

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

import pipe as P

HERE = Path(__file__).resolve().parent
LOCAL = HERE / "local"
INBOX = LOCAL / "inbox"
OUTBOX = LOCAL / "outbox"
WORK = LOCAL / "work"
PIDFILE = LOCAL / "dirty.pid"


def _local_layout() -> None:
    for d in (INBOX, OUTBOX, WORK):
        d.mkdir(parents=True, exist_ok=True)


def daemon_alive() -> bool:
    if not PIDFILE.is_file():
        return False
    try:
        pid = int(PIDFILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    try:
        import ctypes

        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    except Exception:
        return False


def write_pid() -> None:
    _local_layout()
    PIDFILE.write_text(str(os.getpid()), encoding="utf-8")


def parse_send(argv: list[str]) -> dict:
    if not argv:
        raise SystemExit("send needs a type")
    kind = argv[0].lower()
    rest = argv[1:]
    tid = uuid.uuid4().hex[:10]
    task: dict = {"id": tid, "type": kind, "body": {}}

    def take_flag(name: str, default=None):
        key = f"--{name}"
        if key in rest:
            i = rest.index(key)
            rest.pop(i)
            if i >= len(rest):
                return True if default is None else default
            val = rest.pop(i)
            return val
        return default

    if kind == "ping":
        task["body"] = {}
    elif kind == "shell":
        timeout = take_flag("timeout", "120")
        cwd = take_flag("cwd")
        task["body"] = {"cmd": " ".join(rest), "timeout": int(timeout), "cwd": cwd}
    elif kind == "tree":
        depth = int(take_flag("depth", "2"))
        if not rest:
            raise SystemExit("tree needs a path")
        task["body"] = {"path": rest[0], "depth": depth}
    elif kind in ("list", "read", "pull", "glob", "grep"):
        pattern = take_flag("pattern")
        name_glob = take_flag("glob", "*")
        as_blob = bool(take_flag("blob"))
        if not rest:
            raise SystemExit(f"{kind} needs a path")
        path = rest[0]
        body: dict = {"path": path}
        if kind == "glob":
            body["pattern"] = pattern or "*"
        if kind == "grep":
            body["pattern"] = pattern or " ".join(rest[1:])
            body["glob"] = name_glob
        if kind == "read" and as_blob:
            body["blob"] = True
        if kind == "pull" and len(rest) > 1:
            body["paths"] = rest
            del body["path"]
        task["body"] = body
    elif kind == "write":
        if len(rest) < 2:
            raise SystemExit("write needs path and content")
        task["body"] = {"path": rest[0], "content": " ".join(rest[1:])}
    elif kind == "screenshot":
        fmt = take_flag("fmt")
        task["body"] = {}
        if fmt:
            task["body"]["fmt"] = fmt
    elif kind in ("mouse", "pointer", "click", "input"):
        op = take_flag("op") or take_flag("action") or ("click" if kind == "click" else "move")
        btn = take_flag("button")
        dy = take_flag("dy")
        dx = take_flag("dx")
        body = {"op": op}
        if rest:
            body["x"] = float(rest[0])
        if len(rest) > 1:
            body["y"] = float(rest[1])
        if btn:
            body["button"] = btn
        if dy is not None:
            body["dy"] = float(dy)
        if dx is not None:
            body["dx"] = float(dx)
        task["type"] = "mouse"
        task["body"] = body
    elif kind in ("key", "keyboard", "hotkey"):
        task["type"] = "key"
        task["body"] = {"keys": rest}
    elif kind == "type":
        task["type"] = "type"
        task["body"] = {"text": " ".join(rest)}
    elif kind in ("batch", "playbook"):
        if not rest:
            raise SystemExit(f"{kind} needs a json file or inline json")
        src = rest[0]
        p = Path(src)
        if p.is_file():
            obj = json.loads(p.read_text(encoding="utf-8"))
        else:
            obj = json.loads(src)
        if isinstance(obj, list):
            task["body"] = {"ops": obj}
        elif isinstance(obj, dict) and ("ops" in obj or "steps" in obj):
            task["body"] = obj
        else:
            task["body"] = {"ops": [obj]}
        task["type"] = kind
    else:
        raise SystemExit(f"unknown type {kind}")
    return task


def send_via_local(task: dict) -> Path:
    _local_layout()
    tid = task["id"]
    dest = INBOX / f"{tid}.json"
    P.write_json(dest, task)
    return dest


def send_via_share(task: dict) -> Path:
    root = P.detect_root("dirty")
    P.ensure_layout(root)
    return P.put_frame(P.d2c_dir(root), task)


def send_via_matrix(task: dict) -> Path:
    _local_layout()
    inbox = LOCAL / "mxinbox"
    inbox.mkdir(parents=True, exist_ok=True)
    dest = inbox / f"{task['id']}.json"
    P.write_json(dest, task)
    return dest


def ask_via_rtc(task: dict, timeout: float) -> dict | None:
    import urllib.error
    import urllib.request

    url = os.environ.get("HF_RPC_URL", "http://127.0.0.1:18765/ask")
    data = json.dumps(task).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "X-Timeout": str(int(timeout * 1000))},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 2) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None


def enqueue_task(task: dict, *, quiet: bool = False) -> Path:
    if os.environ.get("HOT_TRANSPORT", "").strip().lower() == "matrix":
        dest = send_via_matrix(task)
        if not quiet:
            print("queued-matrix", dest, flush=True)
        return dest
    if daemon_alive():
        dest = send_via_local(task)
        if not quiet:
            print("queued", dest, flush=True)
    else:
        dest = send_via_share(task)
        if not quiet:
            print("wrote", dest, flush=True)
    return dest


def cmd_send(argv: list[str]) -> int:
    if argv and argv[0].lower() in ("queue", "q"):
        return cmd_queue(argv[1:])
    if argv and argv[0].lower() in ("cancel", "x"):
        return cmd_cancel(argv[1:])
    task = parse_send(argv)
    print("SEND", task["type"], task["id"], flush=True)
    enqueue_task(task)
    print("no wait. later: py dirty.py get", task["id"], flush=True)
    print("or open from_clean.txt on both machines", flush=True)
    return 0


def _extract_stdout(frame: dict) -> str:
    body = frame.get("body") if isinstance(frame.get("body"), dict) else {}
    if isinstance(body.get("body"), dict):
        # rare double-wrap
        inner = body["body"]
        body = {**body, **inner}
    for key in ("stdout", "host", "hostname", "out", "text", "saved"):
        if body.get(key) not in (None, ""):
            return str(body[key]).rstrip()
    if body.get("names"):
        return "\n".join(str(x) for x in body["names"])
    if body.get("lines"):
        return "\n".join(str(x) for x in body["lines"])
    if body.get("hits"):
        hits = body["hits"]
        if hits and isinstance(hits[0], dict):
            return "\n".join(f"{h.get('file')}:{h.get('line')}: {h.get('text')}" for h in hits)
        return "\n".join(str(x) for x in hits)
    if frame.get("type") in ("result", "ping") or frame.get("req") == "ping":
        parts = [body.get("host") or body.get("hostname"), body.get("user"), body.get("cwd") or body.get("cwd")]
        joined = " | ".join(str(p) for p in parts if p)
        if joined:
            return joined
    return json.dumps(frame, ensure_ascii=False, indent=2)


def cmd_ask(argv: list[str]) -> int:
    """Send one job and block until outbox reply. Default timeout 8s."""
    timeout = 8.0
    args = list(argv)
    if args and args[0] == "--timeout":
        if len(args) < 2:
            raise SystemExit("ask --timeout needs seconds")
        timeout = float(args[1])
        args = args[2:]
    elif args and args[0].startswith("--timeout="):
        timeout = float(args[0].split("=", 1)[1])
        args = args[1:]
    if not args:
        raise SystemExit("ask needs a type, e.g. ask hostname  OR  ask shell whoami")
    # Convenience: bare hostname/whoami -> shell
    if args[0].lower() in ("hostname", "whoami") and len(args) == 1:
        args = ["shell", args[0]]
    if args[0].lower() == "screenshot" and timeout <= 8:
        timeout = 25.0
    os.environ.setdefault("HOT_TRANSPORT", "matrix")
    task = parse_send(args)
    tid = task["id"]
    out = OUTBOX / f"{tid}.json"
    if out.is_file():
        try:
            out.unlink()
        except OSError:
            pass
    t0 = time.perf_counter()
    rtc = ask_via_rtc(task, timeout)
    if rtc is not None:
        ms = int((time.perf_counter() - t0) * 1000)
        print(_extract_stdout(rtc))
        print(f"# ok id={tid} {ms}ms rtc", flush=True)
        return 0 if rtc.get("ok", True) else 1
    enqueue_task(task, quiet=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if out.is_file():
            try:
                frame = json.loads(out.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                time.sleep(0.15)
                continue
            ms = int((time.perf_counter() - t0) * 1000)
            print(_extract_stdout(frame))
            print(f"# ok id={tid} {ms}ms", flush=True)
            return 0 if frame.get("ok", True) else 1
        time.sleep(0.2)
    print(f"TIMEOUT {timeout}s id={tid} (clean silent? restart start-clean.cmd)", flush=True)
    return 2


def _load_queue_tasks(src: str) -> list[dict]:
    p = Path(src)
    if p.is_file():
        obj = json.loads(p.read_text(encoding="utf-8"))
    else:
        obj = json.loads(src)
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and isinstance(obj.get("tasks"), list):
        return obj["tasks"]
    raise SystemExit("queue needs a json list or {\"tasks\": [...]} ")


def cmd_queue(argv: list[str]) -> int:
    if not argv:
        raise SystemExit("queue needs a json file")
    raw_tasks = _load_queue_tasks(argv[0])
    ids = []
    for item in raw_tasks:
        if not isinstance(item, dict):
            raise SystemExit("queue item must be object")
        task = dict(item)
        task.setdefault("id", uuid.uuid4().hex[:10])
        if not task.get("type"):
            if task.get("ops") or task.get("steps") or (isinstance(task.get("body"), dict) and (task["body"].get("ops") or task["body"].get("steps"))):
                task["type"] = "playbook"
            else:
                task["type"] = "ping"
        print("SEND", task["type"], task["id"], flush=True)
        enqueue_task(task)
        ids.append(task["id"])
    print("QUEUE", len(ids), " ".join(ids), flush=True)
    print("no wait. later: py dirty.py get <id>", flush=True)
    return 0


def cmd_cancel(argv: list[str]) -> int:
    if not argv:
        raise SystemExit("cancel needs id")
    root = P.detect_root("dirty")
    P.ensure_layout(root)
    for fid in argv:
        dest = P.write_cancel(root, fid)
        print("CANCEL", fid, dest, flush=True)
    return 0


def cmd_get(argv: list[str]) -> int:
    _local_layout()
    P.configure_stdio()
    if argv:
        path = OUTBOX / f"{argv[0]}.json"
    else:
        path = LOCAL / "from_clean.txt"
        if not path.is_file():
            root = P.detect_root("dirty")
            path = root / "from_clean.txt"
    if not path.is_file():
        print("NOT_YET", path)
        return 1
    print(path.read_text(encoding="utf-8", errors="replace"))
    return 0


def forward_local_jobs(root: Path) -> None:
    now = time.time()
    files = list(INBOX.glob("*.json"))
    for f in sorted(WORK.glob("*.json")):
        if f.name.endswith(".tmp"):
            continue
        try:
            if now - f.stat().st_mtime < 20:
                continue
        except OSError:
            continue
        files.append(f)
    for f in files:
        if f.name.endswith(".tmp"):
            continue
        dest = WORK / f.name
        if f.parent == INBOX:
            try:
                os.replace(f, dest)
            except OSError:
                continue
        try:
            task = P.read_json(dest)
        except Exception as e:
            task = {"id": dest.stem, "type": "ping", "body": {}}
            P.write_json(OUTBOX / dest.name, {"id": dest.stem, "ok": False, "error": f"bad json: {e}"})
            dest.unlink(missing_ok=True)
            continue
        if not task.get("id"):
            task["id"] = dest.stem
        try:
            P.put_frame(P.d2c_dir(root), task)
        except OSError as e:
            print("fwd fail", task.get("id"), e, flush=True)
            try:
                dest.touch()
            except OSError:
                pass
            continue
        dest.unlink(missing_ok=True)
        print("fwd", task.get("id"), task.get("type"), flush=True)


def harvest_results(root: Path) -> None:
    folder = P.c2d_dir(root)
    done = root / "pipe" / "c2d.done"
    for path, frame in P.take_new_frames(root, folder, done, "c2d"):
        fid = str(frame.get("id") or path.stem)
        P.write_json(OUTBOX / f"{fid}.json", frame)
        P.publish_live(LOCAL, frame)
        P.finish_frame(root, path, done, fid, "c2d")
        print("got", fid, "ok", (frame.get("body") or {}).get("ok", frame.get("ok")), flush=True)
    src = root / "from_clean.txt"
    dst = LOCAL / "from_clean.txt"
    if src.is_file():
        try:
            data = src.read_bytes()
            if (not dst.is_file()) or dst.read_bytes() != data:
                P.atomic_write(dst, data)
        except OSError:
            pass


def cmd_daemon() -> int:
    P.configure_stdio()
    _local_layout()
    write_pid()
    root = P.detect_root("dirty")
    P.ensure_layout(root)
    print("DIRTY ROOT", root, flush=True)
    print("local", LOCAL, flush=True)
    print("pid", os.getpid(), flush=True)
    try:
        while True:
            try:
                forward_local_jobs(root)
                harvest_results(root)
            except Exception as e:
                print("loop", e, flush=True)
            time.sleep(P.POLL)
    finally:
        try:
            if PIDFILE.is_file() and PIDFILE.read_text(encoding="utf-8").strip() == str(os.getpid()):
                PIDFILE.unlink(missing_ok=True)
        except OSError:
            pass


def main(argv: list[str]) -> int:
    P.configure_stdio()
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        if len(argv) < 2:
            return cmd_daemon()
        print(__doc__)
        return 2
    cmd = argv[1].lower()
    if cmd in ("ask", "a", "do"):
        return cmd_ask(argv[2:])
    if cmd in ("send", "s"):
        return cmd_send(argv[2:])
    if cmd in ("queue", "q"):
        return cmd_queue(argv[2:])
    if cmd in ("cancel", "x"):
        return cmd_cancel(argv[2:])
    if cmd in ("get", "cat", "last"):
        return cmd_get(argv[2:])
    if cmd in ("daemon", "watch"):
        return cmd_daemon()
    if cmd in ("ping", "shell", "tree", "list", "read", "write", "pull", "glob", "grep", "screenshot", "batch", "playbook", "mouse", "click", "key", "type"):
        return cmd_ask(argv[1:])
    print("unknown", cmd)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
