import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ToolMetricsCollector } from "../../src/middleware/tool-metrics.js";

describe("ToolMetricsCollector compaction observability", () => {
  it("should aggregate response compaction metrics", () => {
    const collector = new ToolMetricsCollector();

    collector.recordSnapshot({
      requestId: "req-1",
      toolName: "advanced_code_analysis",
      startTime: Date.now(),
      totalTime: 120,
      requestSize: 200,
      originalResponseSize: 12000,
      responseSize: 4000,
      compactionCharsSaved: 8000,
      compactionTokensSaved: 2000,
      compactionApplied: true,
    });

    const metrics = collector.getToolMetrics("advanced_code_analysis");
    assert.ok(metrics);
    assert.equal(metrics?.averageOriginalResponseSize, 12000);
    assert.equal(metrics?.averageCompactedResponseSize, 4000);
    assert.equal(metrics?.totalCompactionCharsSaved, 8000);
    assert.equal(metrics?.totalCompactionTokensSaved, 2000);
    assert.equal(metrics?.compactionAppliedCount, 1);
    assert.ok((metrics?.compactionRate || 0) > 0.6);
  });

  it("should expose compaction metrics in Prometheus output", () => {
    const collector = new ToolMetricsCollector();

    collector.recordSnapshot({
      requestId: "req-2",
      toolName: "socket_debug_report",
      startTime: Date.now(),
      totalTime: 90,
      originalResponseSize: 10000,
      responseSize: 2500,
      compactionCharsSaved: 7500,
      compactionTokensSaved: 1800,
      compactionApplied: true,
    });

    const prometheus = collector.getPrometheusMetrics();
    assert.match(prometheus, /response_compaction_ratio/);
    assert.match(prometheus, /response_compaction_tokens_saved_total/);
    assert.match(prometheus, /socket_debug_report/);
  });
});
