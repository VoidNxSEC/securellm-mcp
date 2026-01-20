/**
 * Tool Execution Limiter
 * 
 * Controls concurrency and backpressure for tool execution:
 * - Global concurrency limit
 * - Per-tool concurrency limits
 * - Queue management with fail-fast on overload
 * - Timeout handling per tool
 */

import { logger } from '../utils/logger.js';

export interface ToolLimiterConfig {
  globalMaxConcurrency?: number;
  defaultToolTimeout?: number;
  maxQueueSize?: number;
  toolTimeouts?: Record<string, number>;
  toolConcurrency?: Record<string, number>;
}

interface QueuedRequest {
  toolName: string;
  resolve: (permit: Permit) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

interface Permit {
  release: () => void;
  abortController: AbortController;
}

export class ToolExecutionLimiter {
  private globalSemaphore: number;
  private toolSemaphores: Map<string, number> = new Map();
  private queue: QueuedRequest[] = [];
  private activeRequests: Map<string, Permit> = new Map();
  private readonly globalMaxConcurrency: number;
  private readonly defaultToolTimeout: number;
  private readonly maxQueueSize: number;
  private readonly toolTimeouts: Record<string, number>;
  private readonly toolConcurrency: Record<string, number>;

  constructor(config: ToolLimiterConfig = {}) {
    this.globalMaxConcurrency = config.globalMaxConcurrency 
      ?? parseInt(process.env.TOOL_LIMITER_GLOBAL_MAX_CONCURRENCY || '50', 10);
    this.defaultToolTimeout = config.defaultToolTimeout 
      ?? parseInt(process.env.TOOL_LIMITER_DEFAULT_TIMEOUT || '30000', 10);
    this.maxQueueSize = config.maxQueueSize 
      ?? parseInt(process.env.TOOL_LIMITER_MAX_QUEUE_SIZE || '100', 10);
    this.toolTimeouts = config.toolTimeouts || {};
    this.toolConcurrency = config.toolConcurrency || {};

    this.globalSemaphore = this.globalMaxConcurrency;

    // Initialize tool-specific semaphores
    for (const [toolName, maxConcurrency] of Object.entries(this.toolConcurrency)) {
      this.toolSemaphores.set(toolName, maxConcurrency);
    }

    logger.info(
      {
        globalMaxConcurrency: this.globalMaxConcurrency,
        defaultToolTimeout: this.defaultToolTimeout,
        maxQueueSize: this.maxQueueSize,
        toolConcurrency: this.toolConcurrency,
        toolTimeouts: this.toolTimeouts,
      },
      'ToolExecutionLimiter initialized'
    );
  }

  /**
   * Acquire a permit to execute a tool
   * Returns a permit that must be released when done
   */
  async acquire(toolName: string, requestId?: string): Promise<Permit> {
    return new Promise((resolve, reject) => {
      // Check queue size
      if (this.queue.length >= this.maxQueueSize) {
        const error = new Error(
          `Tool execution queue full (${this.maxQueueSize}). Tool: ${toolName}`
        );
        logger.warn(
          {
            toolName,
            requestId,
            queueLength: this.queue.length,
            maxQueueSize: this.maxQueueSize,
          },
          'Tool execution queue full, rejecting request'
        );
        reject(error);
        return;
      }

      // Check if we can execute immediately
      if (this.canExecute(toolName)) {
        const permit = this.createPermit(toolName, requestId);
        resolve(permit);
        this.processQueue();
        return;
      }

      // Queue the request
      const queuedRequest: QueuedRequest = {
        toolName,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.queue.push(queuedRequest);

      // Set timeout for queued request
      const timeout = this.getToolTimeout(toolName);
      setTimeout(() => {
        const index = this.queue.indexOf(queuedRequest);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error(`Tool execution timeout while queued: ${toolName} (${timeout}ms)`));
        }
      }, timeout);

      logger.debug(
        {
          toolName,
          requestId,
          queueLength: this.queue.length,
          position: this.queue.length,
        },
        'Tool execution queued'
      );
    });
  }

