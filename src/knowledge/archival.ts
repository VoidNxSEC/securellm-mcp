// Knowledge Session Archival and Restoration

import type Database from 'better-sqlite3';
import { createGzip, createGunzip } from 'zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type {
  ArchiveOldSessionsInput,
  ArchiveOldSessionsOutput,
  RestoreArchivedSessionInput,
  RestoreArchivedSessionOutput,
  CompressionType,
  ArchiveData,
} from '../types/compaction.js';

export class Archiver {
  constructor(private db: Database.Database) {}

  /**
   * Archive old sessions to compressed files
   */
  async archiveOldSessions(input: ArchiveOldSessionsInput): Promise<ArchiveOldSessionsOutput> {
    const {
      age_threshold_days = 90,
      archive_path = '/var/lib/mcp-knowledge/archive',
      exclude_high_priority = true,
      exclude_pinned = true,
      compression = 'gzip',
      keep_summaries = true,
      dry_run = true,
    } = input;

    logger.info({ age_threshold_days, dry_run }, 'Starting session archival');

    try {
      // Ensure archive directory exists
      if (!dry_run && !existsSync(archive_path)) {
        mkdirSync(archive_path, { recursive: true });
      }

      // Find old sessions
      let query = `
        SELECT s.* FROM sessions s
        WHERE (julianday('now') - julianday(s.last_active)) > ?
      `;
      const params: (number | string)[] = [age_threshold_days];

      if (exclude_pinned) {
        query += ' AND COALESCE(s.pinned, 0) = 0';
      }

      if (exclude_high_priority) {
        query += `
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_entries ke
            WHERE ke.session_id = s.id AND ke.priority = 'high'
          )
        `;
      }

      interface SessionRow {
        id: string;
        created_at: string;
        last_active: string;
        summary: string | null;
        entry_count: number;
        metadata?: string;
        pinned?: number;
      }
      const oldSessions = this.db.prepare(query).all(...params) as SessionRow[];

      if (oldSessions.length === 0) {
        return {
          success: true,
          dry_run,
          sessions_archived: 0,
          entries_archived: 0,
          space_saved_bytes: 0,
          archive_files: [],
        };
      }

      logger.info({ sessions: oldSessions.length }, 'Found sessions to archive');

      const archiveFiles: string[] = [];
      let totalEntriesArchived = 0;
      let totalSpaceSaved = 0;

      // Archive each session
      for (const session of oldSessions) {
        const result = await this.archiveSession(
          session.id,
          archive_path,
          compression,
          keep_summaries,
          dry_run
        );

        if (result.success) {
          if (result.archive_file) {
            archiveFiles.push(result.archive_file);
          }
          totalEntriesArchived += result.entries_archived;
          totalSpaceSaved += result.space_saved;
        }
      }

      logger.info(
        {
          sessions: oldSessions.length,
          entries: totalEntriesArchived,
          space_saved: totalSpaceSaved,
        },
        'Session archival completed'
      );

      return {
        success: true,
        dry_run,
        sessions_archived: oldSessions.length,
        entries_archived: totalEntriesArchived,
        space_saved_bytes: totalSpaceSaved,
        archive_files: archiveFiles,
      };
    } catch (err: unknown) {
      logger.error({ err }, 'Session archival failed');
      throw err;
    }
  }

