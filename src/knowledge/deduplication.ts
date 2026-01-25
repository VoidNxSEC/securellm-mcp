// Knowledge Entry Deduplication

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { createLLMClient, type UnifiedLLMClient } from '../utils/llm-client.js';
import {
  cosineSimilarity,
  textHash,
  levenshteinSimilarity,
  normalizeText,
  findSimilarPairs,
  type SimilarPair,
} from '../utils/embeddings.js';
import type {
  DeduplicateEntriesInput,
  DeduplicateEntriesOutput,
  DeduplicationMethod,
  DuplicatePair,
} from '../types/compaction.js';

export class Deduplicator {
  private llmClient: UnifiedLLMClient;

  constructor(
    private db: Database.Database,
    llmClient?: UnifiedLLMClient
  ) {
    this.llmClient = llmClient || createLLMClient();
  }

  /**
   * Find and optionally merge duplicate entries
   */
  async deduplicate(input: DeduplicateEntriesInput): Promise<DeduplicateEntriesOutput> {
    const {
      similarity_threshold = 0.85,
      method = 'embedding',
      session_id,
      auto_merge = false,
      dry_run = true,
    } = input;

    logger.info({ method, threshold: similarity_threshold, dry_run }, 'Starting deduplication');

    try {
      // Get entries to check
      let query = 'SELECT * FROM knowledge_entries';
      const params: any[] = [];

      if (session_id) {
        query += ' WHERE session_id = ?';
        params.push(session_id);
      }

      const entries = this.db.prepare(query).all(...params) as any[];

      if (entries.length < 2) {
        return {
          success: true,
          dry_run,
          duplicates_found: 0,
          duplicates_merged: 0,
          duplicate_pairs: [],
          space_saved_bytes: 0,
        };
      }

      logger.debug({ entry_count: entries.length }, 'Checking entries for duplicates');

      // Find duplicates based on method
      let duplicatePairs: DuplicatePair[];

      if (method === 'exact') {
        duplicatePairs = await this.findExactDuplicates(entries);
      } else if (method === 'fuzzy') {
        duplicatePairs = await this.findFuzzyDuplicates(entries, similarity_threshold);
      } else {
        // embedding method
        duplicatePairs = await this.findEmbeddingDuplicates(entries, similarity_threshold);
      }

      logger.info({ duplicates_found: duplicatePairs.length }, 'Duplicates detected');

      // Merge duplicates if not dry run and auto_merge enabled
      let mergedCount = 0;
      let spaceSaved = 0;

      if (!dry_run && auto_merge && duplicatePairs.length > 0) {
        const result = await this.mergeDuplicates(duplicatePairs);
        mergedCount = result.merged_count;
        spaceSaved = result.space_saved;
      }

      return {
        success: true,
        dry_run,
        duplicates_found: duplicatePairs.length,
        duplicates_merged: mergedCount,
        duplicate_pairs: duplicatePairs,
        space_saved_bytes: spaceSaved,
      };
    } catch (err: any) {
      logger.error({ err }, 'Deduplication failed');
      throw err;
    }
  }

  /**
   * Find exact duplicates (same content hash)
   */
  private async findExactDuplicates(entries: any[]): Promise<DuplicatePair[]> {
    const pairs: DuplicatePair[] = [];
    const hashMap = new Map<string, any[]>();

    // Group entries by hash
    for (const entry of entries) {
      const hash = textHash(normalizeText(entry.content));

      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }

      hashMap.get(hash)!.push(entry);
    }

