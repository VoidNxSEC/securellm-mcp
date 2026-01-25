// Type definitions for Knowledge Database Compaction System

export type Tier = 'hot' | 'warm' | 'cold' | 'frozen';
export type SummaryType = 'session' | 'topic' | 'cluster';
export type CompactionMode = 'full' | 'incremental' | 'archive_only' | 'summarize_only';
export type DeduplicationMethod = 'exact' | 'embedding' | 'fuzzy';
export type CompressionType = 'gzip' | 'bzip2' | 'none';
export type DuplicateAction = 'merged' | 'kept_both' | 'ignored';

// Summary Types
export interface KnowledgeSummary {
  id: number;
  session_id: string;
  summary_type: SummaryType;
  content: string;
  entry_count: number;
  token_count: number | null;
  generated_at: string;
  source_entries: number[]; // Array of entry IDs
  metadata: Record<string, any>;
}

export interface CreateSummaryInput {
  session_id: string;
  summary_type: SummaryType;
  content: string;
  entry_count: number;
  token_count?: number;
  source_entries: number[];
  metadata?: Record<string, any>;
}

// Archive Types
export interface ArchiveMetadata {
  id: number;
  session_id: string;
  archive_file: string;
  entry_count: number;
  original_size: number;
  compressed_size: number;
  archived_at: string;
  restore_count: number;
  last_restored: string | null;
  metadata: Record<string, any>;
}

export interface ArchiveData {
  version: string;
  archived_at: string;
  session: any;
  entries: any[];
  archive_metadata: {
    original_size_bytes: number;
    compressed_size_bytes: number;
    compression_ratio: number;
  };
}

// Deduplication Types
export interface EntryDuplicate {
  id: number;
  entry_id_1: number;
  entry_id_2: number;
  similarity_score: number;
  detected_at: string;
  action: DuplicateAction | null;
}

export interface DuplicatePair {
  entry1: any;
  entry2: any;
  similarity: number;
}

// Compaction History
export interface CompactionHistory {
  id: number;
  operation: string;
  started_at: string;
  completed_at: string | null;
  entries_affected: number | null;
  space_saved: number | null;
  error: string | null;
  metadata: Record<string, any>;
}

// Tier Distribution
export interface TierDistribution {
  hot: number;
  warm: number;
  cold: number;
  frozen: number;
}

// Compaction Input/Output Types
export interface CompactKnowledgeInput {
  dry_run?: boolean;
  mode?: CompactionMode;
  hot_threshold?: number;
  warm_threshold?: number;
  cold_threshold?: number;
  skip_summarization?: boolean;
  skip_deduplication?: boolean;
  skip_vacuum?: boolean;
  archive_path?: string;
  backup_before?: boolean;
  validate_after?: boolean;
}

export interface CompactionStats {
  size_mb: number;
  sessions: number;
  entries: number;
}

export interface CompactKnowledgeOutput {
  success: boolean;
  dry_run: boolean;
  operations_performed: {
    sessions_summarized: number;
    entries_archived: number;
    duplicates_merged: number;
    space_saved_bytes: number;
  };
  tier_distribution: TierDistribution;
  before_stats: CompactionStats;
  after_stats: CompactionStats;
  backup_file?: string;
  duration_ms: number;
  errors?: string[];
}

// Summarization Input/Output
export interface SummarizeSessionInput {
  session_id: string;
  summary_type?: SummaryType;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  include_code?: boolean;
  include_tags?: boolean;
  min_entry_count?: number;
}

export interface SummarizeSessionOutput {
  success: boolean;
  summary_id?: number;
  summary?: KnowledgeSummary;
  error?: string;
}

// Deduplication Input/Output
export interface DeduplicateEntriesInput {
  similarity_threshold?: number;
  method?: DeduplicationMethod;
  session_id?: string;
  auto_merge?: boolean;
  dry_run?: boolean;
}

export interface DeduplicateEntriesOutput {
  success: boolean;
  dry_run: boolean;
  duplicates_found: number;
  duplicates_merged: number;
  duplicate_pairs: DuplicatePair[];
  space_saved_bytes: number;
}

// Archive Input/Output
export interface ArchiveOldSessionsInput {
  age_threshold_days?: number;
  archive_path?: string;
  exclude_high_priority?: boolean;
  exclude_pinned?: boolean;
  compression?: CompressionType;
  keep_summaries?: boolean;
  dry_run?: boolean;
}

export interface ArchiveOldSessionsOutput {
  success: boolean;
  dry_run: boolean;
  sessions_archived: number;
  entries_archived: number;
  space_saved_bytes: number;
  archive_files: string[];
}

// Restore Input/Output
export interface RestoreArchivedSessionInput {
  session_id: string;
  restore_mode?: 'full' | 'summary_only';
  archive_path?: string;
  force?: boolean;
  restore_tier?: 'hot' | 'warm';
}

export interface RestoreArchivedSessionOutput {
  success: boolean;
  session_id: string;
  entries_restored: number;
  error?: string;
}

// Tier Classification
export interface TierClassification {
  session_id: string;
  current_tier: Tier;
  recommended_tier: Tier;
  reason: string;
  age_days: number;
  entry_count: number;
  last_active: string;
  is_pinned: boolean;
  has_high_priority: boolean;
}

// Pre-flight Check Results
export interface PreFlightChecks {
  database_integrity: boolean;
  disk_space_available: boolean;
  llm_api_available: boolean;
  write_permissions: boolean;
  foreign_key_check: boolean;
  errors: string[];
  warnings: string[];
}

// Validation Results
export interface ValidationResults {
  integrity_check: boolean;
  entry_count_delta: number;
  fts_consistency: boolean;
  foreign_key_check: boolean;
  tier_distribution_valid: boolean;
  errors: string[];
  warnings: string[];
}
