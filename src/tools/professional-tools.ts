import { z } from "zod";
import { execa } from "execa";
import { access, readFile } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import type { ExtendedTool } from "../types/mcp-tool-extensions.js";
import { zodToMcpSchema } from "../utils/schema-converter.js";
import { stringifyGeneric } from "../utils/json-schemas.js";

const serverHealthSchema = z.object({
  include_external_services: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check optional external HTTP services such as Phantom and Cerebro Reranker"),
  include_git: z.boolean().optional().default(true).describe("Include git repository health details"),
  timeout_ms: z.number().int().min(250).max(10000).optional().default(2000),
});

const workspaceQualityGateSchema = z.object({
  profile: z
    .enum(["quick", "standard", "full"])
    .optional()
    .default("standard")
    .describe("quick: lint/format/build, standard: quick + test, full: quick + test coverage when available"),
  include_git_status: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include git working tree summary in the report"),
  max_output_chars: z
    .number()
    .int()
    .min(500)
    .max(20000)
    .optional()
    .default(4000)
    .describe("Maximum stdout/stderr chars captured for each executed step"),
  timeout_ms: z.number().int().min(1000).max(120000).optional().default(60000),
});

const performanceReportSchema = z.object({
  top_n: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("How many top tools to include in each ranked section"),
  include_recommendations: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include prioritized optimization recommendations"),
});

type ServerStatus = Awaited<ReturnType<ProfessionalToolDeps["getServerStatus"]>>;

interface ProfessionalToolDeps {
  getProjectRoot: () => string;
  getServerStatus: (includeMetrics: boolean) => Promise<Record<string, unknown>>;
}

interface ToolMetricRecord extends Record<string, unknown> {
  toolName: string;
}

interface QualityGateStep {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  exit_code?: number;
  summary: string;
  stdout?: string;
  stderr?: string;
}

function buildCommand(program: string, args: string[]): string {
  return [program, ...args]
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ");
}

async function safeAccess(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function checkHttpHealth(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      url,
      ok: response.ok,
      status: response.status,
      response_time_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      response_time_ms: Date.now() - startedAt,
    };
  }
}

async function readPackageScripts(projectRoot: string): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    return packageJson.scripts || {};
  } catch {
    return {};
  }
}

async function runQualityStep(
  projectRoot: string,
  name: string,
  command: { program: string; args: string[] } | null,
  maxOutputChars: number,
  timeoutMs: number
): Promise<QualityGateStep> {
  if (!command) {
    return {
      name,
      command: "not configured",
      status: "skipped",
      duration_ms: 0,
      summary: "Step skipped because no matching project script was found.",
    };
  }

  const startedAt = Date.now();
  const result = await execa(command.program, command.args, {
    cwd: projectRoot,
    reject: false,
    preferLocal: true,
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout.slice(-maxOutputChars);
  const stderr = result.stderr.slice(-maxOutputChars);

  return {
    name,
    command: buildCommand(command.program, command.args),
    status: result.exitCode === 0 ? "passed" : "failed",
    duration_ms: durationMs,
    exit_code: result.exitCode ?? undefined,
    summary:
      result.exitCode === 0
        ? `${name} passed`
        : `${name} failed with exit code ${result.exitCode ?? "unknown"}`,
    stdout: stdout || undefined,
    stderr: stderr || undefined,
  };
}

function selectQualityCommands(
  scripts: Record<string, string>,
  profile: z.infer<typeof workspaceQualityGateSchema>["profile"]
) {
  const formatCheck = scripts["format:check"]
    ? { program: "npm", args: ["run", "format:check"] }
    : scripts.format
      ? { program: "npm", args: ["run", "format"] }
      : null;

  const lint = scripts.lint ? { program: "npm", args: ["run", "lint"] } : null;
  const build = scripts.build ? { program: "npm", args: ["run", "build"] } : null;

  let test: { program: string; args: string[] } | null = null;
  if (profile === "full" && scripts["test:coverage"]) {
    test = { program: "npm", args: ["run", "test:coverage"] };
  } else if (scripts.test) {
    test = { program: "npm", args: ["test"] };
  }

  const steps: Array<{ name: string; command: { program: string; args: string[] } | null }> = [
    { name: "format_check", command: formatCheck },
    { name: "lint", command: lint },
    { name: "build", command: build },
  ];

  if (profile !== "quick") {
    steps.push({ name: profile === "full" ? "test_coverage" : "test", command: test });
  }

  return steps;
}

async function getGitSummary(projectRoot: string) {
  const insideWorkTree = await execa("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    reject: false,
  });
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== "true") {
    return { available: false };
  }

  const [branch, status] = await Promise.all([
    execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot, reject: false }),
    execa("git", ["status", "--short"], { cwd: projectRoot, reject: false }),
  ]);

  const lines = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    available: true,
    branch: branch.stdout.trim() || "unknown",
    dirty: lines.length > 0,
    changed_files: lines.slice(0, 20),
    changed_files_count: lines.length,
  };
}

