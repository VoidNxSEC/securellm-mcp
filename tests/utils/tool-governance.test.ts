import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ToolGovernanceManager } from "../../src/utils/tool-governance.js";

describe("ToolGovernanceManager", () => {
  it("should derive defaults for operational tools", () => {
    const manager = new ToolGovernanceManager();
    const metadata = manager.getMetadata({ name: "ci_failure_summary" });

    assert.equal(metadata.priority, "high");
    assert.equal(metadata.executionClass, "diagnostic");
    assert.equal(metadata.costTier, "cheap");
    assert.equal(metadata.volatile, true);
  });

  it("should sort critical and high priority tools first", () => {
    const manager = new ToolGovernanceManager();
    const sorted = manager.sortTools([
      { name: "web_crawl", inputSchema: { type: "object", properties: {} } },
      { name: "system_health_check", inputSchema: { type: "object", properties: {} } },
      { name: "ci_failure_summary", inputSchema: { type: "object", properties: {} } },
    ]);

    assert.equal(sorted[0]?.name, "system_health_check");
    assert.equal(sorted[1]?.name, "ci_failure_summary");
    assert.equal(sorted[2]?.name, "web_crawl");
  });

  it("should summarize blocked tools and priority counts", () => {
    const previousDisabled = process.env.TOOL_DISABLED_LIST;

    process.env.TOOL_DISABLED_LIST = "web_crawl";
    const manager = new ToolGovernanceManager();
    const summary = manager.summarize([
      { name: "web_crawl", inputSchema: { type: "object", properties: {} } },
      { name: "ci_failure_summary", inputSchema: { type: "object", properties: {} } },
    ]);

    assert.ok(summary.blockedTools.includes("web_crawl"));
    assert.equal(summary.priorities.high, 1);

    process.env.TOOL_DISABLED_LIST = previousDisabled;
  });
});