    // Find duplicates
    for (const [hash, group] of hashMap) {
      if (group.length > 1) {
        // All pairs in this group are duplicates
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            pairs.push({
              entry1: group[i],
              entry2: group[j],
              similarity: 1.0,
            });
          }
        }
      }
    }

    return pairs;
  }

  /**
   * Find fuzzy duplicates (Levenshtein similarity)
   */
  private async findFuzzyDuplicates(
    entries: any[],
    threshold: number
  ): Promise<DuplicatePair[]> {
    const pairs: DuplicatePair[] = [];

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const text1 = normalizeText(entries[i].content);
        const text2 = normalizeText(entries[j].content);

        const similarity = levenshteinSimilarity(text1, text2);

        if (similarity >= threshold) {
          pairs.push({
            entry1: entries[i],
            entry2: entries[j],
            similarity,
          });
        }
      }
    }

    return pairs;
  }

  /**
   * Find embedding-based duplicates (semantic similarity)
   */
  private async findEmbeddingDuplicates(
    entries: any[],
    threshold: number
  ): Promise<DuplicatePair[]> {
    // Generate embeddings for all entries
    const texts = entries.map(e => e.content);

    logger.debug({ count: texts.length }, 'Generating embeddings');

    const embeddings = (await this.llmClient.embed(texts)) as number[][];

    // Build items with embeddings
    const items = entries.map((entry, idx) => ({
      embedding: embeddings[idx],
      data: entry,
    }));

    // Find similar pairs
    const similarPairs = findSimilarPairs(items, threshold);

    logger.debug({ pairs_found: similarPairs.length }, 'Similar pairs found');

    return similarPairs.map(pair => ({
      entry1: pair.item1,
      entry2: pair.item2,
      similarity: pair.similarity,
    }));
  }

  /**
   * Merge duplicate pairs
   */
  private async mergeDuplicates(
    pairs: DuplicatePair[]
  ): Promise<{ merged_count: number; space_saved: number }> {
    const merged = new Set<number>();
    let mergedCount = 0;
    let spaceSaved = 0;

    // Build a graph of duplicates
    const graph = new Map<number, Set<number>>();

    for (const pair of pairs) {
      const id1 = pair.entry1.id;
      const id2 = pair.entry2.id;

      if (!graph.has(id1)) graph.set(id1, new Set());
      if (!graph.has(id2)) graph.set(id2, new Set());

      graph.get(id1)!.add(id2);
      graph.get(id2)!.add(id1);
    }

    // Find connected components (groups of duplicates)
    const visited = new Set<number>();
    const components: number[][] = [];

    const dfs = (node: number, component: number[]) => {
      visited.add(node);
      component.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, component);
        }
      }
    };

    for (const [node] of graph) {
      if (!visited.has(node)) {
        const component: number[] = [];
        dfs(node, component);
        if (component.length > 1) {
          components.push(component);
        }
      }
    }

    logger.debug({ components: components.length }, 'Duplicate components found');

    // Merge each component
    for (const component of components) {
      // Keep the first entry, delete the rest
      const keepId = component[0];
      const deleteIds = component.slice(1);

      // Calculate space saved
      const deleteEntries = this.db
        .prepare(`SELECT content FROM knowledge_entries WHERE id IN (${deleteIds.join(',')})`)
        .all() as any[];

      spaceSaved += deleteEntries.reduce((sum, e) => sum + e.content.length, 0);

      // Record duplicates in database
      for (const deleteId of deleteIds) {
        await this.recordDuplicate({
          entry_id_1: keepId,
          entry_id_2: deleteId,
          similarity: 1.0, // Approximation
          action: 'merged',
        });
      }

      // Delete duplicate entries
      this.db
        .prepare(`DELETE FROM knowledge_entries WHERE id IN (${deleteIds.join(',')})`)
        .run();

      mergedCount += deleteIds.length;

      // Add deleted IDs to merged set
      for (const id of deleteIds) {
        merged.add(id);
      }
    }

    logger.info({ merged_count: mergedCount, space_saved: spaceSaved }, 'Duplicates merged');

    return { merged_count: mergedCount, space_saved: spaceSaved };
  }

  /**
   * Record duplicate in database
   */
  private async recordDuplicate(input: {
    entry_id_1: number;
    entry_id_2: number;
    similarity: number;
    action?: string;
  }): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO entry_duplicates (entry_id_1, entry_id_2, similarity_score, action)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.entry_id_1,
      input.entry_id_2,
      input.similarity,
      input.action || null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get duplicate records
   */
  async getDuplicates(threshold: number = 0.85): Promise<any[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM entry_duplicates
      WHERE similarity_score >= ?
      ORDER BY similarity_score DESC
    `);

    return stmt.all(threshold) as any[];
  }
}

/**
 * Factory function
 */
export function createDeduplicator(
  db: Database.Database,
  llmClient?: UnifiedLLMClient
): Deduplicator {
  return new Deduplicator(db, llmClient);
}