  /**
   * Archive a single session
   */
  private async archiveSession(
    sessionId: string,
    archivePath: string,
    compression: CompressionType,
    keepSummaries: boolean,
    dryRun: boolean
  ): Promise<{
    success: boolean;
    archive_file?: string;
    entries_archived: number;
    space_saved: number;
  }> {
    try {
      // Get session data
      const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;

      if (!session) {
        logger.warn({ sessionId }, 'Session not found');
        return { success: false, entries_archived: 0, space_saved: 0 };
      }

      // Get all entries
      const entries = this.db
        .prepare('SELECT * FROM knowledge_entries WHERE session_id = ?')
        .all(sessionId) as any[];

      // Calculate original size
      const originalSize = JSON.stringify({ session, entries }).length;

      // Build archive data
      const archiveData: ArchiveData = {
        version: '1.0',
        archived_at: new Date().toISOString(),
        session,
        entries,
        archive_metadata: {
          original_size_bytes: originalSize,
          compressed_size_bytes: 0, // Will be updated after compression
          compression_ratio: 0,
        },
      };

      if (dryRun) {
        // Estimate compressed size (rough approximation)
        const estimatedCompressed = Math.floor(originalSize * 0.3);

        return {
          success: true,
          entries_archived: entries.length,
          space_saved: originalSize - estimatedCompressed,
        };
      }

      // Generate archive filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const extension = compression === 'gzip' ? 'json.gz' : compression === 'bzip2' ? 'json.bz2' : 'json';
      const archiveFile = join(archivePath, `session_${sessionId}_${timestamp}.${extension}`);

      // Write archive file
      const compressedSize = await this.writeArchiveFile(archiveFile, archiveData, compression);

      // Update archive data with actual compressed size
      archiveData.archive_metadata.compressed_size_bytes = compressedSize;
      archiveData.archive_metadata.compression_ratio = compressedSize / originalSize;

      // Store archive metadata in database
      await this.createArchiveMetadata({
        session_id: sessionId,
        archive_file: archiveFile,
        entry_count: entries.length,
        original_size: originalSize,
        compressed_size: compressedSize,
      });

      if (keepSummaries) {
        // Only delete entries, keep session and summaries
        this.db.prepare('DELETE FROM knowledge_entries WHERE session_id = ?').run(sessionId);

        // Mark session as archived
        this.db
          .prepare('UPDATE sessions SET tier = ?, metadata = json_set(metadata, \'$.archived\', 1) WHERE id = ?')
          .run('cold', sessionId);
      } else {
        // Delete entire session (CASCADE will delete entries)
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      }

      logger.info(
        {
          sessionId,
          archive_file: archiveFile,
          entries: entries.length,
          original_size: originalSize,
          compressed_size: compressedSize,
          ratio: archiveData.archive_metadata.compression_ratio.toFixed(2),
        },
        'Session archived'
      );

      return {
        success: true,
        archive_file: archiveFile,
        entries_archived: entries.length,
        space_saved: originalSize,
      };
    } catch (err: any) {
      logger.error({ err, sessionId }, 'Failed to archive session');
      return { success: false, entries_archived: 0, space_saved: 0 };
    }
  }

  /**
   * Write archive file with compression
   */
  private async writeArchiveFile(
    filePath: string,
    data: ArchiveData,
    compression: CompressionType
  ): Promise<number> {
    const jsonContent = JSON.stringify(data, null, 2);

    if (compression === 'none') {
      await writeFile(filePath, jsonContent, 'utf-8');
      return jsonContent.length;
    }

    // Create temporary uncompressed file
    const tempFile = filePath + '.tmp';
    await writeFile(tempFile, jsonContent, 'utf-8');

    // Compress
    if (compression === 'bzip2') {
      throw new Error('bzip2 compression is not yet supported. Use "gzip" or "none" instead.');
    }

    const input = createReadStream(tempFile);
    const output = createWriteStream(filePath);
    const compressor = createGzip();

    await pipeline(input, compressor, output);

    // Get compressed size
    const { size } = await stat(filePath);

    // Clean up temp file
    await unlink(tempFile);

    return size;
  }

