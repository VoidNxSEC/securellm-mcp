/**
 * Tool-level metrics collector
 * 
 * Collects detailed metrics per tool including:
 * - Latency percentiles (p50, p95, p99)
 * - Cache hit/miss rates
 * - Queue wait times
 * - Error rates
 * - Request/response sizes
 */

import { MetricsCollector } from './metrics-collector.js';
import { logger } from '../utils/logger.js';

export interface ToolMetrics {
  toolName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cacheHits: number;
  cacheMisses: number;
  latencyPercentiles: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  averageLatency: number;
  averageQueueWaitTime: number;
  averageRequestSize: number;
  averageResponseSize: number;
  errorsByCategory: Record<string, number>;
  timeWindow: {
    startTime: number;
    durationMs: number;
  };
}

export interface ToolMetricsSnapshot {
  requestId: string;
  toolName: string;
  startTime: number;
  cacheLookupTime?: number;
  cacheHit?: boolean;
  preActionTime?: number;
  queueWaitTime?: number;
  executionTime?: number;
  serializationTime?: number;
  totalTime: number;
  requestSize?: number;
  responseSize?: number;
  error?: string;
  errorCategory?: string;
}

export class ToolMetricsCollector {
  private collectors: Map<string, MetricsCollector> = new Map();
  private cacheStats: Map<string, { hits: number; misses: number }> = new Map();
  private queueWaitTimes: Map<string, number[]> = new Map();
  private requestSizes: Map<string, number[]> = new Map();
  private responseSizes: Map<string, number[]> = new Map();
  private readonly maxSamples = 1000;

  /**
   * Record a tool execution snapshot
   */
  recordSnapshot(snapshot: ToolMetricsSnapshot): void {
    const { toolName } = snapshot;

    // Get or create collector for this tool
    if (!this.collectors.has(toolName)) {
      this.collectors.set(toolName, new MetricsCollector());
      this.cacheStats.set(toolName, { hits: 0, misses: 0 });
      this.queueWaitTimes.set(toolName, []);
      this.requestSizes.set(toolName, []);
      this.responseSizes.set(toolName, []);
    }

    const collector = this.collectors.get(toolName)!;
    const cacheStat = this.cacheStats.get(toolName)!;

    // Record cache stats
    if (snapshot.cacheHit !== undefined) {
      if (snapshot.cacheHit) {
        cacheStat.hits++;
      } else {
        cacheStat.misses++;
      }
    }

    // Record queue wait time
    if (snapshot.queueWaitTime !== undefined) {
      const queueTimes = this.queueWaitTimes.get(toolName)!;
      queueTimes.push(snapshot.queueWaitTime);
      if (queueTimes.length > this.maxSamples) {
        queueTimes.shift();
      }
    }

    // Record request/response sizes
    if (snapshot.requestSize !== undefined) {
      const sizes = this.requestSizes.get(toolName)!;
      sizes.push(snapshot.requestSize);
      if (sizes.length > this.maxSamples) {
        sizes.shift();
      }
    }

    if (snapshot.responseSize !== undefined) {
      const sizes = this.responseSizes.get(toolName)!;
      sizes.push(snapshot.responseSize);
      if (sizes.length > this.maxSamples) {
        sizes.shift();
      }
    }

    // Record success/failure
    const latency = snapshot.totalTime || 0;
    if (snapshot.error) {
      collector.recordFailure(latency, snapshot.errorCategory as any);
    } else {
      collector.recordSuccess(latency);
    }

    // Log structured metrics for observability
    logger.debug(
      {
        requestId: snapshot.requestId,
        toolName: snapshot.toolName,
        totalTime: snapshot.totalTime,
        cacheHit: snapshot.cacheHit,
        cacheLookupTime: snapshot.cacheLookupTime,
        queueWaitTime: snapshot.queueWaitTime,
        executionTime: snapshot.executionTime,
        error: snapshot.error,
      },
      'Tool execution metrics'
    );
  }

