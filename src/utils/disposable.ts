/**
 * Resource Cleanup Registry
 *
 * Centralizes cleanup of database connections, intervals, watchers, etc.
 * Instead of ad-hoc null-checking in shutdown handlers, resources register
 * themselves and get cleaned up in reverse order (LIFO).
 */

import { logger } from './logger.js';

type CleanupFn = () => void | Promise<void>;

interface RegisteredResource {
  name: string;
  cleanup: CleanupFn;
}

export class DisposableRegistry {
  private resources: RegisteredResource[] = [];
  private disposed = false;

  /**
   * Register a resource for cleanup.
   * Resources are cleaned up in reverse registration order (LIFO).
   */
  register(name: string, cleanup: CleanupFn): void {
    if (this.disposed) {
      logger.warn({ name }, 'Attempted to register resource after disposal');
      return;
    }
    this.resources.push({ name, cleanup });
  }

  /**
   * Dispose all registered resources in reverse order.
   * Safe to call multiple times - subsequent calls are no-ops.
   */
  async disposeAll(): Promise<{ succeeded: string[]; failed: Array<{ name: string; error: unknown }> }> {
    if (this.disposed) {
      return { succeeded: [], failed: [] };
    }

    this.disposed = true;
    const succeeded: string[] = [];
    const failed: Array<{ name: string; error: unknown }> = [];

    // LIFO order - last registered, first cleaned up
    for (let i = this.resources.length - 1; i >= 0; i--) {
      const { name, cleanup } = this.resources[i];
      try {
        await cleanup();
        succeeded.push(name);
        logger.debug({ name }, 'Resource disposed');
      } catch (error) {
        failed.push({ name, error });
        logger.error({ name, err: error }, 'Failed to dispose resource');
      }
    }

    this.resources = [];

    if (failed.length > 0) {
      logger.warn(
        { succeeded: succeeded.length, failed: failed.length },
        'Some resources failed to dispose'
      );
    } else {
      logger.info({ count: succeeded.length }, 'All resources disposed');
    }

    return { succeeded, failed };
  }

  /** Number of registered resources */
  get size(): number {
    return this.resources.length;
  }

  /** Whether disposeAll has been called */
  get isDisposed(): boolean {
    return this.disposed;
  }
}

/** Singleton instance for the application lifecycle */
export const globalRegistry = new DisposableRegistry();
