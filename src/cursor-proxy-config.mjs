export const CURSOR_PROXY_KEYS = [
  "http.proxy",
  "https.proxy",
  "http.proxySupport",
  "cursor.general.disableHttp2",
];

export function egressPort(env = process.env) {
  return Number(env.HF_EGRESS_PORT || 18766);
}

export function proxySettingsValues(port) {
  const p = Number(port);
  return {
    "http.proxy": `http://127.0.0.1:${p}`,
    "https.proxy": `http://127.0.0.1:${p}`,
    "http.proxySupport": "override",
    "cursor.general.disableHttp2": true,
  };
}

export function shortcutArgs(port) {
  return [`--proxy-server=http://127.0.0.1:${Number(port)}`];
}

export function firewallSpec(cursorExe) {
  const program = String(cursorExe || "");
  return [
    {
      name: "HFPipe-Cursor-allow-loopback",
      action: "allow",
      direction: "outbound",
      program,
      remote: "127.0.0.0/8",
    },
    {
      name: "HFPipe-Cursor-block-out-v4",
      action: "block",
      direction: "outbound",
      program,
      remote: ["0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255"],
    },
    {
      name: "HFPipe-Cursor-block-out-v6",
      action: "block",
      direction: "outbound",
      program,
      remote: "any",
      ipv6: true,
    },
  ];
}

function jsonLiteral(value) {
  return JSON.stringify(value);
}

function upsertKey(text, key, value) {
  const lit = jsonLiteral(value);
  const re = new RegExp(`("${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*)([^,\\n}]+)`);
  if (re.test(text)) return text.replace(re, `$1${lit}`);
  const idx = text.lastIndexOf("}");
  if (idx < 0) return `{\n    "${key}": ${lit}\n}\n`;
  const before = text.slice(0, idx).replace(/[ \t]+$/g, "");
  const needsComma = /["\dtruefalsenull\]]\s*$/.test(before.replace(/\s+$/g, ""));
  const pad = before.endsWith("\n") ? "    " : "\n    ";
  const insert = `${needsComma ? "," : ""}${pad}"${key}": ${lit}\n`;
  return `${before}${insert}${text.slice(idx)}`;
}

export function mergeCursorSettings(raw, port) {
  let text = String(raw ?? "").trim() ? String(raw) : "{\n}\n";
  const values = proxySettingsValues(port);
  for (const [key, value] of Object.entries(values)) text = upsertKey(text, key, value);
  return text;
}

export function stripCursorProxySettings(raw) {
  let text = String(raw ?? "");
  for (const key of CURSOR_PROXY_KEYS) {
    text = text.replace(
      new RegExp(`\\s*,?\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*[^,\\n}]+`, "g"),
      "",
    );
  }
  return text;
}

export function desktopShortcutSpec(cursorExe, port) {
  return {
    name: "Cursor (hf-pipe).lnk",
    target: String(cursorExe || ""),
    args: shortcutArgs(port).join(" "),
  };
}

export function applyCursorEgressConfig(options = {}) {
  if (options.cursorRunning?.()) throw new Error("close Cursor before install");
  const port = Number(options.port ?? egressPort(options.env));
  const raw = options.readSettings?.() ?? "";
  const settings = mergeCursorSettings(raw, port);
  options.writeSettings?.(settings);
  return {
    settings,
    shortcut: desktopShortcutSpec(options.cursorExe, port),
    firewall: firewallSpec(options.cursorExe),
    port,
  };
}

export function revertCursorEgressConfig(options = {}) {
  const raw = options.readSettings?.() ?? "";
  const settings = stripCursorProxySettings(raw);
  options.writeSettings?.(settings);
  return {
    settings,
    firewallNames: firewallSpec(options.cursorExe).map((rule) => rule.name),
    shortcutName: desktopShortcutSpec(options.cursorExe, options.port ?? egressPort(options.env)).name,
  };
}
