/**
 * Database Row Schemas — Zod
 *
 * Source of truth: the SQL schema in database.ts.
 * Every schema matches one SQL table row exactly, with .passthrough()
 * so new columns added in migrations don't break existing parsers.
 */

import { z } from "zod";

// ─── Shared enums ──────────────────────────────────────────────────

export const EntryTypeSchema = z.enum([
  "insight",
  "code",
  "decision",
  "reference",
  "question",
  "answer",
]);

export type EntryType = z.infer<typeof EntryTypeSchema>;

export const TierSchema = z.enum(["hot", "warm", "cold", "frozen"]);

export type Tier = z.infer<typeof TierSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high"]);

export type Priority = z.infer<typeof PrioritySchema>;

// ─── Row schemas ───────────────────────────────────────────────────

/** Matches `knowledge_entries` table. */
export const KnowledgeEntryRowSchema = z
  .object({
    id: z.number(),
    session_id: z.string(),
    timestamp: z.string(),
    entry_type: EntryTypeSchema,
    content: z.string(),
    tags: z.string(), // JSON-encoded string[], parse with safeJsonParse
    priority: PrioritySchema,
    metadata: z.string(), // JSON-encoded object
    tier: TierSchema.nullable(),
    summarized: z.number(),
    archived: z.number(),
    summary_id: z.number().nullable(),
  })
  .passthrough();

export type KnowledgeEntryRow = z.infer<typeof KnowledgeEntryRowSchema>;

/** Matches `sessions` table. */
export const SessionRowSchema = z
  .object({
    id: z.string(),
    created_at: z.string(),
    last_active: z.string(),
    summary: z.string().nullable(),
    entry_count: z.number(),
    metadata: z.string(), // JSON-encoded object
    pinned: z.number(),
    compaction_exempt: z.number(),
    tier: TierSchema.nullable(),
  })
  .passthrough();

export type SessionRow = z.infer<typeof SessionRowSchema>;

/** Matches `knowledge_summaries` table. */
export const KnowledgeSummaryRowSchema = z
  .object({
    id: z.number(),
    session_id: z.string(),
    summary_type: z.enum(["session", "topic", "cluster"]),
    content: z.string(),
    entry_count: z.number(),
    token_count: z.number().nullable(),
    generated_at: z.string(),
    source_entries: z.string(), // JSON-encoded number[]
    metadata: z.string(), // JSON-encoded object
  })
  .passthrough();

export type KnowledgeSummaryRow = z.infer<typeof KnowledgeSummaryRowSchema>;

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Wraps JSON.parse with a typed fallback.
 * No more silent `any` corruption — if the column is malformed JSON
 * you get the fallback instead of a runtime crash or undefined.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
