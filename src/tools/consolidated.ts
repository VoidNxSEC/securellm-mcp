// consolidated.ts — semantic tool consolidations
//
// search        : web_search + github_search + research_agent
// code_analyze  : analyze_complexity + find_dead_code + advanced_code_analysis
// quality_gate  : workspace_quality_gate + lint_code + run_tests + doc_validate + doc_coverage
// system        : system_health_check + disk_analyze + network_diag + security_scan

import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

// ─── search ──────────────────────────────────────────────────────────────────

export const searchTool: ExtendedTool = {
  name: "search",
  description:
    "Search for information from external sources. Use 'web' for general queries, 'github' for code/repos/issues, 'research' for deep multi-source investigation.",
  defer_loading: true,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for",
      },
      target: {
        type: "string",
        enum: ["web", "github", "research"],
        default: "web",
        description:
          "web — general web search; github — repos, code, issues, PRs; research — deep investigation with synthesis",
      },
      // web-specific
      max_results: {
        type: "number",
        description: "[web] Max results (default: 5)",
      },
      // github-specific
      type: {
        type: "string",
        enum: ["repositories", "code", "issues", "users"],
        description: "[github] Search scope (default: repositories)",
      },
      // research-specific
      depth: {
        type: "string",
        enum: ["quick", "standard", "deep"],
        default: "standard",
        description: "[research] Investigation depth",
      },
    },
    required: ["query"],
  },
};

// ─── code_analyze ─────────────────────────────────────────────────────────────

export const codeAnalyzeTool: ExtendedTool = {
  name: "code_analyze",
  description:
    "Analyze code quality and structure. Use 'complexity' for size/complexity metrics, 'dead_code' for unused exports, 'full' for comprehensive multi-pass analysis.",
  defer_loading: true,
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["complexity", "dead_code", "full"],
        default: "complexity",
        description:
          "complexity — file sizes and cyclomatic complexity; dead_code — heuristic unused export detection; full — deep multi-pass analysis with patterns and smells",
      },
      path: {
        type: "string",
        description: "File or directory to analyze (default: current project root)",
      },
      // complexity options
      top_n: {
        type: "number",
        description: "[complexity] Number of top complex files to show (default: 20)",
      },
      // full options
      analysis_types: {
        type: "array",
        items: {
          type: "string",
          enum: ["complexity", "dependencies", "patterns", "security", "performance"],
        },
        description: "[full] Which analysis types to run (default: all)",
      },
    },
    required: ["mode"],
  },
};

// ─── quality_gate ─────────────────────────────────────────────────────────────

export const qualityGateTool: ExtendedTool = {
  name: "quality_gate",
  description:
    "Validate workspace quality. Use 'all' for a full quality report, or target a specific check: lint, test, docs.",
  defer_loading: true,
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["all", "lint", "test", "docs"],
        default: "all",
        description:
          "all — full quality gate (lint + tests + docs + metrics); lint — code style and static analysis; test — run test suite; docs — validate and measure documentation coverage",
      },
      path: {
        type: "string",
        description: "Target path (default: current project)",
      },
      // test options
      test_command: {
        type: "string",
        description: "[test] Override default test command",
      },
      // lint options
      fix: {
        type: "boolean",
        description: "[lint] Auto-fix issues where possible (default: false)",
      },
    },
    required: ["scope"],
  },
};

// ─── system ───────────────────────────────────────────────────────────────────

export const systemTool: ExtendedTool = {
  name: "system",
  description:
    "Inspect the local system. Use 'health' for overall status, 'disk' for storage analysis, 'network' for connectivity and open ports, 'security' for vulnerability scanning.",
  defer_loading: true,
  inputSchema: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        enum: ["health", "disk", "network", "security"],
        default: "health",
        description:
          "health — CPU, memory, services status; disk — usage, largest dirs, I/O; network — interfaces, open ports, connections; security — file permissions, SUID, weak configs",
      },
      detailed: {
        type: "boolean",
        default: false,
        description: "Include extended detail in the report",
      },
      path: {
        type: "string",
        description: "[disk] Root path to analyze (default: /)",
      },
    },
    required: ["focus"],
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const consolidatedTools: ExtendedTool[] = [
  searchTool,
  codeAnalyzeTool,
  qualityGateTool,
  systemTool,
];
