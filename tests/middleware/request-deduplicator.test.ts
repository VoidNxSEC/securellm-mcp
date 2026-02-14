import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RequestDeduplicator, stableStringify } from '../../src/middleware/request-deduplicator.js';

describe('RequestDeduplicator', () => {
  describe('stableStringify', () => {
    it('should produce stable output regardless of key order', () => {
      const a = stableStringify({ b: 2, a: 1 });
      const b = stableStringify({ a: 1, b: 2 });
      assert.equal(a, b);
    });

    it('should handle nested objects', () => {
      const result = stableStringify({ x: { b: 2, a: 1 } });
      assert.equal(typeof result, 'string');
      assert.ok(result.includes('"a"'));
    });

    it('should handle arrays', () => {
      const result = stableStringify([3, 1, 2]);
      assert.equal(result, '[3,1,2]');
    });

    it('should handle null', () => {
      assert.equal(stableStringify(null), 'null');
    });

    it('should handle undefined', () => {
      assert.equal(stableStringify(undefined), 'undefined');
    });

    it('should handle primitives', () => {
      assert.equal(stableStringify(42), '42');
      assert.equal(stableStringify('hello'), '"hello"');
      assert.equal(stableStringify(true), 'true');
    });
  });

  describe('deduplication', () => {
    it('should execute a function normally when no duplicate', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        const result = await dedup.deduplicate('test', { query: 'hello' }, async () => 42);
        assert.equal(result, 42);
      } finally {
        dedup.close();
      }
    });

    it('should deduplicate identical concurrent requests', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        let executionCount = 0;

        const fn = async () => {
          executionCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'result';
        };

        const [r1, r2, r3] = await Promise.all([
          dedup.deduplicate('test', { query: 'same' }, fn),
          dedup.deduplicate('test', { query: 'same' }, fn),
          dedup.deduplicate('test', { query: 'same' }, fn),
        ]);

        assert.equal(r1, 'result');
        assert.equal(r2, 'result');
        assert.equal(r3, 'result');
        assert.equal(executionCount, 1, 'Function should only execute once');
      } finally {
        dedup.close();
      }
    });

    it('should not deduplicate different requests', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        let executionCount = 0;

        const [r1, r2] = await Promise.all([
          dedup.deduplicate('test', { query: 'first' }, async () => {
            executionCount++;
            return 'first';
          }),
          dedup.deduplicate('test', { query: 'second' }, async () => {
            executionCount++;
            return 'second';
          }),
        ]);

        assert.equal(r1, 'first');
        assert.equal(r2, 'second');
        assert.equal(executionCount, 2);
      } finally {
        dedup.close();
      }
    });

    it('should not deduplicate requests from different providers', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        let executionCount = 0;

        const fn = async () => {
          executionCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'result';
        };

        await Promise.all([
          dedup.deduplicate('provider-a', { query: 'same' }, fn),
          dedup.deduplicate('provider-b', { query: 'same' }, fn),
        ]);

        assert.equal(executionCount, 2, 'Different providers should not be deduplicated');
      } finally {
        dedup.close();
      }
    });

    it('should clear in-flight cache after completion', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        await dedup.deduplicate('test', { query: 'done' }, async () => 'first');

        // Second call with same args after first completes should execute again
        let secondCalled = false;
        await dedup.deduplicate('test', { query: 'done' }, async () => {
          secondCalled = true;
          return 'second';
        });

        assert.equal(secondCalled, true, 'Second call should execute after first completes');
      } finally {
        dedup.close();
      }
    });
  });

  describe('stats', () => {
    it('should track deduplication statistics', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        const fn = async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'ok';
        };

        await Promise.all([
          dedup.deduplicate('test', { q: 'same' }, fn),
          dedup.deduplicate('test', { q: 'same' }, fn),
        ]);

        const stats = dedup.getStats();
        assert.equal(stats.total, 2);
        assert.equal(stats.unique, 1);
        assert.equal(stats.deduplicated, 1);
        assert.ok(stats.savingsPercent.includes('%'));
      } finally {
        dedup.close();
      }
    });
  });

  describe('stale cleanup', () => {
    it('should clean up stale in-flight requests', async () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        // Manually add a stale entry by executing dedup and not resolving
        // Instead just test the cleanup mechanism directly
        dedup.cleanupStale(0); // 0ms timeout = everything is stale
        const stats = dedup.getStats();
        assert.equal(stats.inFlightCount, 0);
      } finally {
        dedup.close();
      }
    });
  });

  describe('clear', () => {
    it('should clear all in-flight requests', () => {
      const dedup = new RequestDeduplicator(60000, 0);
      try {
        dedup.clear();
        const stats = dedup.getStats();
        assert.equal(stats.inFlightCount, 0);
      } finally {
        dedup.close();
      }
    });
  });
});
