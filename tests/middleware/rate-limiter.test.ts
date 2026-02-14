import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SmartRateLimiter } from '../../src/middleware/rate-limiter.js';
import type { RateLimitConfig } from '../../src/types/middleware/rate-limiter.js';

function createTestConfig(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return {
    provider: 'test',
    requestsPerMinute: 60,
    burstSize: 10,
    maxRetries: 2,
    retryStrategy: 'exponential' as const,
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 10000,
    },
    ...overrides,
  };
}

function createLimiter(providers: string[] = ['test-provider'], config?: Partial<RateLimitConfig>): SmartRateLimiter {
  const configs = new Map<string, RateLimitConfig>();
  for (const p of providers) {
    configs.set(p, createTestConfig(config));
  }
  return new SmartRateLimiter(configs);
}

describe('SmartRateLimiter', () => {
  describe('basic execution', () => {
    it('should execute a function successfully', async () => {
      const limiter = createLimiter();
      const result = await limiter.execute('test-provider', async () => 42);
      assert.equal(result, 42);
    });

    it('should pass through the return value', async () => {
      const limiter = createLimiter();
      const result = await limiter.execute('test-provider', async () => ({ data: 'hello' }));
      assert.deepEqual(result, { data: 'hello' });
    });

    it('should throw for unknown provider', async () => {
      const limiter = createLimiter();
      await assert.rejects(
        () => limiter.execute('unknown', async () => 42),
        /No rate limit configuration found/
      );
    });
  });

  describe('FIFO queue ordering', () => {
    it('should process requests in order', async () => {
      const limiter = createLimiter(['test'], { requestsPerMinute: 600 });
      const order: number[] = [];

      const promises = Array.from({ length: 5 }, (_, i) =>
        limiter.execute('test', async () => {
          order.push(i);
          return i;
        })
      );

      const results = await Promise.all(promises);
      assert.deepEqual(results, [0, 1, 2, 3, 4]);
    });
  });

  describe('per-provider isolation', () => {
    it('should maintain separate queues per provider', async () => {
      const limiter = createLimiter(['provider-a', 'provider-b']);

      const results = await Promise.all([
        limiter.execute('provider-a', async () => 'a'),
        limiter.execute('provider-b', async () => 'b'),
      ]);

      assert.deepEqual(results, ['a', 'b']);
    });
  });

  describe('error handling and retries', () => {
    it('should retry on transient errors', async () => {
      const limiter = createLimiter(['test'], { maxRetries: 2 });
      let attempts = 0;

      const result = await limiter.execute('test', async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Transient network error');
        }
        return 'success';
      });

      assert.equal(result, 'success');
      assert.equal(attempts, 2);
    });

    it('should fail after all retries exhausted', async () => {
      const limiter = createLimiter(['test'], { maxRetries: 1 });

      await assert.rejects(
        () => limiter.execute('test', async () => {
          throw new Error('Persistent failure');
        }),
        /Persistent failure/
      );
    });
  });

  describe('metrics', () => {
    it('should track successful requests', async () => {
      const limiter = createLimiter();
      await limiter.execute('test-provider', async () => 'ok');

      const metrics = limiter.getMetrics('test-provider');
      assert.ok(metrics);
      assert.equal(metrics.successfulRequests, 1);
    });

    it('should return undefined metrics for unknown provider', () => {
      const limiter = createLimiter();
      const metrics = limiter.getMetrics('nonexistent');
      assert.equal(metrics, undefined);
    });

    it('should get all metrics', async () => {
      const limiter = createLimiter(['a', 'b']);
      await limiter.execute('a', async () => 'ok');
      await limiter.execute('b', async () => 'ok');

      const all = limiter.getAllMetrics();
      assert.equal(all.size, 2);
      assert.ok(all.has('a'));
      assert.ok(all.has('b'));
    });
  });

  describe('queue status', () => {
    it('should report queue status', () => {
      const limiter = createLimiter();
      const status = limiter.getQueueStatus('test-provider');
      assert.ok(status);
      assert.equal(status.queueLength, 0);
      assert.equal(status.processing, false);
    });

    it('should return undefined for unknown provider', () => {
      const limiter = createLimiter();
      const status = limiter.getQueueStatus('nonexistent');
      assert.equal(status, undefined);
    });
  });

  describe('Prometheus metrics', () => {
    it('should generate valid Prometheus format', async () => {
      const limiter = createLimiter(['test']);
      await limiter.execute('test', async () => 'ok');

      const prom = limiter.getAggregatePrometheusMetrics();
      assert.ok(prom.includes('securellm_mcp_requests_total'));
      assert.ok(prom.includes('provider="test"'));
      assert.ok(prom.includes('status="success"'));
    });
  });
});
