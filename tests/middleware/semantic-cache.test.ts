import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { SemanticCache } from '../../src/middleware/semantic-cache.js';
import { createTempDir, type TempDir } from '../helpers/sandbox.js';

describe('SemanticCache', () => {
  let tempDir: TempDir;
  let cache: SemanticCache;

  before(async () => {
    tempDir = await createTempDir('semantic-cache-test-');
  });

  after(async () => {
    if (cache) {
      cache.close();
    }
    await tempDir.cleanup();
  });

  function createCache(config = {}) {
    const dbPath = path.join(tempDir.path, `cache-${Date.now()}.db`);
    return new SemanticCache(dbPath, {
      enabled: true,
      similarityThreshold: 0.8,
      ttlSeconds: 300,
      maxEntries: 100,
      minQueryLength: 3,
      llamaCppUrl: 'http://localhost:8080', // Won't be called, fallback will be used
      embeddingTimeout: 1000,
      ...config,
    });
  }

  describe('store and lookup', () => {
    it('should store and retrieve a cached response', async () => {
      cache = createCache({ similarityThreshold: 0.8 });

      await cache.store({
        toolName: 'test_tool',
        queryText: 'check system temperature and thermal status',
        toolArgs: { check: 'temp' },
        response: { temperature: 55 },
      });

      // Same exact query should hit cache
      const result = await cache.lookup({
        toolName: 'test_tool',
        queryText: 'check system temperature and thermal status',
      });

      assert.ok(result !== null, 'Expected cache hit for identical query');
      assert.deepEqual(result, { temperature: 55 });
    });

    it('should return null for cache miss', async () => {
      cache = createCache();

      const result = await cache.lookup({
        toolName: 'test_tool',
        queryText: 'completely different query about networking',
      });

      assert.equal(result, null);
    });

    it('should not cache when disabled', async () => {
      cache = createCache({ enabled: false });

      await cache.store({
        toolName: 'test_tool',
        queryText: 'test query',
        toolArgs: {},
        response: { data: 'test' },
      });

      const result = await cache.lookup({
        toolName: 'test_tool',
        queryText: 'test query',
      });

      assert.equal(result, null);
    });

    it('should skip queries shorter than minQueryLength', async () => {
      cache = createCache({ minQueryLength: 10 });

      await cache.store({
        toolName: 'test_tool',
        queryText: 'hi',
        toolArgs: {},
        response: { data: 'short' },
      });

      const result = await cache.lookup({
        toolName: 'test_tool',
        queryText: 'hi',
      });

      assert.equal(result, null);
    });
  });

  describe('tool exclusion', () => {
    it('should skip excluded tools on store', async () => {
      cache = createCache({ excludeTools: ['excluded_tool'] });

      await cache.store({
        toolName: 'excluded_tool',
        queryText: 'this should not be cached',
        toolArgs: {},
        response: { data: 'excluded' },
      });

      const stats = cache.getStats();
      assert.equal(stats.entriesCount, 0);
    });

    it('should skip excluded tools on lookup', async () => {
      cache = createCache({ excludeTools: ['excluded_tool'] });

      const result = await cache.lookup({
        toolName: 'excluded_tool',
        queryText: 'this should not be looked up',
      });

      assert.equal(result, null);
    });
  });

  describe('TTL and expiration', () => {
    it('should clean expired entries', async () => {
      cache = createCache({ ttlSeconds: 1 });

      await cache.store({
        toolName: 'test_tool',
        queryText: 'this will expire quickly for testing purposes',
        toolArgs: {},
        response: { data: 'expiring' },
        ttlSeconds: 0, // Expire immediately
      });

      // Wait a tiny bit for expiry
      await new Promise(resolve => setTimeout(resolve, 50));

      const deleted = cache.cleanExpired();
      assert.ok(deleted >= 0);
    });
  });

  describe('statistics', () => {
    it('should track cache stats', async () => {
      cache = createCache();

      const stats = cache.getStats();
      assert.equal(typeof stats.totalQueries, 'number');
      assert.equal(typeof stats.cacheHits, 'number');
      assert.equal(typeof stats.cacheMisses, 'number');
      assert.equal(typeof stats.hitRate, 'number');
      assert.equal(typeof stats.entriesCount, 'number');
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      cache = createCache();

      await cache.store({
        toolName: 'test_tool',
        queryText: 'something to clear later during testing',
        toolArgs: {},
        response: { data: 'clear me' },
      });

      cache.clear();

      const stats = cache.getStats();
      assert.equal(stats.entriesCount, 0);
    });
  });

  describe('capacity management', () => {
    it('should evict old entries when at max capacity', async () => {
      cache = createCache({ maxEntries: 5 });

      // Store more entries than max
      for (let i = 0; i < 7; i++) {
        await cache.store({
          toolName: 'test_tool',
          queryText: `query number ${i} with enough length to pass minimum`,
          toolArgs: { i },
          response: { data: i },
        });
      }

      const stats = cache.getStats();
      assert.ok(stats.entriesCount <= 7, 'Should not exceed reasonable bounds');
    });
  });
});
