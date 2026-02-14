import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DisposableRegistry } from '../../src/utils/disposable.js';

describe('DisposableRegistry', () => {
  it('should dispose resources in LIFO order', async () => {
    const registry = new DisposableRegistry();
    const order: string[] = [];

    registry.register('first', () => { order.push('first'); });
    registry.register('second', () => { order.push('second'); });
    registry.register('third', () => { order.push('third'); });

    await registry.disposeAll();

    assert.deepEqual(order, ['third', 'second', 'first']);
  });

  it('should handle async cleanup functions', async () => {
    const registry = new DisposableRegistry();
    let cleaned = false;

    registry.register('async-resource', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      cleaned = true;
    });

    await registry.disposeAll();
    assert.ok(cleaned);
  });

  it('should report succeeded and failed disposals', async () => {
    const registry = new DisposableRegistry();

    registry.register('good', () => {});
    registry.register('bad', () => { throw new Error('cleanup failed'); });
    registry.register('also-good', () => {});

    const result = await registry.disposeAll();

    assert.equal(result.succeeded.length, 2);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, 'bad');
  });

  it('should be safe to call disposeAll multiple times', async () => {
    const registry = new DisposableRegistry();
    let count = 0;

    registry.register('once', () => { count++; });

    await registry.disposeAll();
    await registry.disposeAll();

    assert.equal(count, 1);
  });

  it('should reject registration after disposal', async () => {
    const registry = new DisposableRegistry();
    await registry.disposeAll();

    registry.register('late', () => {});

    assert.equal(registry.size, 0);
  });

  it('should track size correctly', () => {
    const registry = new DisposableRegistry();
    assert.equal(registry.size, 0);

    registry.register('a', () => {});
    registry.register('b', () => {});
    assert.equal(registry.size, 2);
  });

  it('should report isDisposed state', async () => {
    const registry = new DisposableRegistry();
    assert.equal(registry.isDisposed, false);

    await registry.disposeAll();
    assert.equal(registry.isDisposed, true);
  });
});