  /**
   * Restore archived session
   */
  async restoreArchivedSession(input: RestoreArchivedSessionInput): Promise<RestoreArchivedSessionOutput> {
    const {
      session_id,
      restore_mode = 'full',
      archive_path,
      force = false,
      restore_tier = 'warm',
    } = input;

    logger.info({ session_id, restore_mode }, 'Restoring archived session');

    try {
      // Get archive metadata
      const archiveMeta = this.db
        .prepare('SELECT * FROM archive_metadata WHERE session_id = ? ORDER BY archived_at DESC LIMIT 1')
        .get(session_id) as any;

      if (!archiveMeta) {
        return {
          success: false,
          session_id,
          entries_restored: 0,
          error: `No archive found for session ${session_id}`,
        };
      }

      const archiveFile = archive_path || archiveMeta.archive_file;

      if (!existsSync(archiveFile)) {
        return {
          success: false,
          session_id,
          entries_restored: 0,
          error: `Archive file not found: ${archiveFile}`,
        };
      }

      // Check if session already exists
      const existingSession = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(session_id);

      if (existingSession && !force) {
        return {
          success: false,
          session_id,
          entries_restored: 0,
          error: `Session ${session_id} already exists. Use force=true to overwrite.`,
        };
      }

      // Read and decompress archive
      const archiveData = await this.readArchiveFile(archiveFile);

      if (restore_mode === 'summary_only') {
        // Only restore summaries (if they exist in the archive)
        logger.info({ session_id }, 'Restoring session with summaries only');

        // Session should already exist if we're doing summary_only
        // Just update the metadata to mark as restored

        await this.updateArchiveRestore(session_id);

        return {
          success: true,
          session_id,
          entries_restored: 0,
        };
      }

      // Full restore
      if (existingSession && force) {
        // Delete existing session
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(session_id);
      }

      // Restore session
      const session = archiveData.session;
      this.db
        .prepare(`
          INSERT INTO sessions (id, created_at, last_active, summary, entry_count, metadata, tier)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          session.id,
          session.created_at,
          session.last_active,
          session.summary,
          session.entry_count,
          session.metadata,
          restore_tier
        );

      // Restore entries
      const insertEntry = this.db.prepare(`
        INSERT INTO knowledge_entries (id, session_id, timestamp, entry_type, content, tags, priority, metadata, tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const entry of archiveData.entries) {
        insertEntry.run(
          entry.id,
          entry.session_id,
          entry.timestamp,
          entry.entry_type,
          entry.content,
          entry.tags,
          entry.priority,
          entry.metadata,
          restore_tier
        );
      }

      // Update archive restore count
      await this.updateArchiveRestore(session_id);

      logger.info(
        {
          session_id,
          entries_restored: archiveData.entries.length,
        },
        'Session restored successfully'
      );

      return {
        success: true,
        session_id,
        entries_restored: archiveData.entries.length,
      };
    } catch (err: any) {
      logger.error({ err, session_id }, 'Failed to restore session');
      return {
        success: false,
        session_id,
        entries_restored: 0,
        error: err.message,
      };
    }
  }

  /**
   * Read and decompress archive file
   */
  private async readArchiveFile(filePath: string): Promise<ArchiveData> {
    const isCompressed = filePath.endsWith('.gz') || filePath.endsWith('.bz2');

    if (!isCompressed) {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    }

    // Decompress
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const input = createReadStream(filePath);
      const decompressor = createGunzip();

      decompressor.on('data', chunk => chunks.push(chunk));
      decompressor.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(content));
      });
      decompressor.on('error', reject);

      input.pipe(decompressor);
    });
  }

  /**
   * Create archive metadata record
   */
  private async createArchiveMetadata(input: {
    session_id: string;
    archive_file: string;
    entry_count: number;
    original_size: number;
    compressed_size: number;
  }): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO archive_metadata (session_id, archive_file, entry_count, original_size, compressed_size, metadata)
        VALUES (?, ?, ?, ?, ?, '{}')
      `)
      .run(
        input.session_id,
        input.archive_file,
        input.entry_count,
        input.original_size,
        input.compressed_size
      );
  }

  /**
   * Update archive restore count
   */
  private async updateArchiveRestore(sessionId: string): Promise<void> {
    this.db
      .prepare(`
        UPDATE archive_metadata
        SET restore_count = restore_count + 1,
            last_restored = datetime('now')
        WHERE session_id = ?
      `)
      .run(sessionId);
  }
}

// Helper to import Node.js fs/promises functions
async function writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void> {
  const { writeFile: fsWriteFile } = await import('fs/promises');
  return fsWriteFile(path, data, encoding);
}

async function stat(path: string): Promise<{ size: number }> {
  const { stat: fsStat } = await import('fs/promises');
  const stats = await fsStat(path);
  return { size: stats.size };
}

/**
 * Factory function
 */
export function createArchiver(db: Database.Database): Archiver {
  return new Archiver(db);
}
