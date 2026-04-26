import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { GuideManager } from "../../src/resources/guides.js";

describe("GuideManager resource discovery", () => {
  it("should expose guide, skill, and prompt resources for MCP clients", async () => {
    const manager = new GuideManager();
    const resources = await manager.listAll();

    assert.ok(resources.some((resource) => resource.uri === "guide://security-hardening"));
    assert.ok(resources.some((resource) => resource.uri === "skill://nixos-debugging"));
    assert.ok(resources.some((resource) => resource.uri === "prompt://code-architect"));
  });
});
