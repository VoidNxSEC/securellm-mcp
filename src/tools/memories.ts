// memories.ts — unified memory tool replacing the 7 scattered knowledge tools
//
// Semantic identity: "I need to remember / recall something specific"
// action: save | search | recall | list | compact

import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

export const memoriesTool: ExtendedTool = {
  name: "memories",
  description:
    "Store and retrieve memories across sessions. Use 'save' to remember something important, 'search' to find past knowledge, 'recall' to load a full session, 'list' to browse sessions, 'compact' to maintain the memory database.",
  defer_loading: true,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["save", "search", "recall", "list", "compact"],
        description:
          "save — store a memory; search — find memories by query; recall — load a full session by ID; list — browse available sessions; compact — run database maintenance",
      },

      // ── save ──────────────────────────────────────────────────────
      content: {
        type: "string",
        description: "[save] The content to remember",
      },
      type: {
        type: "string",
        enum: ["insight", "code", "decision", "reference", "question", "answer"],
        description: "[save] Category of the memory (default: insight)",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "[save] Priority level (default: medium)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "[save] Tags for easier retrieval later",
      },
      session_id: {
        type: "string",
        description: "[save, recall] Session ID. Omit to auto-create a new session for save.",
      },

      // ── search ────────────────────────────────────────────────────
      query: {
        type: "string",
        description: "[search] Full-text search query across all memories",
      },
      limit: {
        type: "number",
        description: "[search, list, recall] Max results to return (default: 20)",
      },

      // ── compact ───────────────────────────────────────────────────
      dry_run: {
        type: "boolean",
        description: "[compact] Preview changes without executing (default: true)",
      },
    },
    required: ["action"],
  },
};
