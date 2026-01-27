/**
 * ADR MCP Tools
 * 
 * Tool definitions and handlers for Architecture Decision Records
 */

import type { ExtendedTool } from "../../types/mcp-tool-extensions.js";
import { ResearchParser } from "./research/parser.js";
import { GitBackend } from "./storage/git-backend.js";
import type {
    ADRCreateArgs,
    ADRListArgs,
    ADRShowArgs,
    ADRAcceptArgs,
    ADRSearchArgs,
    ResearchData
} from "./types.js";
import { stringifyGeneric } from "../../utils/json-schemas.js";
import { logger } from "../../utils/logger.js";

// Default ADR repository path
const ADR_REPO_PATH = process.env.ADR_REPO_PATH || "/home/kernelcore/arch/adr-ledger";
const backend = new GitBackend(ADR_REPO_PATH);

/**
 * ADR Tools Collection
 */
export const adrTools: ExtendedTool[] = [
    {
        name: "adr_new",
        description: "Create new Architecture Decision Record",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Title of the architectural decision"
                },
                project: {
                    type: "string",
                    description: "Project name (NEOLAND, SPECTRE, GLOBAL, etc.)",
                    default: "GLOBAL"
                },
                classification: {
                    type: "string",
                    enum: ["critical", "major", "minor", "patch"],
                    description: "Decision classification",
                    default: "major"
                }
            },
            required: ["title"]
        }
    },

    {
        name: "adr_new_from_research",
        description: "Generate ADR from research_agent validation data with credibility scoring",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Title of the architectural decision"
                },
                research_data: {
                    type: "object",
                    description: "Output from research_agent tool"
                },
                project: {
                    type: "string",
                    description: "Project name",
                    default: "GLOBAL"
                }
            },
            required: ["title", "research_data"]
        }
    },

    {
        name: "adr_list",
        description: "List all ADRs with optional filters",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                status: {
                    type: "string",
                    enum: ["proposed", "accepted", "rejected", "superseded", "deprecated"],
                    description: "Filter by status"
                },
                project: {
                    type: "string",
                    description: "Filter by project name"
                },
                format: {
                    type: "string",
                    enum: ["table", "json"],
                    description: "Output format",
                    default: "table"
                }
            }
        }
    },

    {
        name: "adr_show",
        description: "Show detailed ADR content",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "ADR ID (e.g., ADR-0001)"
                }
            },
            required: ["id"]
        }
    },

    {
        name: "adr_accept",
        description: "Accept a proposed ADR and move to accepted status",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "ADR ID to accept"
                }
            },
            required: ["id"]
        }
    },

    {
        name: "adr_search",
        description: "Full-text search across all ADRs",
        defer_loading: false,
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Search query"
                },
                status_filter: {
                    type: "string",
                    enum: ["proposed", "accepted", "rejected", "superseded"],
                    description: "Filter by status"
                }
            },
            required: ["query"]
        }
    }
];

/**
 * Handle adr_new tool call
 */
export async function handleAdrNew(args: ADRCreateArgs) {
    try {
        const { title, project = "GLOBAL", classification = "major" } = args;

        const id = await backend.getNextId();
        const date = new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString();

        // Generate basic ADR template
        const content = `---
id: "${id}"
title: "${title}"
status: proposed
date: "${date}"

authors:
  - name: "AI Agent"
    role: "Development Assistant"
    github: "securellm-mcp"

reviewers: []

governance:
  classification: "${classification}"
  requires_approval_from:
    - architect
  compliance_tags: []
  review_deadline: "${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"
  auto_supersede_after: "1y"

scope:
  projects:
    - ${project}
  layers:
    - infrastructure
  environments:
    - all

rationale:
  drivers: []
  alternatives_considered: []
  trade_offs: []

consequences:
  positive: []
  negative: []
  risks: []

implementation:
  effort: "medium"
  timeline: ""
  dependencies: []
  blocked_by: []
  tasks: []

relations:
  supersedes: []
  superseded_by: null
  related_to: []
  implements: []
  enables: []

knowledge_extraction:
  keywords: []
  concepts: []
  questions_answered: []
  embedding_priority: "normal"

audit:
  created_at: "${timestamp}"
  last_modified: "${timestamp}"
  version: 1
  changelog:
    - date: "${timestamp}"
      author: "securellm-mcp"
      change: "ADR created"
      commit_hash: null
---

## Context

[Describe the context and problem that led to this decision]

## Decision

[Describe the decision being made]

## Rationale

### Drivers

- [Driver 1]

### Alternatives Considered

#### Option A: [Name]
- **Pros:** 
- **Cons:** 
- **Why rejected:** 

### Trade-offs

- [Trade-off accepted]

## Consequences

### Positive

- [Positive consequence]

### Negative

- [Negative consequence]

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk] | medium | medium | [Mitigation] |

## Implementation

### Tasks

- [ ] Task 1

### Timeline

[Estimated timeline]

## References

- [Relevant documentation]
`;

        const adr = await backend.create({ id, title, content });

        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: true,
                    id: adr.id,
                    status: "proposed",
                    message: `ADR created: ${adr.id}`,
                    file_path: `${ADR_REPO_PATH}/adr/proposed/${adr.id}.md`,
                    next_steps: [
                        `Edit the file to fill in details`,
                        `Run adr_accept ${adr.id} when ready`
                    ]
                })
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to create ADR");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * Handle adr_new_from_research tool call
 */
