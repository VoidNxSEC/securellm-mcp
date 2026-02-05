/**
 * Intelligent Cache System for Token Economy
 *
 * Reduces API calls and token usage by:
 * - Caching responses with configurable TTL
 * - Deduplicating identical requests
 * - Rate limiting per tool
 * - Tracking cache hit rate
 */

import { logger } from './logger.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum cache entries
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class SmartCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private rateLimit: Map<string, RateLimitEntry> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    rateLimited: 0,
  };

  // Cache TTL per tool (in seconds)
  private ttlConfig: Record<string, number> = {
    // Static/slow-changing data - long cache
    list_models: 300, // 5 minutes
    get_model_info: 600, // 10 minutes
    list_backends: 60, // 1 minute
    health_check: 30, // 30 seconds

    // Dynamic data - short cache
    get_vram_status: 10, // 10 seconds
    get_status: 10, // 10 seconds

    // Write operations - no cache
    load_model: 0,
    unload_model: 0,
    switch_model: 0,
    trigger_model_scan: 0,
  };

  // Rate limits: max requests per minute
  private rateLimitConfig: Record<string, number> = {
    list_models: 20,
    get_model_info: 30,
    get_vram_status: 60, // Allow frequent checks
    get_status: 60,
    list_backends: 20,
    load_model: 10,
    unload_model: 10,
    switch_model: 10,
    trigger_model_scan: 5,
    health_check: 30,
  };

  constructor(private maxSize: number = 100) {}

  /**
   * Get cached data or execute function
   */
  async get<T>(
    key: string,
    tool: string,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    // Check rate limit first
    if (this.isRateLimited(tool)) {
      this.stats.rateLimited++;
      const entry = this.cache.get(key);
      if (entry) {
        logger.info(
          `[Cache] Rate limited ${tool}, returning stale cache`
        );
        return entry.data;
      }
      throw new Error(
        `Rate limit exceeded for ${tool}. Please wait a moment.`
      );
    }

    // Check cache
    const ttl = this.ttlConfig[tool] || 0;
    if (ttl > 0) {
      const entry = this.cache.get(key);
      if (entry && Date.now() - entry.timestamp < ttl * 1000) {
        entry.hits++;
        this.stats.hits++;
        logger.info(
          `[Cache] HIT: ${tool} (age: ${Math.round((Date.now() - entry.timestamp) / 1000)}s, hits: ${entry.hits})`
        );
        return entry.data;
      }
    }

    // Cache miss - fetch data
    this.stats.misses++;
    logger.info(`[Cache] MISS: ${tool}`);

    const data = await fetchFn();

    // Store in cache (if TTL > 0)
    if (ttl > 0) {
      this.set(key, tool, data);
    }

    // Update rate limit
    this.updateRateLimit(tool);

    return data;
  }

  /**
   * Store data in cache
   */
  private set<T>(key: string, tool: string, data: T): void {
    // Evict old entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Check if tool is rate limited
   */
  private isRateLimited(tool: string): boolean {
    const limit = this.rateLimitConfig[tool];
    if (!limit) return false;

    const entry = this.rateLimit.get(tool);
    if (!entry) return false;

    const now = Date.now();
    if (now > entry.resetTime) {
      // Reset window
      this.rateLimit.delete(tool);
      return false;
    }

    return entry.count >= limit;
  }

  /**
   * Update rate limit counter
   */
  private updateRateLimit(tool: string): void {
    const limit = this.rateLimitConfig[tool];
    if (!limit) return;

    const now = Date.now();
    const entry = this.rateLimit.get(tool);

    if (!entry || now > entry.resetTime) {
      // Start new window (1 minute)
      this.rateLimit.set(tool, {
        count: 1,
        resetTime: now + 60000,
      });
    } else {
      entry.count++;
    }
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      logger.info(`[Cache] Evicted: ${oldestKey}`);
    }
  }

  /**
   * Invalidate cache for a specific key or pattern
   */
  invalidate(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`[Cache] Invalidated ${count} entries matching: ${pattern}`);
    }
    return count;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.rateLimit.clear();
    logger.info("[Cache] Cleared all entries");
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate =
      this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
        : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate.toFixed(1)}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * Generate cache key from tool and args
   */
  static generateKey(tool: string, args: any): string {
    const argsStr = JSON.stringify(args || {});
    return `${tool}:${argsStr}`;
  }
}
