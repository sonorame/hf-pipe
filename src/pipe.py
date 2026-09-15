# Shared byte-pipe over the hot folder. Python 3 stdlib only.
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

POLL = 0.5
SEQ_WIDTH = 8
MAX_INLINE = 80_000
MAX_JSON = 400_000

DIRTY_CANDS = [
    Path(r"\\edsizhfs0001\Share13\malykh_kirill\folderhot"),
    Path(r"\\edsizhfs0001\Share13\malykh_kirill\folerhot"),
    Path(r"Z:\malykh_kirill\folderhot"),
    Path(r"Z:\malykh_kirill\folerhot"),
    Path(r"\\edsizhfs0004.five.loc\malykh_kirill\folderhot"),
    Path(r"\\edsizhfs0004.five.loc\malykh_kirill\folerhot"),
    Path(r"Z:\cursor-hot"),
]

CLEAN_CANDS = [
    Path(r"Z:\malykh_kirill\folderhot"),
    Path(r"\\edsizhfs0004.five.loc\malykh_kirill\folderhot"),
    Path(r"\\edsizhfs0001\Share13\malykh_kirill\folderhot"),
    Path(r"\\edsizhfs0001\Share13\malykh_kirill\folerhot"),
    Path(r"\\edsizhfs0004.five.loc\malykh_kirill\folerhot"),
    Path(r"Z:\malykh_kirill\folerhot"),
    Path(r"Z:\cursor-hot"),
]


def configure_stdio() -> None:
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_json(path: Path, obj: dict) -> None:
    raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    atomic_write(path, raw)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _probe(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
        ensure_layout(p)
        probe = p / ".pipe-ok"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def detect_root(side: str = "dirty") -> Path:
    env = os.environ.get("HOT_ROOT", "").strip()
    here = Path(__file__).resolve().parent
    txt = here / "root.txt"
    cands: list[Path] = []
    if env:
        cands.append(Path(env))
    used_root_txt = False
    if txt.is_file():
        line = txt.read_text(encoding="utf-8", errors="replace").strip()
        if line in (".", "here"):
            cands.append(here)
            used_root_txt = True
        elif line:
            cands.append(Path(line))
            used_root_txt = True
    if not used_root_txt:
        cands.append(here)
    cands.extend(CLEAN_CANDS if side == "clean" else DIRTY_CANDS)
    seen: set[str] = set()
    last_err = None
    for p in cands:
        key = str(p).lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            if _probe(p):
                return p
        except OSError as e:
            last_err = e
            continue
    raise SystemExit(f"HOT_ROOT not writable. last error: {last_err}")


def ensure_layout(root: Path) -> None:
    for sub in (
        "pipe/d2c",
        "pipe/c2d",
        "pipe/d2c.done",
        "pipe/c2d.done",
        "pipe/seen/d2c",
        "pipe/seen/c2d",
        "pipe/cancel",
        "blob",
        "inbox",
        "outbox",
        "work",
    ):
        (root / sub).mkdir(parents=True, exist_ok=True)


def d2c_dir(root: Path) -> Path:
    return root / "pipe" / "d2c"


def c2d_dir(root: Path) -> Path:
    return root / "pipe" / "c2d"


def cancel_dir(root: Path) -> Path:
    return root / "pipe" / "cancel"


def cancel_path(root: Path, frame_id: str) -> Path:
    safe = "".join(ch for ch in str(frame_id) if ch.isalnum() or ch in "-_.")[:80]
    return cancel_dir(root) / safe


def is_cancelled(root: Path, frame_id: str | None) -> bool:
    if not frame_id:
        return False
    return cancel_path(root, frame_id).is_file()


def write_cancel(root: Path, frame_id: str) -> Path:
    cancel_dir(root).mkdir(parents=True, exist_ok=True)
    dest = cancel_path(root, frame_id)
    dest.write_text("1", encoding="utf-8")
    return dest


def seen_path(root: Path, lane: str, frame_id: str) -> Path:
    return root / "pipe" / "seen" / lane / frame_id


def already_seen(root: Path, lane: str, frame_id: str) -> bool:
    return seen_path(root, lane, frame_id).is_file()


def mark_seen(root: Path, lane: str, frame_id: str) -> None:
    p = seen_path(root, lane, frame_id)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("1", encoding="utf-8")
    except OSError:
        pass


def _seq_from_name(name: str) -> int:
    head = name.split("_", 1)[0]
    try:
        return int(head)
    except ValueError:
        return 0


def next_seq(folder: Path) -> int:
    n = 0
    try:
        names = os.listdir(folder)
    except OSError:
        return 1
    for name in names:
        if not name.endswith(".json") or name.endswith(".tmp"):
            continue
        n = max(n, _seq_from_name(name))
    return n + 1


def frame_name(seq: int, frame_id: str) -> str:
    return f"{seq:0{SEQ_WIDTH}d}_{frame_id}.json"


def put_frame(folder: Path, frame: dict) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    frame_id = frame.get("id") or uuid.uuid4().hex[:10]
    frame["id"] = frame_id
    seq = int(frame.get("seq") or next_seq(folder))
    frame["seq"] = seq
    dest = folder / frame_name(seq, frame_id)
    write_json(dest, frame)
    return dest


def list_frames(folder: Path) -> list[Path]:
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    out = []
    for name in names:
        if not name.endswith(".json") or name.endswith(".tmp"):
            continue
        out.append(folder / name)
    out.sort(key=lambda p: (_seq_from_name(p.name), p.name))
    return out


def take_new_frames(root: Path, folder: Path, done_dir: Path, lane: str) -> list[tuple[Path, dict]]:
    done_dir.mkdir(parents=True, exist_ok=True)
    got = []
    for path in list_frames(folder):
        marker = done_dir / path.name
        if marker.is_file():
            continue
        try:
            frame = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        fid = str(frame.get("id") or path.stem)
        if already_seen(root, lane, fid):
            try:
                write_json(marker, {"id": fid, "dup": True})
            except OSError:
                pass
            continue
        got.append((path, frame))
    return got


def finish_frame(root: Path, path: Path, done_dir: Path, frame_id: str, lane: str) -> None:
    mark_seen(root, lane, frame_id)
    try:
        write_json(done_dir / path.name, {"id": frame_id})
    except OSError:
        pass
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def publish_live(root: Path, obj: dict) -> None:
    """Last answer. Skip LAST.json on share - DFS often denies replace."""
    raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    try:
        atomic_write(root / "from_clean.txt", raw)
    except OSError:
        pass
    try:
        write_json(root / "LAST.json", obj)
    except OSError:
        pass


def write_blob(root: Path, frame_id: str, rel: str, data: bytes) -> str:
    dest = root / "blob" / frame_id / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(dest, data)
    return str(dest)


def maybe_inline(text: str, limit: int = MAX_INLINE) -> tuple[str | None, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True
