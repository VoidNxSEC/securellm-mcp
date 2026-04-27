import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

export type ToolPriority = "critical" | "high" | "normal" | "low";
export type ToolExecutionClass = "realtime" | "interactive" | "batch" | "diagnostic";
export type ToolCostTier = "cheap" | "moderate" | "expensive";

export interface ToolGovernanceMetadata {
  name: string;
  priority: ToolPriority;
  executionClass: ToolExecutionClass;
  costTier: ToolCostTier;
  volatile: boolean;
}

export interface ToolGovernanceDecision {
  allowed: boolean;
  reason: string | null;
  metadata: ToolGovernanceMetadata;
}

function parseToolSet(value?: string): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parsePriorityOverrides(value?: string): Record<string, ToolPriority> {
  const overrides: Record<string, ToolPriority> = {};
  const allowed = new Set<ToolPriority>(["critical", "high", "normal", "low"]);

  for (const pair of (value || "").split(",")) {
    const [toolName, priority] = pair.split(":").map((item) => item.trim());
    if (toolName && priority && allowed.has(priority as ToolPriority)) {
      overrides[toolName] = priority as ToolPriority;
    }
  }

  return overrides;
}

function defaultMetadata(name: string): ToolGovernanceMetadata {
  if (
    [
      "server_status",
      "server_health",
      "ci_failure_summary",
      "workspace_quality_gate",
      "performance_report",
      "tool_control_plane",
    ].includes(name)
  ) {
    return {
      name,
      priority: "high",
      executionClass: "diagnostic",
      costTier: "cheap",
      volatile: true,
    };
  }

  if (["emergency_abort", "system_health_check", "safe_rebuild_check"].includes(name)) {
    return {
      name,
      priority: "critical",
      executionClass: "realtime",
      costTier: "moderate",
      volatile: true,
    };
  }

  if (
    [
      "web_crawl",
      "research_agent",
      "browser_launch_advanced",
      "browser_extract_data",
      "browser_interact_form",
      "browser_monitor_changes",
      "browser_search_aggregate",
      "advanced_code_analysis",
      "socket_debug_report",
    ].includes(name)
  ) {
    return {
      name,
      priority: "normal",
      executionClass: "batch",
      costTier: "expensive",
      volatile: false,
    };
  }

  return {
    name,
    priority: "normal",
    executionClass: "interactive",
    costTier: "moderate",
    volatile: false,
  };
}

const priorityRank: Record<ToolPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export class ToolGovernanceManager {
  private readonly disabledTools: Set<string>;
  private readonly allowlist: Set<string>;
  private readonly priorityOverrides: Record<string, ToolPriority>;
  private readonly degradedMode: boolean;

  constructor() {
    this.disabledTools = parseToolSet(process.env.TOOL_DISABLED_LIST);
    this.allowlist = parseToolSet(process.env.TOOL_ALLOWLIST);
    this.priorityOverrides = parsePriorityOverrides(process.env.TOOL_PRIORITY_OVERRIDES);
    this.degradedMode = process.env.TOOL_DEGRADED_MODE === "true";
  }

  getMetadata(tool: Pick<ExtendedTool, "name" | "priority" | "execution_class" | "cost_tier" | "volatile">): ToolGovernanceMetadata {
    const base = defaultMetadata(tool.name);
    return {
      name: tool.name,
      priority: this.priorityOverrides[tool.name] || tool.priority || base.priority,
      executionClass: tool.execution_class || base.executionClass,
      costTier: tool.cost_tier || base.costTier,
      volatile: tool.volatile ?? base.volatile,
    };
  }

  canExecute(tool: Pick<ExtendedTool, "name" | "priority" | "execution_class" | "cost_tier" | "volatile">): ToolGovernanceDecision {
    const metadata = this.getMetadata(tool);

    if (this.allowlist.size > 0 && !this.allowlist.has(tool.name)) {
      return {
        allowed: false,
        reason: "Tool is not present in the configured allowlist",
        metadata,
      };
    }

    if (this.disabledTools.has(tool.name)) {
      return {
        allowed: false,
        reason: "Tool is explicitly disabled by policy",
        metadata,
      };
    }

    if (
      this.degradedMode &&
      metadata.priority !== "critical" &&
      (metadata.executionClass === "batch" || metadata.costTier === "expensive")
    ) {
      return {
        allowed: false,
        reason: "Tool is blocked while degraded mode is active",
        metadata,
      };
    }

    return {
      allowed: true,
      reason: null,
      metadata,
    };
  }

  sortTools<T extends ExtendedTool>(tools: T[]): T[] {
    return [...tools].sort((a, b) => {
      const metaA = this.getMetadata(a);
      const metaB = this.getMetadata(b);
      return priorityRank[metaA.priority] - priorityRank[metaB.priority] || a.name.localeCompare(b.name);
    });
  }

  summarize(tools: ExtendedTool[]) {
    const summary = {
      degradedMode: this.degradedMode,
      disabledTools: Array.from(this.disabledTools).sort(),
      allowlistCount: this.allowlist.size,
      priorities: {
        critical: 0,
        high: 0,
        normal: 0,
        low: 0,
      },
      executionClasses: {
        realtime: 0,
        interactive: 0,
        batch: 0,
        diagnostic: 0,
      },
      blockedTools: [] as string[],
    };

    for (const tool of tools) {
      const decision = this.canExecute(tool);
      summary.priorities[decision.metadata.priority]++;
      summary.executionClasses[decision.metadata.executionClass]++;
      if (!decision.allowed) {
        summary.blockedTools.push(tool.name);
      }
    }

    summary.blockedTools.sort();
    return summary;
  }
}

