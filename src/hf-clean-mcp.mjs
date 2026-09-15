import { randomBytes } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

console.log = (...a) => console.error(...a);

const RPC = process.env.HF_RPC_URL || "http://127.0.0.1:18765";

function extractText(frame) {
  const body = frame?.body && typeof frame.body === "object" ? frame.body : {};
  if (body.stdout) return String(body.stdout);
  if (body.text) return String(body.text);
  if (body.saved) return String(body.saved);
  if (body.host) return [body.host, body.user, body.cwd].filter(Boolean).join(" | ");
  if (Array.isArray(body.names)) return body.names.join("\n");
  if (Array.isArray(body.lines)) return body.lines.join("\n");
  if (Array.isArray(body.hits)) {
    return body.hits
      .map((h) => (typeof h === "object" ? `${h.file}:${h.line}: ${h.text}` : String(h)))
      .join("\n");
  }
  if (body.error) return String(body.error);
  const copy = { ...frame };
  if (copy.body && copy.body.blob_b64) copy.body = { ...copy.body, blob_b64: `[${copy.body.blob_b64.length} chars]` };
  return JSON.stringify(copy, null, 2);
}

async function rpcAsk(type, body, timeoutMs) {
  const task = { id: randomBytes(5).toString("hex"), type, body: body || {} };
  const st = await fetch(`${RPC}/status`).then((r) => r.json()).catch(() => ({ rtc: false }));
  if (!st.rtc) {
    throw new Error("rtc down: dirty hop not up or clean silent. Restart both hops");
  }
  const res = await fetch(`${RPC}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Timeout": String(timeoutMs) },
    body: JSON.stringify(task),
  });
  const text = await res.text();
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    throw new Error(`rpc ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(frame.error || `rpc ${res.status}`);
  return frame;
}

function textResult(frame, extra = []) {
  const ok = frame?.ok !== false;
  return {
    content: [{ type: "text", text: extractText(frame) }, ...extra],
    isError: !ok,
  };
}

function fail(e) {
  return { content: [{ type: "text", text: String(e.message || e) }], isError: true };
}

function maybeImage(body) {
  const b64 = body?.blob_b64;
  if (!b64) return [];
  if (String(b64).length > 6_000_000) return [];
  const mime = String(body.mime || "image/png");
  if (!mime.startsWith("image/")) return [];
  return [{ type: "image", data: b64, mimeType: mime }];
}

const server = new McpServer(
  { name: "clean-pc", version: "1.2.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Native Cursor Read/Grep/Shell see the operator disk only. Use these tools for the remote (clean) host.",
  }
);

server.registerTool(
  "clean_context",
  {
    title: "Remote host snapshot",
    description: "Hostname, user, optional project root and helper script on the clean host.",
    inputSchema: {},
  },
  async () => {
    try {
      return textResult(await rpcAsk("context", {}, 20000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_lab",
  {
    title: "Remote helper script",
    description: "Run HF_LAB_SCRIPT on the clean host. Requires HF_LAB_SCRIPT in the clean hop env.",
    inputSchema: {
      args: z.string().describe("Arguments after the helper script"),
      timeout: z.number().int().optional().describe("Seconds, default 120"),
    },
  },
  async ({ args, timeout }) => {
    try {
      const t = Number(timeout) || 120;
      return textResult(await rpcAsk("lab", { args, timeout: t }, (t + 3) * 1000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_status",
  {
    title: "Clean host status",
    description: "Check if the WebRTC tunnel to the clean host is up.",
    inputSchema: {},
  },
  async () => {
    try {
      const st = await fetch(`${RPC}/status`).then((r) => r.json()).catch((e) => ({ rtc: false, error: String(e.message || e) }));
      return { content: [{ type: "text", text: JSON.stringify(st) }], isError: !st.rtc };
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_shell",
  {
    title: "Clean host shell",
    description: "Run a command on the clean host, not in this Cursor workspace. Do not wait on GUI apps.",
    inputSchema: {
      cmd: z.string().describe("Command line"),
      cwd: z.string().optional().describe("Working directory on the clean host"),
      timeout: z.number().int().optional().describe("Seconds, default 120"),
    },
  },
  async ({ cmd, cwd, timeout }) => {
    try {
      const t = Number(timeout) || 120;
      return textResult(await rpcAsk("shell", { cmd, cwd, timeout: t }, (t + 3) * 1000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_list",
  {
    title: "Clean host list dir",
    description: "List a directory on the clean host.",
    inputSchema: { path: z.string().describe("Absolute path on the clean host") },
  },
  async ({ path }) => {
    try {
      return textResult(await rpcAsk("list", { path }, 15000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_tree",
  {
    title: "Clean host tree",
    description: "Shallow directory tree on the clean host.",
    inputSchema: {
      path: z.string(),
      depth: z.number().int().optional(),
    },
  },
  async ({ path, depth }) => {
    try {
      return textResult(await rpcAsk("tree", { path, depth: depth ?? 2 }, 20000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_read",
  {
    title: "Clean host read file",
    description: "Read a file on the clean host. Images come back as image content plus a local path on the operator.",
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    try {
      const frame = await rpcAsk("read", { path }, 25000);
      return textResult(frame, maybeImage(frame.body || {}));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_write",
  {
    title: "Clean host write file",
    description: "Write a UTF-8 file on the clean host.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
    },
  },
  async ({ path, content }) => {
    try {
      return textResult(await rpcAsk("write", { path, content }, 20000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_glob",
  {
    title: "Clean host glob",
    description: "Find files by name glob under a path on the clean host.",
    inputSchema: {
      path: z.string(),
      pattern: z.string().optional(),
    },
  },
  async ({ path, pattern }) => {
    try {
      return textResult(await rpcAsk("glob", { path, pattern: pattern || "*" }, 25000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_grep",
  {
    title: "Clean host grep",
    description: "Search file contents on the clean host. Native Grep sees the operator disk only.",
    inputSchema: {
      path: z.string(),
      pattern: z.string(),
      glob: z.string().optional(),
    },
  },
  async ({ path, pattern, glob }) => {
    try {
      return textResult(await rpcAsk("grep", { path, pattern, glob: glob || "*" }, 25000));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "clean_screenshot",
  {
    title: "Clean host screenshot",
    description: "Capture the clean host desktop and return a PNG (also saved under operator local/shots).",
    inputSchema: {
      fmt: z.enum(["png", "jpeg"]).optional(),
    },
  },
  async ({ fmt }) => {
    try {
      const frame = await rpcAsk("screenshot", fmt ? { fmt } : {}, 30000);
      return textResult(frame, maybeImage(frame.body || {}));
    } catch (e) {
      return fail(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("clean-pc mcp stdio");
