import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  getSemanticCacheMaxResponseBytes,
  isCacheableResult,
  shouldAttemptSemanticCache,
  shouldStoreSemanticCache,
} from "../../src/utils/cache-policy.js";

describe("semantic cache policy", () => {
  it("should skip volatile operational tools", () => {
    assert.equal(shouldAttemptSemanticCache("server_status"), false);
    assert.equal(shouldAttemptSemanticCache("server_health"), false);
    assert.equal(shouldAttemptSemanticCache("workspace_quality_gate"), false);
    assert.equal(shouldAttemptSemanticCache("package_diagnose"), true);
  });

  it("should reject cache storage for error results", () => {
    assert.equal(isCacheableResult({ isError: true, content: [] }), false);
    assert.equal(
      shouldStoreSemanticCache({
        toolName: "package_diagnose",
        result: { isError: true, content: [] },
        responseSize: 256,
      }),
      false
    );
  });

  it("should reject overly large responses for semantic storage", () => {
    assert.equal(
      shouldStoreSemanticCache({
        toolName: "package_diagnose",
        result: { content: [{ type: "text", text: "ok" }] },
        responseSize: getSemanticCacheMaxResponseBytes() + 1,
      }),
      false
    );
  });

  it("should allow normal successful responses", () => {
    assert.equal(
      shouldStoreSemanticCache({
        toolName: "package_diagnose",
        result: { content: [{ type: "text", text: "ok" }] },
        responseSize: 1024,
      }),
      true
    );
  });
});
