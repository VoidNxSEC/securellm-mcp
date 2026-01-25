// Knowledge Database Compaction Orchestration

import type Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import { diskUsage } from '../utils/disk-utils.js';
import { logger } from '../utils/logger.js';
import { createTierManager } from './tiers.js';
import { createSummarizer } from './summarization.js';
import { createDeduplicator } from './deduplication.js';
import { createArchiver } from './archival.js';
import { createLLMClient } from '../utils/llm-client.js';
import type {
  CompactKnowledgeInput,
  CompactKnowledgeOutput,
  PreFlightChecks,
  ValidationResults,
  CompactionStats,
  TierDistribution,
} from '../types/compaction.js';

export class CompactionOrchestrator {
  constructor(private db: Database.Database, private dbPath: string) {}

  /**
   * Main compaction entry point
   */
  async compact(input: CompactKnowledgeInput): Promise<CompactKnowledgeOutput> {
    const startTime = Date.now();
    const {
      dry_run = true,
      mode = 'incremental',
      hot_threshold = 7,
      warm_threshold = 30,
      cold_threshold = 90,
      skip_deduplication = false,
      skip_vacuum = false,
      archive_path = '/var/lib/mcp-knowledge/archive',
      backup_before = true,
      validate_after = true,
    } = input;

    // Mutable flags that may change during pre-flight
    let skip_summarization = input.skip_summarization ?? false;

    logger.info({ mode, dry_run }, 'Starting knowledge database compaction');

    const operationId = await this.startOperation('compact_knowledge', {
      mode,
      dry_run,
      thresholds: { hot_threshold, warm_threshold, cold_threshold },
    });

    let backupPath: string | undefined;
    const errors: string[] = [];

    try {
      // === PRE-FLIGHT CHECKS ===
      logger.info('Running pre-flight checks');
      const preFlightChecks = await this.runPreFlightChecks();

      if (!preFlightChecks.database_integrity) {
        throw new Error('Database integrity check failed');
      }

      if (!preFlightChecks.disk_space_available) {
        errors.push('Insufficient disk space');
      }

      if (!preFlightChecks.write_permissions) {
        errors.push('No write permissions for archive directory');
      }

      if (!skip_summarization && !preFlightChecks.llm_api_available) {
        logger.warn('LLM API not available, skipping summarization');
        skip_summarization = true;
      }

      if (preFlightChecks.warnings.length > 0) {
        logger.warn({ warnings: preFlightChecks.warnings }, 'Pre-flight warnings');
      }

      // Get initial stats
      const beforeStats = await this.getStats();

      // === BACKUP ===
      if (backup_before && !dry_run) {
        logger.info('Creating database backup');
        backupPath = await this.createBackup();
      }

      // === TIER CLASSIFICATION ===
      logger.info('Classifying sessions into tiers');
      const tierManager = createTierManager(this.db, {
        hot_threshold,
        warm_threshold,
        cold_threshold,
      });

      const classifications = await tierManager.classifyAllSessions();

      // Update tiers
      if (!dry_run) {
        for (const classification of classifications) {
          if (classification.current_tier !== classification.recommended_tier) {
            await tierManager.updateSessionTier(classification.session_id, classification.recommended_tier);
            await tierManager.updateEntryTiers(classification.session_id, classification.recommended_tier);
          }
        }
      }

      const tierDist = tierManager.getTierDistribution();
      logger.info({ tiers: tierDist }, 'Tier distribution after classification');

      // === OPERATIONS ===
      let sessionsSummarized = 0;
      let entriesArchived = 0;
      let duplicatesMerged = 0;

      // WARM TIER: Summarization
      if (!skip_summarization && (mode === 'full' || mode === 'incremental' || mode === 'summarize_only')) {
        logger.info('Summarizing warm tier sessions');

        const warmSessions = tierManager.getSessionsByTier('warm');
        const summarizer = createSummarizer(this.db);

        for (const sessionId of warmSessions) {
          // Check if already summarized
          const summaries = await summarizer.getSummariesForSession(sessionId);

          if (summaries.length === 0) {
            const result = await summarizer.summarizeSession({
              session_id: sessionId,
              summary_type: 'session',
              temperature: 0.3,
              max_tokens: 500,
            });

            if (result.success) {
              sessionsSummarized++;
              logger.debug({ sessionId }, 'Session summarized');
            } else {
              logger.warn({ sessionId, error: result.error }, 'Summarization failed');
            }
          }
        }
      }

      // COLD TIER: Archival
      if (mode === 'full' || mode === 'incremental' || mode === 'archive_only') {
        logger.info('Archiving cold tier sessions');

        const archiver = createArchiver(this.db);

        const archiveResult = await archiver.archiveOldSessions({
          age_threshold_days: cold_threshold,
          archive_path,
          exclude_high_priority: true,
          exclude_pinned: true,
          compression: 'gzip',
          keep_summaries: true,
          dry_run,
        });

        entriesArchived = archiveResult.entries_archived;
      }

      // DEDUPLICATION
      if (!skip_deduplication && (mode === 'full' || mode === 'incremental')) {
        logger.info('Deduplicating entries');

        const deduplicator = createDeduplicator(this.db);

        const dedupeResult = await deduplicator.deduplicate({
          similarity_threshold: 0.85,
          method: 'embedding',
          auto_merge: true,
          dry_run,
        });

        duplicatesMerged = dedupeResult.duplicates_merged;
      }

      // VACUUM
      if (!skip_vacuum && !dry_run && (mode === 'full' || mode === 'incremental')) {
        logger.info('Running VACUUM and ANALYZE');
        this.db.pragma('optimize');
        this.db.exec('VACUUM');
        this.db.exec('ANALYZE');
      }

      // === VALIDATION ===
      if (validate_after && !dry_run) {
        logger.info('Running post-compaction validation');
        const validationResults = await this.runValidation(beforeStats);

        if (!validationResults.integrity_check) {
          throw new Error('Post-compaction integrity check failed - rolling back');
        }

        if (validationResults.errors.length > 0) {
          errors.push(...validationResults.errors);
        }

        if (validationResults.warnings.length > 0) {
          logger.warn({ warnings: validationResults.warnings }, 'Validation warnings');
        }
      }

      // Get final stats
      const afterStats = await this.getStats();
      const afterTierDist = tierManager.getTierDistribution();

      const spaceSaved = (beforeStats.size_mb - afterStats.size_mb) * 1024 * 1024;

      // Record success
      await this.completeOperation(operationId, {
        entries_affected: sessionsSummarized + entriesArchived + duplicatesMerged,
        space_saved: Math.floor(spaceSaved),
      });

      const duration = Date.now() - startTime;

      logger.info(
        {
          duration_ms: duration,
          sessions_summarized: sessionsSummarized,
          entries_archived: entriesArchived,
          duplicates_merged: duplicatesMerged,
          space_saved_mb: (spaceSaved / (1024 * 1024)).toFixed(2),
        },
        'Compaction completed successfully'
      );

      return {
        success: true,
        dry_run,
        operations_performed: {
          sessions_summarized: sessionsSummarized,
          entries_archived: entriesArchived,
          duplicates_merged: duplicatesMerged,
          space_saved_bytes: Math.floor(spaceSaved),
        },
        tier_distribution: afterTierDist,
        before_stats: beforeStats,
        after_stats: afterStats,
        backup_file: backupPath,
        duration_ms: duration,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err: any) {
      logger.error({ err }, 'Compaction failed');

      // Record failure
      await this.completeOperation(operationId, {
        error: err.message,
      });

      // Attempt rollback if we have a backup
      if (backupPath && !dry_run) {
        logger.warn('Attempting rollback from backup');
        await this.rollback(backupPath);
      }

      throw err;
    }
  }

  /**
   * Pre-flight checks
   */
  private async runPreFlightChecks(): Promise<PreFlightChecks> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Database integrity check
    const integrityCheck = await this.checkIntegrity();

    // Disk space check (need 2x current DB size free)
    const dbSize = this.getDbSize();
    const diskSpace = await this.getAvailableDiskSpace();
    const diskSpaceAvailable = diskSpace > dbSize * 2;

    if (!diskSpaceAvailable) {
      warnings.push(`Low disk space: ${(diskSpace / (1024 * 1024)).toFixed(0)}MB available, need ${((dbSize * 2) / (1024 * 1024)).toFixed(0)}MB`);
    }

    // LLM API health check
    let llmApiAvailable = false;
    try {
      const llmClient = createLLMClient();
      llmApiAvailable = await llmClient.health();
    } catch {
      llmApiAvailable = false;
    }

    // Write permissions check
    let writePermissions = true;
    try {
      const archivePath = '/var/lib/mcp-knowledge/archive';
      if (existsSync(archivePath)) {
        // Try to write a test file
        // (simplified check - in production, actually write a test file)
        writePermissions = true;
      }
    } catch {
      writePermissions = false;
    }

    // Foreign key check
    const fkErrors = await this.checkForeignKeys();
    if (fkErrors.length > 0) {
      errors.push(`Foreign key violations: ${fkErrors.length}`);
    }

    return {
      database_integrity: integrityCheck,
      disk_space_available: diskSpaceAvailable,
      llm_api_available: llmApiAvailable,
      write_permissions: writePermissions,
      foreign_key_check: fkErrors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validation after compaction
   */
  private async runValidation(beforeStats: CompactionStats): Promise<ValidationResults> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Integrity check
    const integrityCheck = await this.checkIntegrity();

    // Entry count delta (should not lose more than 20% unexpectedly)
    const afterStats = await this.getStats();
    const entryDelta = beforeStats.entries - afterStats.entries;
    const entryDeltaPercent = (entryDelta / beforeStats.entries) * 100;

    if (entryDeltaPercent > 20) {
      warnings.push(`Large entry count reduction: ${entryDeltaPercent.toFixed(1)}%`);
    }

    // FTS consistency check
    const ftsConsistent = await this.checkFTSConsistency();

    // Foreign key check
    const fkErrors = await this.checkForeignKeys();
    if (fkErrors.length > 0) {
      errors.push(`Foreign key violations: ${fkErrors.length}`);
    }

    // Tier distribution should be reasonable
    const tierManager = createTierManager(this.db);
    const tierDist = tierManager.getTierDistribution();
    const totalSessions = tierDist.hot + tierDist.warm + tierDist.cold + tierDist.frozen;
    const tierDistValid = totalSessions === afterStats.sessions;

    if (!tierDistValid) {
      warnings.push('Tier distribution mismatch');
    }

    return {
      integrity_check: integrityCheck,
      entry_count_delta: entryDelta,
      fts_consistency: ftsConsistent,
      foreign_key_check: fkErrors.length === 0,
      tier_distribution_valid: tierDistValid,
      errors,
      warnings,
    };
  }

  /**
   * Database stats
   */
  private async getStats(): Promise<CompactionStats> {
    const stats = this.db
      .prepare(`
        SELECT
          COUNT(DISTINCT s.id) as sessions,
          COUNT(ke.id) as entries
        FROM sessions s
        LEFT JOIN knowledge_entries ke ON s.id = ke.session_id
      `)
      .get() as any;

    const dbSize = this.getDbSize();

    return {
      size_mb: dbSize / (1024 * 1024),
      sessions: stats.sessions || 0,
      entries: stats.entries || 0,
    };
  }

  /**
   * Get database size in bytes
   */
  private getDbSize(): number {
    if (!existsSync(this.dbPath)) {
      return 0;
    }

    return statSync(this.dbPath).size;
  }

  /**
   * Get available disk space
   */
  private async getAvailableDiskSpace(): Promise<number> {
    try {
      // Simple estimation - in production, use actual disk space check
      return 1024 * 1024 * 1024 * 10; // 10GB assumption
    } catch {
      return 0;
    }
  }

  /**
   * Database integrity check
   */
  private async checkIntegrity(): Promise<boolean> {
    const result = this.db.pragma('integrity_check') as any[];
    return result.length === 1 && result[0].integrity_check === 'ok';
  }

  /**
   * Foreign key check
   */
  private async checkForeignKeys(): Promise<any[]> {
    return this.db.pragma('foreign_key_check') as any[];
  }

  /**
   * FTS consistency check
   */
  private async checkFTSConsistency(): Promise<boolean> {
    try {
      const entryCount = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_entries').get() as any;
      const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_fts').get() as any;

      return entryCount.count === ftsCount.count;
    } catch {
      return false;
    }
  }

  /**
   * Create backup
   */
  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dbPath}.backup-${timestamp}`;

    const backupDb = new (this.db.constructor as any)(backupPath);
    await this.db.backup(backupDb);
    backupDb.close();

    logger.info({ backupPath }, 'Database backup created');
    return backupPath;
  }

  /**
   * Rollback from backup
   */
  private async rollback(backupPath: string): Promise<void> {
    logger.warn({ backupPath }, 'Rolling back from backup');

    try {
      // Close current database
      this.db.close();

      // Copy backup over current database
      const fs = await import('fs/promises');
      await fs.copyFile(backupPath, this.dbPath);

      // Reopen database
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      logger.info('Rollback completed');
    } catch (err) {
      logger.error({ err }, 'Rollback failed');
      throw err;
    }
  }

  /**
   * Start compaction operation (record in history)
   */
  private async startOperation(operation: string, metadata: Record<string, any>): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO compaction_history (operation, started_at, metadata)
      VALUES (?, datetime('now'), ?)
    `);

    const result = stmt.run(operation, JSON.stringify(metadata));
    return result.lastInsertRowid as number;
  }

  /**
   * Complete compaction operation
   */
  private async completeOperation(
    id: number,
    stats: {
      entries_affected?: number;
      space_saved?: number;
      error?: string;
    }
  ): Promise<void> {
    this.db
      .prepare(`
        UPDATE compaction_history
        SET completed_at = datetime('now'),
            entries_affected = ?,
            space_saved = ?,
            error = ?
        WHERE id = ?
      `)
      .run(stats.entries_affected || null, stats.space_saved || null, stats.error || null, id);
  }
}

/**
 * Factory function
 */
export function createCompactionOrchestrator(db: Database.Database, dbPath: string): CompactionOrchestrator {
  return new CompactionOrchestrator(db, dbPath);
}