export async function handleAdrNewFromResearch(args: ADRCreateArgs) {
    try {
        const { title, research_data, project = "GLOBAL" } = args;

        if (!research_data) {
            throw new Error("research_data is required");
        }

        // Parse research data
        const research = research_data as ResearchData;

        // Calculate credibility score
        const credibilityScore = ResearchParser.calculateCredibilityScore(research);

        // Generate ADR content
        const content = ResearchParser.generateADR(research, title, project);

        // Get next ID
        const id = await backend.getNextId();
        const updatedContent = content.replace(/"ADR-\d+"/, `"${id}"`);

        // Create ADR
        const adr = await backend.create({
            id,
            title,
            content: updatedContent
        });

        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: true,
                    id: adr.id,
                    status: "proposed",
                    credibility_score: credibilityScore,
                    sources_count: research.sources.length,
                    message: `ADR generated from research: ${adr.id}`,
                    file_path: `${ADR_REPO_PATH}/adr/proposed/${adr.id}.md`,
                    validation: {
                        method: "research_agent",
                        confidence: research.confidence,
                        credibility: credibilityScore
                    },
                    next_steps: [
                        `Review generated ADR at ${ADR_REPO_PATH}/adr/proposed/${adr.id}.md`,
                        `Verify market validation section`,
                        `Run adr_accept ${adr.id} when ready`
                    ]
                })
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to generate ADR from research");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * Handle adr_list tool call
 */
export async function handleAdrList(args: ADRListArgs) {
    try {
        const { status, format = "table" } = args;

        const adrs = await backend.list(status);

        if (format === "json") {
            return {
                content: [{
                    type: "text",
                    text: stringifyGeneric({
                        success: true,
                        count: adrs.length,
                        adrs: adrs.map(a => ({
                            id: a.id,
                            title: a.title,
                            status: a.status,
                            date: a.date
                        }))
                    })
                }]
            };
        }

        // Table format
        let table = `╔════════════╦══════════╦══════════════════════════════════════════════╦════════════╗\n`;
        table += `║ ID         ║ Status   ║ Title                                        ║ Date       ║\n`;
        table += `╠════════════╬══════════╬══════════════════════════════════════════════╬════════════╣\n`;

        for (const adr of adrs) {
            const statusIcon = {
                proposed: "🟡",
                accepted: "🟢",
                rejected: "🔴",
                superseded: "⚪",
                deprecated: "🟠"
            }[adr.status || "proposed"] || "⚪";

            const title = (adr.title || "").substring(0, 44).padEnd(44);
            const id = (adr.id || "").padEnd(10);
            const status = `${statusIcon} ${(adr.status || "").padEnd(7)}`;
            const date = (adr.date || "").substring(0, 10);

            table += `║ ${id} ║ ${status} ║ ${title} ║ ${date} ║\n`;
        }

        table += `╚════════════╩══════════╩══════════════════════════════════════════════╩════════════╝`;

        return {
            content: [{
                type: "text",
                text: `Total ADRs: ${adrs.length}\n\n${table}`
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to list ADRs");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * Handle adr_show tool call
 */
export async function handleAdrShow(args: ADRShowArgs) {
    try {
        const adr = await backend.get(args.id);

        if (!adr) {
            throw new Error(`ADR not found: ${args.id}`);
        }

        return {
            content: [{
                type: "text",
                text: adr.content
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to show ADR");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * Handle adr_accept tool call
 */
export async function handleAdrAccept(args: ADRAcceptArgs) {
    try {
        await backend.accept(args.id);

        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: true,
                    id: args.id,
                    status: "accepted",
                    message: `ADR accepted: ${args.id}`,
                    file_path: `${ADR_REPO_PATH}/adr/accepted/${args.id}.md`
                })
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to accept ADR");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * Handle adr_search tool call
 */
export async function handleAdrSearch(args: ADRSearchArgs) {
    try {
        const results = await backend.search(args.query, args.status_filter);

        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: true,
                    query: args.query,
                    count: results.length,
                    results: results.map(a => ({
                        id: a.id,
                        title: a.title,
                        status: a.status,
                        date: a.date
                    }))
                })
            }]
        };
    } catch (error: any) {
        logger.error({ err: error }, "Failed to search ADRs");
        return {
            content: [{
                type: "text",
                text: stringifyGeneric({
                    success: false,
                    error: error.message
                })
            }],
            isError: true
        };
    }
}

/**
 * ADR Tool Handlers Map
 */
export const adrHandlers = {
    adr_new: handleAdrNew,
    adr_new_from_research: handleAdrNewFromResearch,
    adr_list: handleAdrList,
    adr_show: handleAdrShow,
    adr_accept: handleAdrAccept,
    adr_search: handleAdrSearch
};
