import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile, secretsDir, sessionFile } from "../src/config.mjs";
import { ensureReleaseKeyPair } from "../src/release-key.mjs";

loadEnvFile();
const session = JSON.parse(readFileSync(sessionFile(), "utf8"));
if (!session.user_id || !session.device_id) throw new Error("A Matrix user and device session are required for enrollment");
// This separate directory is a device identity, never the release signing authority.
const keys = ensureReleaseKeyPair(join(secretsDir(), "peer-identity"));
console.log(JSON.stringify({ userId: session.user_id, deviceId: session.device_id, publicKey: keys.publicKey }));
