/**
 * Research Agent Tool for MCP
 *
 * Provides deep multi-source research with:
 * - Parallel source querying
 * - Credibility scoring
 * - Fact-checking
 * - Actionable recommendations
 */
import type { ExtendedTool } from "../types/mcp-tool-extensions.js";
export interface ResearchAgentArgs {
    query: string;
    depth?: "quick" | "standard" | "deep";
    require_official_source?: boolean;
    max_sources?: number;
}
/**
 * Research Agent tool definition for MCP
 */
export declare const researchAgentTool: ExtendedTool;
/**
 * Handle research_agent tool call
 */
export declare function handleResearchAgent(args: ResearchAgentArgs): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}>;
//# sourceMappingURL=research-agent.d.ts.map