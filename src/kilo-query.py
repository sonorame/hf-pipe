# -*- coding: utf-8 -*-
import json
import sqlite3
import sys

SESSION_LIMIT = 48
PART_SCAN = 40
THREAD_LIMIT = 40


def db_uri(path):
    p = str(path or "").replace("\\", "/")
    return f"file:{p}?mode=ro&immutable=1"


def as_text_row(row):
    item = dict(row)
    data = item.get("data")
    parsed = data
    if isinstance(data, (bytes, bytearray)):
        try:
            data = data.decode("utf-8")
            item["data"] = data
        except Exception:
            return None
    if isinstance(data, str):
        try:
            parsed = json.loads(data)
        except Exception:
            return None
    if not isinstance(parsed, dict) or parsed.get("type") != "text":
        return None
    if not str(parsed.get("text") or "").strip():
        return None
    return item


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    db = sys.argv[1]
    kind = sys.argv[2]
    con = sqlite3.connect(db_uri(db), uri=True, timeout=0.4)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    if kind == "sessions":
        rows = cur.execute(
            "SELECT id, title, directory, agent, model, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT ?",
            (SESSION_LIMIT,),
        )
        out = [dict(row) for row in rows]
        for item in out:
            sid = item.get("id")
            last = None
            part_rows = cur.execute(
                "SELECT session_id, time_created, data FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT ?",
                (str(sid), PART_SCAN),
            )
            for row in part_rows:
                text_row = as_text_row(row)
                if text_row:
                    last = text_row
                    break
            item["last_text"] = ""
            if last:
                payload = last.get("data")
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except Exception:
                        payload = None
                if isinstance(payload, dict):
                    item["last_text"] = str(payload.get("text") or "").strip()
    elif kind == "parts":
        ids = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
        out = []
        for sid in ids:
            rows = cur.execute(
                "SELECT session_id, time_created, data FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT ?",
                (str(sid), PART_SCAN),
            )
            last = None
            for row in rows:
                text_row = as_text_row(row)
                if text_row:
                    last = text_row
                    break
            if last:
                out.append(last)
    elif kind == "thread":
        sid = sys.argv[3] if len(sys.argv) > 3 else ""
        rows = cur.execute(
            "SELECT session_id, time_created, data FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT ?",
            (sid, THREAD_LIMIT),
        )
        found = []
        for row in rows:
            text_row = as_text_row(row)
            if text_row:
                found.append(text_row)
        found.reverse()
        out = found
    else:
        raise SystemExit(2)
    con.close()
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
