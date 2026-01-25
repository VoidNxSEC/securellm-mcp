import type { KnowledgeDatabase, Session, KnowledgeEntry, SearchResult, SessionStats, CreateSessionInput, SaveKnowledgeInput, SearchKnowledgeInput } from '../types/knowledge.js';
export declare class SQLiteKnowledgeDatabase implements KnowledgeDatabase {
    private db;
    constructor(dbPath: string);
    private initialize;
    /**
     * Initialize compaction-related tables
     */
    private initCompactionTables;
    /**
     * Initialize context inference tables
     */
    private initContextTables;
    createSession(input: CreateSessionInput): Promise<Session>;
    getSession(id: string): Promise<Session | null>;
    listSessions(limit?: number, offset?: number): Promise<Session[]>;
    updateSession(id: string, updates: Partial<Session>): Promise<void>;
    deleteSession(id: string): Promise<void>;
    saveKnowledge(input: SaveKnowledgeInput): Promise<KnowledgeEntry>;
    getKnowledgeEntry(id: number): Promise<KnowledgeEntry | null>;
    searchKnowledge(input: SearchKnowledgeInput): Promise<SearchResult[]>;
    /**
     * Run database maintenance (VACUUM, ANALYZE, OPTIMIZE)
     */
    maintenance(): Promise<void>;
    getRecentKnowledge(session_id?: string, limit?: number): Promise<KnowledgeEntry[]>;
    deleteKnowledgeEntry(id: number): Promise<void>;
    getStats(): Promise<SessionStats>;
    /**
     * Store a pattern
     */
    storePattern(pattern: {
        id: string;
        type: string;
        description: string;
        frequency: number;
        steps: string[];
        successRate: number;
    }): void;
    /**
     * Get patterns by type
     */
    getPatterns(type?: string, limit?: number): any[];
    /**
     * Store project state snapshot
     */
    storeProjectState(state: {
        root: string;
        gitBranch?: string;
        gitDirty: boolean;
        buildSuccess: boolean;
        recentFiles: string[];
        fileTypes: Record<string, number>;
    }): void;
    /**
     * Get recent project states
     */
    getRecentProjectStates(limit?: number): any[];
    cleanupOldSessions(days: number): Promise<number>;
    private generateSessionId;
    private rowToSession;
    private rowToKnowledgeEntry;
    private createSnippet;
    createSummary(input: {
        session_id: string;
        summary_type: string;
        content: string;
        entry_count: number;
        token_count?: number;
        source_entries: number[];
        metadata?: Record<string, any>;
    }): Promise<number>;
    getSummary(id: number): Promise<any | null>;
    getSummariesForSession(sessionId: string): Promise<any[]>;
    createArchiveMetadata(input: {
        session_id: string;
        archive_file: string;
        entry_count: number;
        original_size: number;
        compressed_size: number;
        metadata?: Record<string, any>;
    }): Promise<number>;
    getArchiveMetadata(sessionId: string): Promise<any | null>;
    updateArchiveRestore(sessionId: string): Promise<void>;
    recordDuplicate(input: {
        entry_id_1: number;
        entry_id_2: number;
        similarity_score: number;
        action?: string;
    }): Promise<number>;
    getDuplicates(threshold?: number): Promise<any[]>;
    startCompactionOperation(operation: string, metadata?: Record<string, any>): Promise<number>;
    completeCompactionOperation(id: number, stats: {
        entries_affected?: number;
        space_saved?: number;
        error?: string;
    }): Promise<void>;
    getCompactionHistory(limit?: number): Promise<any[]>;
    /**
     * Add missing columns to existing database (for migration)
     */
    migrateSchema(): Promise<void>;
    /**
     * Database backup
     */
    backup(backupPath: string): Promise<void>;
    /**
     * Database integrity check
     */
    checkIntegrity(): Promise<boolean>;
    /**
     * Foreign key check
     */
    checkForeignKeys(): Promise<any[]>;
    close(): void;
}
export declare function createKnowledgeDatabase(dbPath: string): KnowledgeDatabase;
//# sourceMappingURL=database.d.ts.map