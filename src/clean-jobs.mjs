import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { basename, dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import os from "os";
import { execFileSync, execSync } from "child_process";
import { LIVE_QUALITY, LIVE_MAXW, normalizeScreens } from "./view-shot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_OUT = 400_000;
const MAX_TREE = 800;
const MAX_GLOB = 400;
const MAX_GREP = 80;
const MAX_GREP_FILE = 2_000_000;
const MAX_INLINE = 200_000;
const MAX_BLOB = 8_000_000;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", ".pytest_cache"]);
const BIN_EXT = new Set([
  ".exe",
  ".dll",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".zip",
  ".rar",
  ".7z",
  ".whl",
  ".pyc",
  ".pyd",
  ".so",
  ".pdf",
]);

function bodyOf(frame) {
  return frame.body && typeof frame.body === "object" ? frame.body : {};
}

function walkFiles(root, onFile) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(join(dir, ent.name));
      } else if (ent.isFile()) {
        onFile(join(dir, ent.name), ent.name);
      }
    }
  }
}

function matchGlob(name, pattern) {
  const esc = String(pattern || "*")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i").test(name);
}

function opPing() {
  return {
    ok: true,
    host: os.hostname(),
    user: os.userInfo().username,
    cwd: process.cwd(),
  };
}

function opShell(body) {
  try {
    const stdout = execSync(String(body.cmd || ""), {
      cwd: body.cwd || undefined,
      timeout: (Number(body.timeout) || 120) * 1000,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_OUT,
    });
    return { ok: true, exit: 0, stdout: String(stdout).slice(-MAX_OUT), stderr: "" };
  } catch (e) {
    return {
      ok: false,
      exit: e.status ?? 1,
      stdout: String(e.stdout || "").slice(-MAX_OUT),
      stderr: String(e.stderr || e.message || "").slice(-MAX_OUT),
    };
  }
}

function opList(body) {
  const p = String(body.path || "");
  if (!existsSync(p)) return { ok: false, error: `missing ${p}` };
  const names = readdirSync(p).sort().slice(0, 500);
  return { ok: true, path: p, names };
}

function opTree(body) {
  const p = String(body.path || "");
  const depth = Number(body.depth) || 2;
  if (!existsSync(p)) return { ok: false, error: `missing ${p}` };
  const lines = [`[D] ${p}`];
  function walk(cur, d, prefix) {
    if (lines.length >= MAX_TREE) return;
    let ents = [];
    try {
      ents = readdirSync(cur, { withFileTypes: true }).sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) {
      lines.push(`${prefix}ERR ${e.message || e}`);
      return;
    }
    for (const ent of ents) {
      if (lines.length >= MAX_TREE) {
        lines.push(`${prefix}...`);
        return;
      }
      const mark = ent.isDirectory() ? "[D]" : "[F]";
      lines.push(`${prefix}${mark} ${ent.name}`);
      if (ent.isDirectory() && d > 0 && !SKIP_DIRS.has(ent.name)) {
        walk(join(cur, ent.name), d - 1, prefix + "  ");
      }
    }
  }
  walk(p, depth, "  ");
  return { ok: true, path: p, depth, lines, truncated: lines.length >= MAX_TREE };
}

function opGlob(body) {
  const p = String(body.path || "");
  const pattern = body.pattern || "*";
  if (!existsSync(p)) return { ok: false, error: `missing ${p}` };
  const hits = [];
  let truncated = false;
  walkFiles(p, (fp, name) => {
    if (hits.length >= MAX_GLOB) {
      truncated = true;
      return;
    }
    const rel = fp.replace(/\\/g, "/");
    if (matchGlob(name, pattern) || matchGlob(rel, pattern)) hits.push(fp);
  });
  return { ok: true, path: p, pattern, hits: hits.slice(0, MAX_GLOB), truncated };
}

