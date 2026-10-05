import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const live = join(homedir(), '.cursor', 'matrix-mcp-e2ee');
console.log(readFileSync(join(live, 'logs', 'bootstrap-dirty.log'), 'utf8').split(/\r?\n/).slice(-65).join('\n'));
console.log(await (await fetch('http://127.0.0.1:18765/status')).text());
