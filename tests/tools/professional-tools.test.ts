import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createProfessionalToolHandlers,
  professionalToolTestHelpers,
} from "../../src/tools/professional-tools.js";

describe("professional tools", () => {
  it("should select expected quality gate commands by profile", () => {
    const scripts = {
      build: "tsc",
      lint: "eslint src",
      test: "node --test",
      "test:coverage": "c8 npm test",
      "format:check": "prettier --check .",
    };

    const quick = professionalToolTestHelpers.selectQualityCommands(scripts, "quick");
    const standard = professionalToolTestHelpers.selectQualityCommands(scripts, "standard");
    const full = professionalToolTestHelpers.selectQualityCommands(scripts, "full");

    assert.equal(quick.length, 3);
    assert.equal(standard.at(-1)?.name, "test");
    assert.equal(full.at(-1)?.name, "test_coverage");
    assert.deepEqual(full.at(-1)?.command?.args, ["run", "test:coverage"]);
  });

  it("should summarize quality gate results correctly", () => {
    const summary = professionalToolTestHelpers.summarizeQualityGate([
      {
        name: "lint",
        command: "npm run lint",
        status: "passed",
        duration_ms: 10,
        summary: "lint passed",
      },
      {
        name: "build",
        command: "npm run build",
        status: "failed",
        duration_ms: 12,
        summary: "build failed",
      },
      {
        name: "test",
        command: "not configured",
        status: "skipped",
        duration_ms: 0,
        summary: "skipped",
      },
    ]);

    assert.equal(summary.overall_status, "failed");
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 1);
  });

  it("should produce a server health report without external probes", async () => {
    const handlers = createProfessionalToolHandlers({
      getProjectRoot: () => process.cwd(),
      getServerStatus: async () => ({
        name: "securellm-mcp",
        version: "2.1.0",
        features: {
          knowledgeEnabled: true,
        },
      }),
    });

    const result = await handlers.server_health({
      include_external_services: false,
      include_git: false,
    });

    assert.ok(result.content[0]);
    assert.equal(result.content[0].type, "text");

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.overall_status === "healthy" || payload.overall_status === "degraded", true);
    assert.equal(payload.workspace.project_root, process.cwd());
    assert.equal(Array.isArray(payload.warnings), true);
  });

  it("should produce a ranked performance report from collected tool metrics", async () => {
    const handlers = createProfessionalToolHandlers({
      getProjectRoot: () => process.cwd(),
      getServerStatus: async () => ({
        metrics: {
          semanticCache: {
            tokensSaved: 3200,
          },
          toolMetrics: {
            advanced_code_analysis: {
              totalRequests: 10,
              averageLatency: 720,
              latencyPercentiles: { p95: 1100 },
              totalCompactionTokensSaved: 1400,
              compactionAppliedCount: 5,
              compactionRate: 0.62,
              averageOriginalResponseSize: 18000,
              averageCompactedResponseSize: 7000,
              averageResponseSize: 7000,
            },
            socket_debug_report: {
              totalRequests: 4,
              averageLatency: 410,
              latencyPercentiles: { p95: 650 },
              totalCompactionTokensSaved: 2100,
              compactionAppliedCount: 4,
              compactionRate: 0.73,
              averageOriginalResponseSize: 24000,
              averageCompactedResponseSize: 6500,
              averageResponseSize: 6500,
            },
          },
        },
      }),
    });

    const result = await handlers.performance_report({ top_n: 2 });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(payload.top_latency_tools[0].tool, "advanced_code_analysis");
    assert.equal(payload.top_token_savers[0].tool, "socket_debug_report");
    assert.equal(payload.totals.compaction_tokens_saved, 3500);
    assert.equal(payload.totals.semantic_cache_tokens_saved, 3200);
    assert.ok(Array.isArray(payload.recommendations));
  });
});
