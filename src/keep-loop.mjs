import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(HERE, "package.json")) ? HERE : join(HERE, "..");

const side = (process.argv[2] || process.env.HF_SIDE || "").toLowerCase();
if (side !== "dirty" && side !== "clean") {
  console.error("Usage: node keep-loop.mjs dirty|clean");
  process.exit(1);
}

process.env.HF_SIDE = side;
process.env.HF_RUNTIME_ROOT ||= ROOT;
process.exit(await runBootstrap(side, { runtimeRoot: ROOT }));
