import assert from "node:assert/strict";
import test from "node:test";
import {
  hopSyncFilterDefinition,
  mapKeysUploadResponse,
  shouldInitRustCrypto,
} from "../src/hop-client-mode.js";

test("hop daemon does not start rust crypto", () => {
  const prev = process.env.HF_SIDE;
  process.env.HF_SIDE = "clean";
  try {
    assert.equal(shouldInitRustCrypto(), false);
  } finally {
    if (prev == null) delete process.env.HF_SIDE;
    else process.env.HF_SIDE = prev;
  }
});

test("dirty hop daemon does not start rust crypto", () => {
  const prev = process.env.HF_SIDE;
  process.env.HF_SIDE = "dirty";
  try {
    assert.equal(shouldInitRustCrypto(), false);
  } finally {
    if (prev == null) delete process.env.HF_SIDE;
    else process.env.HF_SIDE = prev;
  }
});

test("MCP client still starts rust crypto", () => {
  const prev = process.env.HF_SIDE;
  delete process.env.HF_SIDE;
  try {
    assert.equal(shouldInitRustCrypto(), true);
  } finally {
    if (prev == null) delete process.env.HF_SIDE;
    else process.env.HF_SIDE = prev;
  }
});

test("keys/upload already exists is treated as success so rust stops retrying", () => {
  const mapped = mapKeysUploadResponse(
    "https://mtx-1.zala-soft.com/_matrix/client/v3/keys/upload",
    400,
    '{"errcode":"M_INVALID","error":"One time key signed_curve25519:AAAAAAAAADo already exists"}',
  );
  assert.equal(mapped.status, 200);
  assert.equal(mapped.body, "{}");
});

test("other 400 keys/upload stay 400", () => {
  const mapped = mapKeysUploadResponse(
    "https://mtx-1.zala-soft.com/_matrix/client/v3/keys/upload",
    400,
    '{"errcode":"M_FORBIDDEN","error":"nope"}',
  );
  assert.equal(mapped.status, 400);
});

test("hop sync filter has no rooms", () => {
  const def = hopSyncFilterDefinition();
  assert.deepEqual(def.room.rooms, []);
  assert.deepEqual(def.presence.not_types, ["*"]);
});

test("pinnedFetch maps keys\/upload already-exists", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/network-policy.ts", import.meta.url), "utf8");
  assert.match(src, /mapKeysUploadResponse/);
  assert.match(src, /keys\/upload/);
});
