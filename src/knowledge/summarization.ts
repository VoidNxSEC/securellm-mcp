// Session Summarization with LLM

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { createLLMClient, type UnifiedLLMClient } from '../utils/llm-client.js';
import type {
  SummarizeSessionInput,
  SummarizeSessionOutput,
  SummaryType,
  KnowledgeSummary,
} from '../types/compaction.js';

export interface SummarizationOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  include_code?: boolean;
  include_tags?: boolean;
  min_entry_count?: number;
}

export class Summarizer {
  private llmClient: UnifiedLLMClient;

  constructor(
    private db: Database.Database,
    llmClient?: UnifiedLLMClient
  ) {
    this.llmClient = llmClient || createLLMClient();
  }

  /**
   * Summarize a session using LLM
   */
  async summarizeSession(input: SummarizeSessionInput): Promise<SummarizeSessionOutput> {
    const {
      session_id,
      summary_type = 'session',
      model,
      max_tokens = 500,
      temperature = 0.3,
      include_code = true,
      include_tags = true,
      min_entry_count = 3,
    } = input;

    logger.info({ session_id, summary_type }, 'Starting session summarization');

    try {
      // Get session info
      const session = this.db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(session_id) as any;

      if (!session) {
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }

      // Get entries for this session
      const entries = this.db
        .prepare('SELECT * FROM knowledge_entries WHERE session_id = ? ORDER BY timestamp ASC')
        .all(session_id) as any[];

      if (entries.length < min_entry_count) {
        return {
          success: false,
          error: `Session has only ${entries.length} entries (minimum: ${min_entry_count})`,
        };
      }

      // Build prompt
      const prompt = this.buildSummarizationPrompt(session, entries, {
        summary_type,
        include_code,
        include_tags,
      });

      // Generate summary using LLM
      const summaryContent = await this.llmClient.complete(prompt, {
        model,
        max_tokens,
        temperature,
      });

      // Estimate token count (rough approximation: ~4 chars per token)
      const tokenCount = Math.ceil(summaryContent.length / 4);

      // Create summary record
      const summaryId = await this.createSummary({
        session_id,
        summary_type,
        content: summaryContent,
        entry_count: entries.length,
        token_count: tokenCount,
        source_entries: entries.map((e: any) => e.id),
        metadata: {
          model,
          temperature,
          include_code,
          include_tags,
        },
      });

      // Mark entries as summarized
      this.db
        .prepare(
          `UPDATE knowledge_entries SET summarized = 1, summary_id = ? WHERE session_id = ?`
        )
        .run(summaryId, session_id);

      // Get the created summary
      const summary = await this.getSummary(summaryId);

      logger.info(
        {
          session_id,
          summary_id: summaryId,
          entry_count: entries.length,
          summary_length: summaryContent.length,
        },
        'Session summarization completed'
      );

      return {
        success: true,
        summary_id: summaryId,
        summary,
      };
    } catch (err: any) {
      logger.error({ err, session_id }, 'Session summarization failed');
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Build summarization prompt
   */
  private buildSummarizationPrompt(
    session: any,
    entries: any[],
    options: {
      summary_type: SummaryType;
      include_code: boolean;
      include_tags: boolean;
    }
  ): string {
    const { summary_type, include_code, include_tags } = options;

    // Parse metadata
    let metadata: any = {};
    try {
      metadata = JSON.parse(session.metadata);
    } catch {
      // Ignore parse errors
    }

    // Collect all tags
    const allTags = new Set<string>();
    if (include_tags) {
      for (const entry of entries) {
        try {
          const tags = JSON.parse(entry.tags);
          tags.forEach((tag: string) => allTags.add(tag));
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Format entries
    const formattedEntries = entries
      .map((entry, idx) => {
        const tags = include_tags ? JSON.parse(entry.tags || '[]') : [];
        const content = include_code
          ? entry.content
          : entry.entry_type === 'code'
          ? '[Code snippet omitted]'
          : entry.content;

        return `${idx + 1}. [${entry.entry_type.toUpperCase()}] ${entry.timestamp}\n   ${content}${
          tags.length > 0 ? `\n   Tags: ${tags.join(', ')}` : ''
        }`;
      })
      .join('\n\n');

    // Build prompt based on summary type
    let prompt = `You are a knowledge management assistant summarizing a technical session.

Session Info:
- ID: ${session.id}
- Created: ${session.created_at}
- Last Active: ${session.last_active}
- Entry Count: ${entries.length}`;

    if (allTags.size > 0) {
      prompt += `\n- Tags: ${Array.from(allTags).join(', ')}`;
    }

    if (metadata.project) {
      prompt += `\n- Project: ${metadata.project}`;
    }

    prompt += `\n\nEntries:\n${formattedEntries}\n\n`;

    if (summary_type === 'session') {
      prompt += `Generate a concise summary (3-5 sentences) that:
1. Captures the main theme or objective of this session
2. Highlights key decisions, insights, or code patterns
3. Preserves critical information (security, architecture, decisions)
4. Uses bullet points for distinct topics if needed

Summary:`;
    } else if (summary_type === 'topic') {
      prompt += `Identify the main topics covered in this session and summarize each topic in 1-2 sentences.

Topics and Summaries:`;
    } else if (summary_type === 'cluster') {
      prompt += `Group related entries together and provide a brief summary of each cluster.

Clusters:`;
    }

    return prompt;
  }

  /**
   * Create summary in database
   */
  private async createSummary(input: {
    session_id: string;
    summary_type: string;
    content: string;
    entry_count: number;
    token_count: number;
    source_entries: number[];
    metadata: Record<string, any>;
  }): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_summaries (session_id, summary_type, content, entry_count, token_count, source_entries, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.session_id,
      input.summary_type,
      input.content,
      input.entry_count,
      input.token_count,
      JSON.stringify(input.source_entries),
      JSON.stringify(input.metadata)
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get summary by ID
   */
  private async getSummary(id: number): Promise<KnowledgeSummary | undefined> {
    const stmt = this.db.prepare('SELECT * FROM knowledge_summaries WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      session_id: row.session_id,
      summary_type: row.summary_type,
      content: row.content,
      entry_count: row.entry_count,
      token_count: row.token_count,
      generated_at: row.generated_at,
      source_entries: JSON.parse(row.source_entries),
      metadata: JSON.parse(row.metadata),
    };
  }

  /**
   * Get summaries for session
   */
  async getSummariesForSession(sessionId: string): Promise<KnowledgeSummary[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_summaries WHERE session_id = ? ORDER BY generated_at DESC
    `);

    const rows = stmt.all(sessionId) as any[];

    return rows.map(row => ({
      id: row.id,
      session_id: row.session_id,
      summary_type: row.summary_type,
      content: row.content,
      entry_count: row.entry_count,
      token_count: row.token_count,
      generated_at: row.generated_at,
      source_entries: JSON.parse(row.source_entries),
      metadata: JSON.parse(row.metadata),
    }));
  }

  /**
   * Search summaries using FTS
   */
  async searchSummaries(query: string, limit: number = 10): Promise<KnowledgeSummary[]> {
    const stmt = this.db.prepare(`
      SELECT ks.*
      FROM knowledge_summaries ks
      JOIN knowledge_summaries_fts kf ON ks.id = kf.summary_id
      WHERE knowledge_summaries_fts MATCH ?
      ORDER BY kf.rank
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      session_id: row.session_id,
      summary_type: row.summary_type,
      content: row.content,
      entry_count: row.entry_count,
      token_count: row.token_count,
      generated_at: row.generated_at,
      source_entries: JSON.parse(row.source_entries),
      metadata: JSON.parse(row.metadata),
    }));
  }
}

/**
 * Factory function
 */
export function createSummarizer(
  db: Database.Database,
  llmClient?: UnifiedLLMClient
): Summarizer {
  return new Summarizer(db, llmClient);
}