  /**
   * Get metrics for a specific tool
   */
  getToolMetrics(toolName: string): ToolMetrics | null {
    const collector = this.collectors.get(toolName);
    if (!collector) {
      return null;
    }

    const metrics = collector.getMetrics();
    const cacheStat = this.cacheStats.get(toolName)!;
    const queueTimes = this.queueWaitTimes.get(toolName)!;
    const reqSizes = this.requestSizes.get(toolName)!;
    const respSizes = this.responseSizes.get(toolName)!;

    // Calculate percentiles for queue wait times
    const sortedQueueTimes = [...queueTimes].sort((a, b) => a - b);
    const queueP50 = this.percentile(sortedQueueTimes, 50);
    const queueP95 = this.percentile(sortedQueueTimes, 95);
    const queueP99 = this.percentile(sortedQueueTimes, 99);

    // Calculate average sizes
    const avgRequestSize = reqSizes.length > 0
      ? reqSizes.reduce((a, b) => a + b, 0) / reqSizes.length
      : 0;
    const avgResponseSize = respSizes.length > 0
      ? respSizes.reduce((a, b) => a + b, 0) / respSizes.length
      : 0;

    return {
      toolName,
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      cacheHits: cacheStat.hits,
      cacheMisses: cacheStat.misses,
      latencyPercentiles: metrics.latencyPercentiles,
      averageLatency: metrics.averageLatency,
      averageQueueWaitTime: queueTimes.length > 0
        ? queueTimes.reduce((a, b) => a + b, 0) / queueTimes.length
        : 0,
      averageRequestSize: avgRequestSize,
      averageResponseSize: avgResponseSize,
      errorsByCategory: metrics.errorsByCategory,
      timeWindow: metrics.timeWindow,
    };
  }

  /**
   * Get metrics for all tools
   */
  getAllToolMetrics(): Map<string, ToolMetrics> {
    const allMetrics = new Map<string, ToolMetrics>();
    for (const toolName of this.collectors.keys()) {
      const metrics = this.getToolMetrics(toolName);
      if (metrics) {
        allMetrics.set(toolName, metrics);
      }
    }
    return allMetrics;
  }

  /**
   * Get Prometheus metrics format for all tools
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const prefix = 'securellm_mcp_tool';

    // Headers
    lines.push(`# HELP ${prefix}_requests_total Total number of tool requests`);
    lines.push(`# TYPE ${prefix}_requests_total counter`);
    lines.push(`# HELP ${prefix}_latency_seconds Tool execution latency in seconds`);
    lines.push(`# TYPE ${prefix}_latency_seconds histogram`);
    lines.push(`# HELP ${prefix}_cache_hits_total Total cache hits`);
    lines.push(`# TYPE ${prefix}_cache_hits_total counter`);
    lines.push(`# HELP ${prefix}_cache_misses_total Total cache misses`);
    lines.push(`# TYPE ${prefix}_cache_misses_total counter`);
    lines.push(`# HELP ${prefix}_queue_wait_seconds Queue wait time in seconds`);
    lines.push(`# TYPE ${prefix}_queue_wait_seconds histogram`);

    for (const [toolName, metrics] of this.getAllToolMetrics().entries()) {
      const toolLabel = `tool="${toolName}"`;

      // Request counts
      lines.push(`${prefix}_requests_total{${toolLabel},status="success"} ${metrics.successfulRequests}`);
      lines.push(`${prefix}_requests_total{${toolLabel},status="failed"} ${metrics.failedRequests}`);

      // Latency percentiles
      lines.push(`${prefix}_latency_seconds{${toolLabel},quantile="0.5"} ${(metrics.latencyPercentiles.p50 / 1000).toFixed(4)}`);
      lines.push(`${prefix}_latency_seconds{${toolLabel},quantile="0.95"} ${(metrics.latencyPercentiles.p95 / 1000).toFixed(4)}`);
      lines.push(`${prefix}_latency_seconds{${toolLabel},quantile="0.99"} ${(metrics.latencyPercentiles.p99 / 1000).toFixed(4)}`);

      // Cache stats
      lines.push(`${prefix}_cache_hits_total{${toolLabel}} ${metrics.cacheHits}`);
      lines.push(`${prefix}_cache_misses_total{${toolLabel}} ${metrics.cacheMisses}`);

      // Queue wait time (use p95 for both since we don't track percentiles separately)
      const queueP95 = metrics.averageQueueWaitTime > 0 ? metrics.averageQueueWaitTime : 0;
      lines.push(`${prefix}_queue_wait_seconds{${toolLabel},quantile="0.5"} ${(queueP95 / 1000).toFixed(4)}`);
      lines.push(`${prefix}_queue_wait_seconds{${toolLabel},quantile="0.95"} ${(queueP95 / 1000).toFixed(4)}`);

      // Request/response sizes
      lines.push(`${prefix}_request_size_bytes{${toolLabel}} ${metrics.averageRequestSize.toFixed(0)}`);
      lines.push(`${prefix}_response_size_bytes{${toolLabel}} ${metrics.averageResponseSize.toFixed(0)}`);
    }

    return lines.join('\n');
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Reset metrics for a specific tool
   */
  resetToolMetrics(toolName: string): void {
    this.collectors.delete(toolName);
    this.cacheStats.delete(toolName);
    this.queueWaitTimes.delete(toolName);
    this.requestSizes.delete(toolName);
    this.responseSizes.delete(toolName);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.collectors.clear();
    this.cacheStats.clear();
    this.queueWaitTimes.clear();
    this.requestSizes.clear();
    this.responseSizes.clear();
  }
}
