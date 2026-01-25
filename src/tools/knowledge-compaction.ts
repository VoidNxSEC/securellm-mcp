// MCP Tools for Knowledge Database Compaction

import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

export const knowledgeCompactionTools: ExtendedTool[] = [
  {
    name: "compact_knowledge",
    description: "Comprehensive knowledge database compaction with tiered storage, summarization, and archival. Reduces database size while preserving critical information.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        dry_run: {
          type: "boolean",
          default: true,
          description: "Preview changes without executing (default: true)",
        },
        mode: {
          type: "string",
          enum: ["full", "incremental", "archive_only", "summarize_only"],
          default: "incremental",
          description: "Compaction mode: full (all operations), incremental (smart tier-based), archive_only (cold tier only), summarize_only (warm tier only)",
        },
        hot_threshold: {
          type: "number",
          default: 7,
          description: "Days threshold for HOT tier (recent, full detail)",
        },
        warm_threshold: {
          type: "number",
          default: 30,
          description: "Days threshold for WARM tier (summarized)",
        },
        cold_threshold: {
          type: "number",
          default: 90,
          description: "Days threshold for COLD tier (archived)",
        },
        skip_summarization: {
          type: "boolean",
          default: false,
          description: "Skip LLM-powered summarization",
        },
        skip_deduplication: {
          type: "boolean",
          default: false,
          description: "Skip duplicate detection and merging",
        },
        skip_vacuum: {
          type: "boolean",
          default: false,
          description: "Skip VACUUM operation",
        },
        archive_path: {
          type: "string",
          default: "/var/lib/mcp-knowledge/archive",
          description: "Path to store archived sessions",
        },
        backup_before: {
          type: "boolean",
          default: true,
          description: "Create backup before compaction",
        },
        validate_after: {
          type: "boolean",
          default: true,
          description: "Validate database integrity after compaction",
        },
      },
    },
  },
  {
    name: "summarize_session",
    description: "Generate LLM-powered summary of a knowledge session, preserving key information in compact form.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to summarize (required)",
        },
        summary_type: {
          type: "string",
          enum: ["session", "topic", "cluster"],
          default: "session",
          description: "Type of summary: session (overall), topic (by theme), cluster (by similarity)",
        },
        model: {
          type: "string",
          description: "LLM model to use (default: from config)",
        },
        max_tokens: {
          type: "number",
          default: 500,
          description: "Maximum tokens in summary",
        },
        temperature: {
          type: "number",
          default: 0.3,
          description: "LLM temperature (0.0-1.0, lower = more factual)",
        },
        include_code: {
          type: "boolean",
          default: true,
          description: "Include code snippets in summary",
        },
        include_tags: {
          type: "boolean",
          default: true,
          description: "Include tags in summary",
        },
        min_entry_count: {
          type: "number",
          default: 3,
          description: "Minimum entries required to summarize",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "deduplicate_entries",
    description: "Detect and merge duplicate knowledge entries using exact matching, fuzzy matching, or semantic embeddings.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        similarity_threshold: {
          type: "number",
          default: 0.85,
          description: "Similarity threshold (0.0-1.0, higher = more strict)",
        },
        method: {
          type: "string",
          enum: ["exact", "embedding", "fuzzy"],
          default: "embedding",
          description: "Detection method: exact (hash-based), embedding (semantic), fuzzy (Levenshtein distance)",
        },
        session_id: {
          type: "string",
          description: "Optional: limit to specific session",
        },
        auto_merge: {
          type: "boolean",
          default: false,
          description: "Automatically merge detected duplicates",
        },
        dry_run: {
          type: "boolean",
          default: true,
          description: "Preview without making changes",
        },
      },
    },
  },
  {
    name: "archive_old_sessions",
    description: "Archive old sessions to compressed JSON files, preserving data while freeing database space.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        age_threshold_days: {
          type: "number",
          default: 90,
          description: "Archive sessions older than this many days",
        },
        archive_path: {
          type: "string",
          default: "/var/lib/mcp-knowledge/archive",
          description: "Directory to store archive files",
        },
        exclude_high_priority: {
          type: "boolean",
          default: true,
          description: "Exclude sessions with high-priority entries",
        },
        exclude_pinned: {
          type: "boolean",
          default: true,
          description: "Exclude pinned sessions",
        },
        compression: {
          type: "string",
          enum: ["gzip", "bzip2", "none"],
          default: "gzip",
          description: "Compression format",
        },
        keep_summaries: {
          type: "boolean",
          default: true,
          description: "Keep summaries in database after archiving",
        },
        dry_run: {
          type: "boolean",
          default: true,
          description: "Preview without archiving",
        },
      },
    },
  },
  {
    name: "restore_archived_session",
    description: "Restore an archived session from compressed file back into the database.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to restore (required)",
        },
        restore_mode: {
          type: "string",
          enum: ["full", "summary_only"],
          default: "full",
          description: "Restore mode: full (all entries), summary_only (keep archived)",
        },
        archive_path: {
          type: "string",
          description: "Path to archive file (auto-detected if not provided)",
        },
        force: {
          type: "boolean",
          default: false,
          description: "Overwrite existing session",
        },
        restore_tier: {
          type: "string",
          enum: ["hot", "warm"],
          default: "warm",
          description: "Tier to restore session to",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_tier_distribution",
    description: "Get the distribution of sessions across storage tiers (hot, warm, cold, frozen).",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pin_session",
    description: "Pin a session to prevent it from being compacted or archived.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to pin",
        },
        pin: {
          type: "boolean",
          default: true,
          description: "Pin (true) or unpin (false)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_compaction_history",
    description: "Get history of compaction operations with statistics.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          default: 10,
          description: "Number of history entries to return",
        },
      },
    },
  },
];