function opGrep(body) {
  const p = String(body.path || "");
  const pattern = String(body.pattern || "");
  const nameGlob = body.glob || "*";
  if (!existsSync(p)) return { ok: false, error: `missing ${p}` };
  let rx;
  try {
    rx = new RegExp(pattern, body.i === false ? "" : "i");
  } catch (e) {
    return { ok: false, error: `bad regex: ${e.message || e}` };
  }
  const hits = [];
  let files = 0;
  let truncated = false;
  walkFiles(p, (fp, name) => {
    if (hits.length >= MAX_GREP) {
      truncated = true;
      return;
    }
    if (!matchGlob(name, nameGlob)) return;
    if (BIN_EXT.has(extname(name).toLowerCase())) return;
    let st;
    try {
      st = statSync(fp);
    } catch {
      return;
    }
    if (st.size > MAX_GREP_FILE) return;
    files += 1;
    let text;
    try {
      text = readFileSync(fp, "utf8");
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (rx.test(lines[i])) {
        hits.push({ file: fp, line: i + 1, text: lines[i].slice(0, 400) });
        if (hits.length >= MAX_GREP) {
          truncated = true;
          return;
        }
      }
    }
  });
  return { ok: true, path: p, pattern, files, hits, truncated };
}

function opRead(body) {
  const p = String(body.path || "");
  let data;
  try {
    data = readFileSync(p);
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  if (data.length > MAX_BLOB) return { ok: false, error: `too big ${data.length}` };
  const asBlob = Boolean(body.blob || body.binary) || BIN_EXT.has(extname(p).toLowerCase()) || data.length > MAX_INLINE;
  if (asBlob) {
    return {
      ok: true,
      path: p,
      bytes: data.length,
      mime: "application/octet-stream",
      blob_b64: data.toString("base64"),
      inlined: false,
    };
  }
  return {
    ok: true,
    path: p,
    bytes: data.length,
    text: data.toString(body.encoding || "utf8"),
    inlined: true,
  };
}

function opWrite(body) {
  const p = String(body.path || "");
  mkdirSync(dirname(p), { recursive: true });
  let buf;
  if (body.blob_b64) buf = Buffer.from(String(body.blob_b64), "base64");
  else buf = Buffer.from(String(body.content || ""), "utf8");
  writeFileSync(p, buf);
  return { ok: true, path: p, bytes: buf.length };
}

function captureOnce(req, timeoutMs) {
  const ps1 = join(HERE, "capture-loop.ps1");
  const stdout = execFileSync(
    "powershell.exe",
    ["-STA", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1],
    {
      input: JSON.stringify(req) + "\n",
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: MAX_OUT,
    }
  );
  const line = String(stdout || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) throw new Error("capture empty");
  return JSON.parse(line);
}

async function opScreenshot(body = {}) {
  const jpeg = String(body.fmt || body.format || "").toLowerCase() === "jpeg" || body.jpeg === true;
  const quality = Math.min(90, Math.max(18, Number(body.quality) || (jpeg ? LIVE_QUALITY : 80)));
  const maxw = Math.max(0, Number(body.maxw) || (jpeg ? LIVE_MAXW : 0));
  const display = Math.max(0, Math.floor(Number(body.display) || 0));
  const ext = jpeg ? ".jpg" : ".png";
  const tag = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const out = join(os.tmpdir(), `cap-${tag}${ext}`);
  const meta = join(os.tmpdir(), `cap-${tag}.json`);
  const ps1 = join(os.tmpdir(), `cap-${tag}.ps1`);
  const outEsc = out.replace(/'/g, "''");
  const metaEsc = meta.replace(/'/g, "''");
  const saveBlock = jpeg
    ? [
        "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
        "$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)",
        `$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})`,
        `$bmp.Save('${outEsc}', $codec, $ep)`,
      ]
    : [`$bmp.Save('${outEsc}', [System.Drawing.Imaging.ImageFormat]::Png)`];

  if (jpeg) {
    try {
      const geom = captureOnce({ display, maxw, quality, out }, 20000);
      if (!geom?.ok) return { ok: false, error: geom?.error || "capture failed" };
      const data = readFileSync(out);
      if (data.length > MAX_BLOB) return { ok: false, error: `shot too big ${data.length}` };
      return {
        ok: true,
        bytes: data.length,
        mime: "image/jpeg",
        blob_b64: data.toString("base64"),
        left: geom.left ?? 0,
        top: geom.top ?? 0,
        width: geom.width,
        height: geom.height,
        screens: normalizeScreens(geom.screens),
        display,
      };
    } catch {
      // one-shot fallback below
    } finally {
      try {
        unlinkSync(out);
      } catch {
        // ignore
      }
    }
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class HfDpi { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); }'",
    "[void][HfDpi]::SetProcessDPIAware()",
    `$display = ${display}`,
    `$maxw = ${maxw}`,
    "$screens = @([System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y })",
    "if ($display -lt 0 -or $display -ge $screens.Count) { $scr = $screens | Where-Object { $_.Primary } | Select-Object -First 1 } else { $scr = $screens[$display] }",
    "if (-not $scr) { $scr = $screens[0] }",
    "$b = $scr.Bounds",
    "$bmp = New-Object System.Drawing.Bitmap ([int]$b.Width), ([int]$b.Height)",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen([int]$b.X, [int]$b.Y, 0, 0, $bmp.Size)",
    "$g.Dispose()",
    "if ($maxw -gt 0 -and $b.Width -gt $maxw) {",
    "  $nw = [int]$maxw",
    "  $nh = [Math]::Max(1, [int]($b.Height * $maxw / $b.Width))",
    "  $small = New-Object System.Drawing.Bitmap $nw, $nh",
    "  $gs = [System.Drawing.Graphics]::FromImage($small)",
    "  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low",
    "  $gs.DrawImage($bmp, 0, 0, $nw, $nh)",
    "  $gs.Dispose()",
    "  $bmp.Dispose()",
    "  $bmp = $small",
    "}",
    ...saveBlock,
    "$list = @()",
    "for ($i = 0; $i -lt $screens.Count; $i++) { $sb = $screens[$i].Bounds; $list += @{ i = $i; x = [int]$sb.X; y = [int]$sb.Y; width = [int]$sb.Width; height = [int]$sb.Height; primary = [bool]$screens[$i].Primary } }",
    "$meta = @{ left = [int]$b.X; top = [int]$b.Y; width = [int]$b.Width; height = [int]$b.Height; screens = $list } | ConvertTo-Json -Compress -Depth 6",
    `[System.IO.File]::WriteAllText('${metaEsc}', $meta)`,
    "$bmp.Dispose()",
  ].join("\r\n");
  writeFileSync(ps1, script, "utf8");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1], {
      timeout: 20000,
      windowsHide: true,
    });
    const data = readFileSync(out);
    if (data.length > MAX_BLOB) return { ok: false, error: `shot too big ${data.length}` };
    let geom = {};
    try {
      geom = JSON.parse(readFileSync(meta, "utf8"));
    } catch {
      geom = {};
    }
    return {
      ok: true,
      bytes: data.length,
      mime: jpeg ? "image/jpeg" : "image/png",
      blob_b64: data.toString("base64"),
      left: geom.left ?? 0,
      top: geom.top ?? 0,
      width: geom.width,
      height: geom.height,
      screens: normalizeScreens(geom.screens),
      display,
      cursor_x: geom.cursor_x,
      cursor_y: geom.cursor_y,
    };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message || e).slice(-2000) };
  } finally {
    for (const p of [ps1, out, meta]) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
}

