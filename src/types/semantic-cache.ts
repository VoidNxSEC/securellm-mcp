/**
 * Semantic Cache Type Definitions
 *
 * Provides intelligent caching of tool responses based on semantic similarity
 * rather than exact string matching. Uses local embeddings (llama.cpp) to
 * detect queries that are semantically similar and returns cached responses.
 *
 * Cost Savings: 50-70% reduction in duplicate tool calls
 */

export interface SemanticCacheEntry {
  id: string;
  queryText: string;
  queryEmbedding: Float32Array;
  toolName: string;
  toolArgs: string; // JSON stringified
  response: string; // JSON stringified tool response
  provider?: string;
  model?: string;
  metadata: SemanticCacheMetadata;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  lastAccessedAt: number;
}

export interface SemanticCacheMetadata {
  tokensSaved?: number;
  originalLatency?: number;
  cacheTier?: 'hot' | 'warm' | 'cold';
  tags?: string[];
  [key: string]: any;
}

export interface SemanticCacheConfig {
  enabled: boolean;
  similarityThreshold: number; // 0.0 to 1.0, default 0.85
  ttlSeconds: number; // Time to live, default 3600 (1 hour)
  maxEntries: number; // Max cache entries, default 1000
  minQueryLength: number; // Minimum query length to cache, default 10
  llamaCppUrl: string; // llama.cpp server URL
  embeddingTimeout: number; // Timeout for embedding generation (ms)
  excludeTools?: string[]; // Tools to never cache
}

export interface SemanticCacheStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number; // Percentage
  tokensSaved: number;
  avgSimilarityOnHit: number;
  entriesCount: number;
  oldestEntry?: number;
  newestEntry?: number;
}

export interface SemanticSearchResult {
  entry: SemanticCacheEntry;
  similarity: number;
}

export interface CacheLookupOptions {
  toolName: string;
  queryText: string;
  toolArgs?: any;
  provider?: string;
  model?: string;
}

export interface CacheStoreOptions {
  toolName: string;
  queryText: string;
  toolArgs: any;
  response: any;
  provider?: string;
  model?: string;
  metadata?: Partial<SemanticCacheMetadata>;
  ttlSeconds?: number;
}

export const DEFAULT_SEMANTIC_CACHE_CONFIG: SemanticCacheConfig = {
  enabled: process.env.ENABLE_SEMANTIC_CACHE !== 'false',
  similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.85'),
  ttlSeconds: parseInt(process.env.SEMANTIC_CACHE_TTL || '3600', 10),
  maxEntries: parseInt(process.env.SEMANTIC_CACHE_MAX_ENTRIES || '1000', 10),
  minQueryLength: parseInt(process.env.SEMANTIC_CACHE_MIN_QUERY_LENGTH || '10', 10),
  llamaCppUrl: process.env.LLAMA_CPP_URL || 'http://localhost:8080',
  embeddingTimeout: parseInt(process.env.EMBEDDING_TIMEOUT || '5000', 10),
  excludeTools: process.env.SEMANTIC_CACHE_EXCLUDE_TOOLS?.split(',').map(t => t.trim()) || [],
};