function summarizeQualityGate(steps: QualityGateStep[]): {
  overall_status: "passed" | "failed";
  passed: number;
  failed: number;
  skipped: number;
} {
  const passed = steps.filter((step) => step.status === "passed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const skipped = steps.filter((step) => step.status === "skipped").length;

  return {
    overall_status: failed > 0 ? "failed" : "passed",
    passed,
    failed,
    skipped,
  };
}

export const professionalTools: ExtendedTool[] = [
  {
    name: "server_health",
    description: "Professional runtime health report for the MCP server and its optional dependencies",
    inputSchema: zodToMcpSchema(serverHealthSchema),
    defer_loading: true,
  },
  {
    name: "workspace_quality_gate",
    description: "Run a professional workspace quality gate across formatting, linting, build, and tests",
    inputSchema: zodToMcpSchema(workspaceQualityGateSchema),
    defer_loading: true,
  },
  {
    name: "performance_report",
    description:
      "Summarize MCP performance hotspots, token savings, and response compaction opportunities across tools",
    inputSchema: zodToMcpSchema(performanceReportSchema),
    defer_loading: true,
  },
];

function rankTools<T>(
  toolMetrics: T[],
  topN: number,
  selector: (metric: T) => number
) {
  return [...toolMetrics]
    .sort((a, b) => selector(b) - selector(a))
    .slice(0, topN);
}

export function createProfessionalToolHandlers(deps: ProfessionalToolDeps) {
  return {
    async server_health(rawArgs: unknown) {
      const args = serverHealthSchema.parse(rawArgs ?? {});
      const status = (await deps.getServerStatus(false)) as ServerStatus;
      const projectRoot = deps.getProjectRoot();

      const [projectRootReadable, packageJsonPresent, flakePresent, buildPresent, gitSummary] =
        await Promise.all([
          safeAccess(projectRoot),
          safeAccess(path.join(projectRoot, "package.json")),
          safeAccess(path.join(projectRoot, "flake.nix")),
          safeAccess(path.join(projectRoot, "build")),
          args.include_git ? getGitSummary(projectRoot) : Promise.resolve({ available: false }),
        ]);

      const externalServices = args.include_external_services
        ? await Promise.all([
            checkHttpHealth(`${process.env.PHANTOM_URL ?? "http://localhost:8008"}/health`, args.timeout_ms),
            checkHttpHealth(
              `${process.env.CEREBRO_RERANKER_URL ?? "http://localhost:8016"}/health`,
              args.timeout_ms
            ),
          ])
        : [];

      const warnings: string[] = [];
      if (!projectRootReadable) warnings.push("Project root is not readable");
      if (!packageJsonPresent) warnings.push("package.json not found in project root");
      if (!buildPresent) warnings.push("Build artifacts directory not found");
      for (const service of externalServices) {
        if (!service.ok) {
          warnings.push(`External service unhealthy: ${service.url}`);
        }
      }

      const overallStatus = warnings.length === 0 ? "healthy" : "degraded";

      return {
        content: [
          {
            type: "text",
            text: stringifyGeneric({
              overall_status: overallStatus,
              warnings,
              runtime: status,
              workspace: {
                project_root: projectRoot,
                readable: projectRootReadable,
                package_json_present: packageJsonPresent,
                flake_present: flakePresent,
                build_present: buildPresent,
              },
              git: gitSummary,
              external_services: externalServices,
              memory: {
                rss_bytes: process.memoryUsage().rss,
                heap_used_bytes: process.memoryUsage().heapUsed,
                heap_total_bytes: process.memoryUsage().heapTotal,
              },
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    },

    async workspace_quality_gate(rawArgs: unknown) {
      const args = workspaceQualityGateSchema.parse(rawArgs ?? {});
      const projectRoot = deps.getProjectRoot();
      const scripts = await readPackageScripts(projectRoot);
      const configuredSteps = selectQualityCommands(scripts, args.profile);
      const steps: QualityGateStep[] = [];

      for (const step of configuredSteps) {
        steps.push(
          await runQualityStep(
            projectRoot,
            step.name,
            step.command,
            args.max_output_chars,
            args.timeout_ms
          )
        );
      }

      const summary = summarizeQualityGate(steps);
      const git = args.include_git_status ? await getGitSummary(projectRoot) : undefined;
      const recommendations = [
        ...(summary.failed > 0
          ? ["Fix failed quality gate steps before merging or releasing this workspace."]
          : ["Workspace quality gate passed for the selected profile."]),
        ...(summary.skipped > 0
          ? ["Some steps were skipped because matching npm scripts are not configured."]
          : []),
      ];

      return {
        content: [
          {
            type: "text",
            text: stringifyGeneric({
              profile: args.profile,
              summary,
              recommendations,
              scripts_detected: Object.keys(scripts).sort(),
              steps,
              git,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
        isError: summary.overall_status === "failed",
      };
    },

    async performance_report(rawArgs: unknown) {
      const args = performanceReportSchema.parse(rawArgs ?? {});
      const status = (await deps.getServerStatus(true)) as ServerStatus;
      const statusMetrics = ((status as Record<string, unknown>).metrics || {}) as Record<string, unknown>;
      const rawToolMetrics = (statusMetrics.toolMetrics || {}) as Record<string, Record<string, unknown>>;
      const metricsList: ToolMetricRecord[] = Object.entries(rawToolMetrics).map(([toolName, metric]) => ({
        toolName,
        ...metric,
      }));

      const topLatency = rankTools(
        metricsList,
        args.top_n,
        (metric) => Number(metric.averageLatency || 0)
      ).map((metric) => ({
        tool: metric.toolName,
        average_latency_ms: Math.round(Number(metric.averageLatency || 0)),
        p95_latency_ms: Math.round(Number((metric.latencyPercentiles as Record<string, unknown>)?.p95 || 0)),
        requests: Number(metric.totalRequests || 0),
      }));

      const topTokenSavings = rankTools(
        metricsList,
        args.top_n,
        (metric) => Number(metric.totalCompactionTokensSaved || 0)
      ).map((metric) => ({
        tool: metric.toolName,
        compacted_tokens_saved: Number(metric.totalCompactionTokensSaved || 0),
        compacted_fields: Number(metric.compactionAppliedCount || 0),
        compaction_rate: Number(metric.compactionRate || 0),
      }));

      const topCompactionCandidates = rankTools(
        metricsList,
        args.top_n,
        (metric) =>
          Number(metric.averageOriginalResponseSize || 0) - Number(metric.averageCompactedResponseSize || 0)
      ).map((metric) => ({
        tool: metric.toolName,
        average_original_response_bytes: Math.round(Number(metric.averageOriginalResponseSize || 0)),
        average_compacted_response_bytes: Math.round(
          Number(metric.averageCompactedResponseSize || metric.averageResponseSize || 0)
        ),
        bytes_saved_per_response: Math.round(
          Number(metric.averageOriginalResponseSize || 0) -
            Number(metric.averageCompactedResponseSize || metric.averageResponseSize || 0)
        ),
      }));

      const recommendations = args.include_recommendations
        ? [
            ...(topLatency.length > 0 && topLatency[0].average_latency_ms > 500
              ? [
                  `Investigate high-latency tool '${topLatency[0].tool}' for extra caching, lighter shell execution, or reduced upstream I/O.`,
                ]
              : []),
            ...(topCompactionCandidates.some((item) => item.bytes_saved_per_response > 0)
              ? [
                  "Expand response compaction patterns for tools with the largest byte deltas to reduce output token cost further.",
                ]
              : []),
            ...(topTokenSavings.some((item) => item.compacted_tokens_saved > 0)
              ? [
                  "Prioritize heavily-used tools with high compaction savings for richer summaries and stable cache keys.",
                ]
              : []),
            ...(metricsList.length === 0
              ? ["Collect runtime traffic first so the performance report has tool metrics to analyze."]
              : []),
          ]
        : [];

      return {
        content: [
          {
            type: "text",
            text: stringifyGeneric({
              generated_at: new Date().toISOString(),
              project_root: deps.getProjectRoot(),
              totals: {
                analyzed_tools: metricsList.length,
                requests_observed: metricsList.reduce(
                  (sum, metric) => sum + Number(metric.totalRequests || 0),
                  0
                ),
                compaction_tokens_saved: metricsList.reduce(
                  (sum, metric) => sum + Number(metric.totalCompactionTokensSaved || 0),
                  0
                ),
                semantic_cache_tokens_saved: Number(
                  ((statusMetrics.semanticCache as Record<string, unknown> | undefined)?.tokensSaved as number | undefined) || 0
                ),
              },
              top_latency_tools: topLatency,
              top_token_savers: topTokenSavings,
              top_compaction_candidates: topCompactionCandidates,
              recommendations,
            }),
          },
        ],
      };
    },
  };
}

export const professionalToolTestHelpers = {
  selectQualityCommands,
  summarizeQualityGate,
  readPackageScripts,
  buildCommand,
  safeAccess,
  hasBuildDirectory(projectRoot: string) {
    return existsSync(path.join(projectRoot, "build"));
  },
};