function opInput(body) {
  const spec = { ...body };
  if (!spec.op) spec.op = spec.action || "click";
  const jsonPath = join(os.tmpdir(), `hf-in-${Date.now()}.json`);
  const ps1 = join(HERE, "input.ps1");
  if (!existsSync(ps1)) return { ok: false, error: "input.ps1 missing" };
  writeFileSync(jsonPath, JSON.stringify(spec), "utf8");
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, jsonPath],
      { timeout: 15000, windowsHide: true, encoding: "utf8" }
    );
    const line = String(stdout || "").trim().split(/\r?\n/).pop() || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = { raw: line };
    }
    return { ok: true, ...parsed };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message || e).slice(-2000) };
  } finally {
    try {
      unlinkSync(jsonPath);
    } catch {
      // ignore
    }
  }
}

export async function runCleanJob(frame) {
  const t = String(frame.type || "ping").toLowerCase();
  const body = bodyOf(frame);
  try {
    if (t === "ping") return opPing();
    if (t === "shell") return opShell(body);
    if (t === "list") return opList(body);
    if (t === "tree") return opTree(body);
    if (t === "glob") return opGlob(body);
    if (t === "grep") return opGrep(body);
    if (t === "read") return opRead(body);
    if (t === "write") return opWrite(body);
    if (t === "pull") return opRead({ ...body, blob: true });
    if (t === "screenshot") return await opScreenshot(body);
    if (t === "mouse" || t === "pointer" || t === "click") {
      return opInput({ ...body, op: body.op || body.action || (t === "click" ? "click" : "move") });
    }
    if (t === "key" || t === "keyboard" || t === "type" || t === "hotkey") {
      const op = t === "type" || body.text ? "type" : "key";
      return opInput({ ...body, op: body.op || body.action || op });
    }
    if (t === "input") return opInput(body);
    return { ok: false, error: `no handler for ${t}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
