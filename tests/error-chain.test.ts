import assert from "node:assert/strict";
import test from "node:test";
import { formatErrorChain } from "../src/error-chain.js";

test("formatErrorChain includes undici cause code", () => {
  const err = new Error("fetch failed");
  const cause = new Error("Connect Timeout Error");
  (cause as Error & { code: string }).code = "UND_ERR_CONNECT_TIMEOUT";
  (err as Error & { cause: Error }).cause = cause;
  assert.equal(
    formatErrorChain(err),
    "fetch failed <- UND_ERR_CONNECT_TIMEOUT Connect Timeout Error",
  );
});
