// Knowledge Database Implementation with SQLite + FTS5
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
export class SQLiteKnowledgeDatabase {
    db;
    constructor(dbPath) {
        // Ensure directory exists before creating database
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            logger.info({ directory: dir }, "Created knowledge database directory");
        }
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.initialize();
        this.initContextTables();
    }
    initialize() {
        // Create sessions table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active TEXT NOT NULL DEFAULT (datetime('now')),
        summary TEXT,
        entry_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        pinned INTEGER DEFAULT 0,
        compaction_exempt INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold', 'frozen'))
      );
    `);
        // Create knowledge_entries table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        entry_type TEXT NOT NULL CHECK(entry_type IN ('insight', 'code', 'decision', 'reference', 'question', 'answer')),
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
        metadata TEXT NOT NULL DEFAULT '{}',
        tier TEXT DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold', 'frozen')),
        summarized INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        summary_id INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (summary_id) REFERENCES knowledge_summaries(id) ON DELETE SET NULL
      );
    `);
        // Create FTS5 virtual table for full-text search
        this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        entry_id UNINDEXED,
        content,
        tags,
        tokenize = 'porter unicode61'
      );
    `);
        // Create trigger to keep FTS in sync
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
        INSERT INTO knowledge_fts(entry_id, content, tags)
        VALUES (NEW.id, NEW.content, NEW.tags);
      END;
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
        DELETE FROM knowledge_fts WHERE entry_id = OLD.id;
      END;
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
        UPDATE knowledge_fts
        SET content = NEW.content, tags = NEW.tags
        WHERE entry_id = NEW.id;
      END;
    `);
        // Create indexes for performance
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entries_session ON knowledge_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_entries_type ON knowledge_entries(entry_type);
      CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON knowledge_entries(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active DESC);
      CREATE INDEX IF NOT EXISTS idx_entries_tier ON knowledge_entries(tier);
      CREATE INDEX IF NOT EXISTS idx_entries_summarized ON knowledge_entries(summarized);
      CREATE INDEX IF NOT EXISTS idx_sessions_tier ON sessions(tier);
      CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned);
    `);
        // Initialize compaction tables
        this.initCompactionTables();
        logger.info("Knowledge database schema initialized successfully");
    }
    /**
     * Initialize compaction-related tables
     */
    initCompactionTables() {
        // Knowledge summaries table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        summary_type TEXT NOT NULL CHECK(summary_type IN ('session', 'topic', 'cluster')),
        content TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        token_count INTEGER,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        source_entries TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
        // Archive metadata table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS archive_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        archive_file TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL,
        archived_at TEXT NOT NULL DEFAULT (datetime('now')),
        restore_count INTEGER DEFAULT 0,
        last_restored TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
    `);
        // Entry duplicates table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS entry_duplicates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id_1 INTEGER NOT NULL,
        entry_id_2 INTEGER NOT NULL,
        similarity_score REAL NOT NULL,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT,
        FOREIGN KEY (entry_id_1) REFERENCES knowledge_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (entry_id_2) REFERENCES knowledge_entries(id) ON DELETE CASCADE
      );
    `);
        // Compaction history table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS compaction_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        entries_affected INTEGER,
        space_saved INTEGER,
        error TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
    `);
        // FTS5 for summaries
        this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_summaries_fts USING fts5(
        summary_id UNINDEXED,
        content,
        tokenize = 'porter unicode61'
      );
    `);
        // Triggers for summaries FTS
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_summaries_ai AFTER INSERT ON knowledge_summaries BEGIN
        INSERT INTO knowledge_summaries_fts(summary_id, content)
        VALUES (NEW.id, NEW.content);
      END;
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_summaries_ad AFTER DELETE ON knowledge_summaries BEGIN
        DELETE FROM knowledge_summaries_fts WHERE summary_id = OLD.id;
      END;
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_summaries_au AFTER UPDATE ON knowledge_summaries BEGIN
        UPDATE knowledge_summaries_fts
        SET content = NEW.content
        WHERE summary_id = NEW.id;
      END;
    `);
        // Indexes for compaction tables
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON knowledge_summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_archive_session ON archive_metadata(session_id);
      CREATE INDEX IF NOT EXISTS idx_duplicates_entries ON entry_duplicates(entry_id_1, entry_id_2);
      CREATE INDEX IF NOT EXISTS idx_compaction_operation ON compaction_history(operation);
    `);
        logger.debug("Compaction tables initialized successfully");
    }
    /**
     * Initialize context inference tables
     */
    initContextTables() {
        // Patterns table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        steps TEXT NOT NULL,
        success_rate REAL DEFAULT 1.0,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
        // Project states table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        git_branch TEXT,
        git_dirty BOOLEAN,
        build_success BOOLEAN,
        recent_files TEXT,
        file_types TEXT,
        timestamp INTEGER NOT NULL
      )
    `);
        // Create indexes
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
      CREATE INDEX IF NOT EXISTS idx_patterns_last_seen ON patterns(last_seen);
      CREATE INDEX IF NOT EXISTS idx_project_states_timestamp ON project_states(timestamp);
    `);
    }
    // ===== SESSION OPERATIONS =====
    async createSession(input) {
        const id = this.generateSessionId();
        const metadata = JSON.stringify(input.metadata || {});
        const stmt = this.db.prepare(`
      INSERT INTO sessions (id, summary, metadata)
      VALUES (?, ?, ?)
    `);
        stmt.run(id, input.summary || null, metadata);
        const session = await this.getSession(id);
        if (!session) {
            throw new Error('Failed to create session');
        }
        return session;
    }
    async getSession(id) {
        const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);
        const row = stmt.get(id);
        if (!row)
            return null;
        return this.rowToSession(row);
    }
    async listSessions(limit = 50, offset = 0) {
        const stmt = this.db.prepare(`
      SELECT * FROM sessions
      ORDER BY last_active DESC
      LIMIT ? OFFSET ?
    `);
        const rows = stmt.all(limit, offset);
        return rows.map(row => this.rowToSession(row));
    }
    async updateSession(id, updates) {
        const fields = [];
        const values = [];
        if (updates.summary !== undefined) {
            fields.push('summary = ?');
            values.push(updates.summary);
        }
        if (updates.metadata !== undefined) {
            fields.push('metadata = ?');
            values.push(JSON.stringify(updates.metadata));
        }
        // Always update last_active
        fields.push('last_active = datetime(\'now\')');
        if (fields.length === 0)
            return;
        values.push(id);
        const stmt = this.db.prepare(`
      UPDATE sessions
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
        stmt.run(...values);
    }
    async deleteSession(id) {
        const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
        stmt.run(id);
    }
    // ===== KNOWLEDGE OPERATIONS =====
    async saveKnowledge(input) {
        // Create session if not provided
        let sessionId = input.session_id;
        if (!sessionId) {
            const session = await this.createSession({});
            sessionId = session.id;
        }
        const tags = JSON.stringify(input.tags || []);
        const metadata = JSON.stringify(input.metadata || {});
        const priority = input.priority || 'medium';
        const stmt = this.db.prepare(`
      INSERT INTO knowledge_entries (session_id, entry_type, content, tags, priority, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(sessionId, input.type, input.content, tags, priority, metadata);
        // Update session entry count and last_active
        this.db.prepare(`
      UPDATE sessions
      SET entry_count = entry_count + 1,
          last_active = datetime('now')
      WHERE id = ?
    `).run(sessionId);
        const entry = await this.getKnowledgeEntry(result.lastInsertRowid);
        if (!entry) {
            throw new Error('Failed to create knowledge entry');
        }
        return entry;
    }
    async getKnowledgeEntry(id) {
        const stmt = this.db.prepare(`
      SELECT * FROM knowledge_entries WHERE id = ?
    `);
        const row = stmt.get(id);
        if (!row)
            return null;
        return this.rowToKnowledgeEntry(row);
    }
    async searchKnowledge(input) {
        // Use snippet() and highlight() for better search results
        let query = `
      SELECT 
        ke.*,
        kf.rank,
        snippet(knowledge_fts, 1, '***', '***', '...', 64) as search_snippet
      FROM knowledge_entries ke
      JOIN knowledge_fts kf ON ke.id = kf.entry_id
      WHERE knowledge_fts MATCH ?
    `;
        const params = [input.query];
        if (input.session_id) {
            query += ' AND ke.session_id = ?';
            params.push(input.session_id);
        }
        if (input.entry_type) {
            query += ' AND ke.entry_type = ?';
            params.push(input.entry_type);
        }
        query += ' ORDER BY kf.rank LIMIT ?';
        params.push(input.limit || 10);
        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map(row => ({
            entry: this.rowToKnowledgeEntry(row),
            relevance: -row.rank, // FTS5 rank is negative
            snippet: row.search_snippet || this.createSnippet(row.content, input.query),
        }));
    }
    /**
     * Run database maintenance (VACUUM, ANALYZE, OPTIMIZE)
     */
    async maintenance() {
        logger.info("Running knowledge database maintenance...");
        try {
            this.db.pragma('optimize');
            this.db.exec('VACUUM');
            this.db.exec('ANALYZE');
            logger.info("Database maintenance completed successfully");
        }
        catch (err) {
            logger.error({ err }, "Database maintenance failed");
        }
    }
    async getRecentKnowledge(session_id, limit = 20) {
        let query = 'SELECT * FROM knowledge_entries';
        const params = [];
        if (session_id) {
            query += ' WHERE session_id = ?';
            params.push(session_id);
        }
        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map(row => this.rowToKnowledgeEntry(row));
    }
    async deleteKnowledgeEntry(id) {
        const stmt = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?');
        stmt.run(id);
    }
    // ===== STATS =====
    async getStats() {
        const stats = this.db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(ke.id) as total_entries,
        COUNT(DISTINCT CASE WHEN s.last_active >= datetime('now', '-7 days') THEN s.id END) as recent_sessions
      FROM sessions s
      LEFT JOIN knowledge_entries ke ON s.id = ke.session_id
    `).get();
        const dbSize = this.db.prepare(`
      SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()
    `).get();
        return {
            total_sessions: stats.total_sessions || 0,
            total_entries: stats.total_entries || 0,
            recent_sessions: stats.recent_sessions || 0,
            storage_size_mb: (dbSize.size || 0) / (1024 * 1024),
        };
    }
    // ===== CONTEXT INFERENCE OPERATIONS =====
    /**
     * Store a pattern
     */
    storePattern(pattern) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO patterns (id, type, description, frequency, steps, success_rate, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(pattern.id, pattern.type, pattern.description, pattern.frequency, JSON.stringify(pattern.steps), pattern.successRate, Date.now(), Date.now());
    }
    /**
     * Get patterns by type
     */
    getPatterns(type, limit = 10) {
        let query = 'SELECT * FROM patterns';
        const params = [];
        if (type) {
            query += ' WHERE type = ?';
            params.push(type);
        }
        query += ' ORDER BY frequency DESC, last_seen DESC LIMIT ?';
        params.push(limit);
        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map((row) => ({
            id: row.id,
            type: row.type,
            description: row.description,
            frequency: row.frequency,
            steps: JSON.parse(row.steps),
            successRate: row.success_rate,
            lastSeen: row.last_seen,
        }));
    }
    /**
     * Store project state snapshot
     */
    storeProjectState(state) {
        const stmt = this.db.prepare(`
      INSERT INTO project_states (root, git_branch, git_dirty, build_success, recent_files, file_types, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(state.root, state.gitBranch || null, state.gitDirty ? 1 : 0, state.buildSuccess ? 1 : 0, JSON.stringify(state.recentFiles), JSON.stringify(state.fileTypes), Date.now());
    }
    /**
     * Get recent project states
     */
    getRecentProjectStates(limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM project_states
      ORDER BY timestamp DESC
      LIMIT ?
    `);
        const rows = stmt.all(limit);
        return rows.map((row) => ({
            id: row.id,
            root: row.root,
            gitBranch: row.git_branch,
            gitDirty: Boolean(row.git_dirty),
            buildSuccess: Boolean(row.build_success),
            recentFiles: JSON.parse(row.recent_files),
            fileTypes: JSON.parse(row.file_types),
            timestamp: row.timestamp,
        }));
    }
    // ===== CLEANUP =====
    async cleanupOldSessions(days) {
        const stmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE last_active < datetime('now', '-' || ? || ' days')
    `);
        const result = stmt.run(days);
        return result.changes;
    }
    // ===== HELPERS =====
    generateSessionId() {
        return `sess_${randomBytes(16).toString('hex')}`;
    }
    rowToSession(row) {
        return {
            id: row.id,
            created_at: row.created_at,
            last_active: row.last_active,
            summary: row.summary,
            entry_count: row.entry_count,
            metadata: JSON.parse(row.metadata),
        };
    }
    rowToKnowledgeEntry(row) {
        return {
            id: row.id,
            session_id: row.session_id,
            timestamp: row.timestamp,
            entry_type: row.entry_type,
            content: row.content,
            tags: JSON.parse(row.tags),
            priority: row.priority,
            metadata: JSON.parse(row.metadata),
        };
    }
    createSnippet(content, query, maxLength = 200) {
        const words = query.toLowerCase().split(/\s+/);
        const contentLower = content.toLowerCase();
        // Find first occurrence of any query word
        let startIdx = -1;
        for (const word of words) {
            const idx = contentLower.indexOf(word);
            if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
                startIdx = idx;
            }
        }
        if (startIdx === -1) {
            // No match found, return beginning
            return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
        }
        // Create snippet around match
        const snippetStart = Math.max(0, startIdx - 50);
        const snippetEnd = Math.min(content.length, startIdx + maxLength);
        let snippet = content.substring(snippetStart, snippetEnd);
        if (snippetStart > 0)
            snippet = '...' + snippet;
        if (snippetEnd < content.length)
            snippet = snippet + '...';
        return snippet;
    }
    // ===== SUMMARY OPERATIONS =====
    async createSummary(input) {
        const stmt = this.db.prepare(`
      INSERT INTO knowledge_summaries (session_id, summary_type, content, entry_count, token_count, source_entries, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(input.session_id, input.summary_type, input.content, input.entry_count, input.token_count || null, JSON.stringify(input.source_entries), JSON.stringify(input.metadata || {}));
        return result.lastInsertRowid;
    }
    async getSummary(id) {
        const stmt = this.db.prepare(`
      SELECT * FROM knowledge_summaries WHERE id = ?
    `);
        const row = stmt.get(id);
        if (!row)
            return null;
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
    async getSummariesForSession(sessionId) {
        const stmt = this.db.prepare(`
      SELECT * FROM knowledge_summaries WHERE session_id = ? ORDER BY generated_at DESC
    `);
        const rows = stmt.all(sessionId);
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
    // ===== ARCHIVE OPERATIONS =====
    async createArchiveMetadata(input) {
        const stmt = this.db.prepare(`
      INSERT INTO archive_metadata (session_id, archive_file, entry_count, original_size, compressed_size, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(input.session_id, input.archive_file, input.entry_count, input.original_size, input.compressed_size, JSON.stringify(input.metadata || {}));
        return result.lastInsertRowid;
    }
    async getArchiveMetadata(sessionId) {
        const stmt = this.db.prepare(`
      SELECT * FROM archive_metadata WHERE session_id = ? ORDER BY archived_at DESC LIMIT 1
    `);
        const row = stmt.get(sessionId);
        if (!row)
            return null;
        return {
            id: row.id,
            session_id: row.session_id,
            archive_file: row.archive_file,
            entry_count: row.entry_count,
            original_size: row.original_size,
            compressed_size: row.compressed_size,
            archived_at: row.archived_at,
            restore_count: row.restore_count,
            last_restored: row.last_restored,
            metadata: JSON.parse(row.metadata),
        };
    }
    async updateArchiveRestore(sessionId) {
        this.db.prepare(`
      UPDATE archive_metadata
      SET restore_count = restore_count + 1,
          last_restored = datetime('now')
      WHERE session_id = ?
    `).run(sessionId);
    }
    // ===== DUPLICATE OPERATIONS =====
    async recordDuplicate(input) {
        const stmt = this.db.prepare(`
      INSERT INTO entry_duplicates (entry_id_1, entry_id_2, similarity_score, action)
      VALUES (?, ?, ?, ?)
    `);
        const result = stmt.run(input.entry_id_1, input.entry_id_2, input.similarity_score, input.action || null);
        return result.lastInsertRowid;
    }
    async getDuplicates(threshold = 0.85) {
        const stmt = this.db.prepare(`
      SELECT * FROM entry_duplicates
      WHERE similarity_score >= ?
      ORDER BY similarity_score DESC
    `);
        return stmt.all(threshold);
    }
    // ===== COMPACTION HISTORY =====
    async startCompactionOperation(operation, metadata) {
        const stmt = this.db.prepare(`
      INSERT INTO compaction_history (operation, started_at, metadata)
      VALUES (?, datetime('now'), ?)
    `);
        const result = stmt.run(operation, JSON.stringify(metadata || {}));
        return result.lastInsertRowid;
    }
    async completeCompactionOperation(id, stats) {
        this.db.prepare(`
      UPDATE compaction_history
      SET completed_at = datetime('now'),
          entries_affected = ?,
          space_saved = ?,
          error = ?
      WHERE id = ?
    `).run(stats.entries_affected || null, stats.space_saved || null, stats.error || null, id);
    }
    async getCompactionHistory(limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM compaction_history
      ORDER BY started_at DESC
      LIMIT ?
    `);
        const rows = stmt.all(limit);
        return rows.map(row => ({
            id: row.id,
            operation: row.operation,
            started_at: row.started_at,
            completed_at: row.completed_at,
            entries_affected: row.entries_affected,
            space_saved: row.space_saved,
            error: row.error,
            metadata: JSON.parse(row.metadata),
        }));
    }
    // ===== MIGRATION HELPERS =====
    /**
     * Add missing columns to existing database (for migration)
     */
    async migrateSchema() {
        logger.info("Starting schema migration for compaction features...");
        try {
            // Check if columns exist, add them if not
            const tableInfo = this.db.prepare("PRAGMA table_info(sessions)").all();
            const columnNames = tableInfo.map((col) => col.name);
            if (!columnNames.includes('pinned')) {
                this.db.exec("ALTER TABLE sessions ADD COLUMN pinned INTEGER DEFAULT 0");
                logger.info("Added 'pinned' column to sessions table");
            }
            if (!columnNames.includes('compaction_exempt')) {
                this.db.exec("ALTER TABLE sessions ADD COLUMN compaction_exempt INTEGER DEFAULT 0");
                logger.info("Added 'compaction_exempt' column to sessions table");
            }
            if (!columnNames.includes('tier')) {
                this.db.exec("ALTER TABLE sessions ADD COLUMN tier TEXT DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold', 'frozen'))");
                logger.info("Added 'tier' column to sessions table");
            }
            // Check knowledge_entries table
            const entriesInfo = this.db.prepare("PRAGMA table_info(knowledge_entries)").all();
            const entryColumns = entriesInfo.map((col) => col.name);
            if (!entryColumns.includes('tier')) {
                this.db.exec("ALTER TABLE knowledge_entries ADD COLUMN tier TEXT DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold', 'frozen'))");
                logger.info("Added 'tier' column to knowledge_entries table");
            }
            if (!entryColumns.includes('summarized')) {
                this.db.exec("ALTER TABLE knowledge_entries ADD COLUMN summarized INTEGER DEFAULT 0");
                logger.info("Added 'summarized' column to knowledge_entries table");
            }
            if (!entryColumns.includes('archived')) {
                this.db.exec("ALTER TABLE knowledge_entries ADD COLUMN archived INTEGER DEFAULT 0");
                logger.info("Added 'archived' column to knowledge_entries table");
            }
            if (!entryColumns.includes('summary_id')) {
                this.db.exec("ALTER TABLE knowledge_entries ADD COLUMN summary_id INTEGER REFERENCES knowledge_summaries(id) ON DELETE SET NULL");
                logger.info("Added 'summary_id' column to knowledge_entries table");
            }
            // Create indexes if they don't exist
            this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entries_tier ON knowledge_entries(tier);
        CREATE INDEX IF NOT EXISTS idx_entries_summarized ON knowledge_entries(summarized);
        CREATE INDEX IF NOT EXISTS idx_sessions_tier ON sessions(tier);
        CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned);
      `);
            logger.info("Schema migration completed successfully");
        }
        catch (err) {
            logger.error({ err }, "Schema migration failed");
            throw err;
        }
    }
    /**
     * Database backup
     */
    async backup(backupPath) {
        const backupDb = new this.db.constructor(backupPath);
        await this.db.backup(backupDb);
        backupDb.close();
        logger.info({ backupPath }, "Database backup created");
    }
    /**
     * Database integrity check
     */
    async checkIntegrity() {
        const result = this.db.pragma('integrity_check');
        return result.length === 1 && result[0].integrity_check === 'ok';
    }
    /**
     * Foreign key check
     */
    async checkForeignKeys() {
        return this.db.pragma('foreign_key_check');
    }
    close() {
        this.db.close();
    }
}
// Factory function
export function createKnowledgeDatabase(dbPath) {
    return new SQLiteKnowledgeDatabase(dbPath);
}
//# sourceMappingURL=database.js.map