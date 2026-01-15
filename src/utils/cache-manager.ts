import { LRUCache } from 'lru-cache';
import { logger } from './logger.js';

export interface CacheOptions {
  max?: number;
  ttl?: number;  // milliseconds
  updateAgeOnGet?: boolean;
}

export class CacheManager<K extends {}, V extends {}> {
  private cache: LRUCache<K, V>;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.cache = new LRUCache({
      max: options.max || 500,
      ttl: options.ttl || 600000,  // 10 min default
      updateAgeOnGet: options.updateAgeOnGet ?? true,
    });
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.hits++;
      logger.debug({ key, hitRate: this.getHitRate() }, 'Cache hit');
    } else {
      this.misses++;
      logger.debug({ key, hitRate: this.getHitRate() }, 'Cache miss');
    }
    return value;
  }

  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.getHitRate(),
    };
  }

  private getHitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }
}