  /**
   * Check if a tool can execute immediately
   */
  private canExecute(toolName: string): boolean {
    // Check global semaphore
    if (this.globalSemaphore <= 0) {
      return false;
    }

    // Check tool-specific semaphore
    const toolMaxConcurrency = this.toolConcurrency[toolName];
    if (toolMaxConcurrency !== undefined) {
      const toolSemaphore = this.toolSemaphores.get(toolName) ?? toolMaxConcurrency;
      if (toolSemaphore <= 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create a permit for tool execution
   */
  private createPermit(toolName: string, requestId?: string): Permit {
    // Acquire global semaphore
    this.globalSemaphore--;

    // Acquire tool-specific semaphore if configured
    const toolMaxConcurrency = this.toolConcurrency[toolName];
    if (toolMaxConcurrency !== undefined) {
      const current = this.toolSemaphores.get(toolName) ?? toolMaxConcurrency;
      this.toolSemaphores.set(toolName, current - 1);
    }

    const abortController = new AbortController();
    const permitId = `${toolName}-${Date.now()}-${Math.random()}`;

    const permit: Permit = {
      release: () => {
        this.releasePermit(toolName, permitId);
      },
      abortController,
    };

    this.activeRequests.set(permitId, permit);

    // Set timeout for the permit
    const timeout = this.getToolTimeout(toolName);
    setTimeout(() => {
      if (this.activeRequests.has(permitId)) {
        abortController.abort();
        logger.warn(
          {
            toolName,
            requestId,
            timeout,
          },
          'Tool execution timeout, aborting'
        );
        // Release permit on timeout
        permit.release();
      }
    }, timeout);

    return permit;
  }

  /**
   * Release a permit
   */
  private releasePermit(toolName: string, permitId: string): void {
    const permit = this.activeRequests.get(permitId);
    if (!permit) {
      return;
    }

    this.activeRequests.delete(permitId);

    // Release global semaphore
    this.globalSemaphore++;

    // Release tool-specific semaphore if configured
    const toolMaxConcurrency = this.toolConcurrency[toolName];
    if (toolMaxConcurrency !== undefined) {
      const current = this.toolSemaphores.get(toolName) ?? 0;
      this.toolSemaphores.set(toolName, Math.min(current + 1, toolMaxConcurrency));
    }

    // Process queue
    this.processQueue();
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    while (this.queue.length > 0) {
      const request = this.queue[0];
      if (this.canExecute(request.toolName)) {
        this.queue.shift();
        const permit = this.createPermit(request.toolName);
        request.resolve(permit);
      } else {
        break;
      }
    }
  }

  /**
   * Get timeout for a specific tool
   */
  private getToolTimeout(toolName: string): number {
    return this.toolTimeouts[toolName] ?? this.defaultToolTimeout;
  }

  /**
   * Get current status
   */
  getStatus(): {
    globalSemaphore: number;
    globalMaxConcurrency: number;
    queueLength: number;
    maxQueueSize: number;
    activeRequests: number;
    toolStatus: Record<string, {
      semaphore: number;
      maxConcurrency?: number;
    }>;
  } {
    const toolStatus: Record<string, { semaphore: number; maxConcurrency?: number }> = {};
    for (const [toolName, maxConcurrency] of Object.entries(this.toolConcurrency)) {
      toolStatus[toolName] = {
        semaphore: this.toolSemaphores.get(toolName) ?? maxConcurrency,
        maxConcurrency,
      };
    }

    return {
      globalSemaphore: this.globalSemaphore,
      globalMaxConcurrency: this.globalMaxConcurrency,
      queueLength: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      activeRequests: this.activeRequests.size,
      toolStatus,
    };
  }

  /**
   * Reset limiter (for testing)
   */
  reset(): void {
    this.globalSemaphore = this.globalMaxConcurrency;
    this.queue = [];
    this.activeRequests.clear();
    for (const [toolName, maxConcurrency] of Object.entries(this.toolConcurrency)) {
      this.toolSemaphores.set(toolName, maxConcurrency);
    }
  }
}
