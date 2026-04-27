// Extended MCP Tool type with custom properties
// These properties are metadata extensions that don't affect MCP protocol compliance

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extended Tool type with custom metadata properties:
 * - defer_loading: Indicates lazy-loaded tools
 * - allowed_callers: Restricts which callers can invoke this tool
 * - input_examples: Provides example inputs for documentation
 */
export interface ExtendedTool extends Omit<Tool, never> {
  defer_loading?: boolean;
  allowed_callers?: string[];
  input_examples?: Array<Record<string, unknown>>;
  priority?: "critical" | "high" | "normal" | "low";
  execution_class?: "realtime" | "interactive" | "batch" | "diagnostic";
  cost_tier?: "cheap" | "moderate" | "expensive";
  volatile?: boolean;
}

/**
 * Type guard to convert ExtendedTool to standard Tool
 * Strips custom properties before sending to MCP client
 */
export function toStandardTool(tool: ExtendedTool): Tool {
  const {
    defer_loading,
    allowed_callers,
    input_examples,
    priority,
    execution_class,
    cost_tier,
    volatile,
    ...standardTool
  } = tool as any;
  return standardTool as Tool;
}

/**
 * Convert array of ExtendedTools to standard Tools
 */
export function toStandardTools(tools: ExtendedTool[]): Tool[] {
  return tools.map(toStandardTool);
}
