import http from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2]);
const stateFile = process.argv[3];
if (!Number.isInteger(port) || port < 1 || !stateFile) {
  throw new Error("usage: node fake-tray-status.mjs <port> <state-file>");
}

http
  .createServer((_request, response) => {
    try {
      const body = readFileSync(stateFile, "utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  })
  .listen(port, "127.0.0.1");
