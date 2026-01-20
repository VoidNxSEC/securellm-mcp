# Performance Optimization Guide

This document describes the performance optimizations implemented in the MCP server and how to configure them.

## Overview

The server now includes comprehensive performance optimizations:

1. **Tool-level metrics** - Detailed latency tracking per tool (p50, p95, p99)
2. **Backpressure control** - Concurrency limiting and queue management
3. **Request deduplication** - Prevents duplicate in-flight requests
4. **Optimized semantic cache** - Faster lookups with candidate limiting and short-circuit
5. **Reduced overhead** - Optimized serialization and removed redundant operations

## Environment Variables

### Metrics Server

- `METRICS_PORT` - Port for Prometheus metrics endpoint (default: disabled)
- `METRICS_HOST` - Host to bind metrics server (default: `0.0.0.0` for K8s)

### Tool Execution Limiter

- `TOOL_LIMITER_GLOBAL_MAX_CONCURRENCY` - Maximum concurrent tool executions globally (default: `50`)
- `TOOL_LIMITER_DEFAULT_TIMEOUT` - Default timeout per tool in milliseconds (default: `30000`)
- `TOOL_LIMITER_MAX_QUEUE_SIZE` - Maximum queue size before rejecting requests (default: `100`)
- `TOOL_LIMITER_TIMEOUTS` - Per-tool timeouts in format `tool1:timeout1,tool2:timeout2` (e.g., `ssh_execute:60000,web_search:10000`)
- `TOOL_LIMITER_CONCURRENCY` - Per-tool concurrency limits in format `tool1:limit1,tool2:limit2` (e.g., `ssh_execute:5,web_search:10`)

### Request Deduplication

- `REQUEST_DEDUPE_STALE_TIMEOUT` - Timeout for stale in-flight requests in milliseconds (default: `60000`)
- `REQUEST_DEDUPE_CLEANUP_INTERVAL` - Cleanup interval in milliseconds (default: `30000`)

### Semantic Cache Optimization

- `SEMANTIC_CACHE_MAX_CANDIDATES` - Maximum candidates to check per lookup (default: `50`)
- `SEMANTIC_CACHE_HIGH_SIMILARITY_THRESHOLD` - Short-circuit threshold (default: `0.95`)

## Metrics Endpoints

### `/metrics` (Prometheus)

Exposes Prometheus-formatted metrics including:

- `securellm_mcp_tool_requests_total` - Total requests per tool
- `securellm_mcp_tool_latency_seconds` - Latency percentiles per tool (p50, p95, p99)
- `securellm_mcp_tool_cache_hits_total` - Cache hits per tool
- `securellm_mcp_tool_cache_misses_total` - Cache misses per tool
- `securellm_mcp_tool_queue_wait_seconds` - Queue wait time per tool

### `/health` (JSON)

Returns health status including limiter status:

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "limiter": {
    "globalSemaphore": 45,
    "globalMaxConcurrency": 50,
    "queueLength": 0,
    "maxQueueSize": 100,
    "activeRequests": 5,
    "toolStatus": {
      "ssh_execute": {
        "semaphore": 3,
        "maxConcurrency": 5
      }
    }
  }
}
```

## Performance Monitoring

### Key Metrics to Monitor

1. **Latency percentiles** - p95 and p99 should be within acceptable ranges
2. **Queue length** - Should stay below `maxQueueSize`
3. **Cache hit rate** - Higher is better (reduces API calls)
4. **Error rates** - Monitor `queue_full` and `timeout` errors

### Alerting Thresholds

Recommended alert thresholds:

- `securellm_mcp_tool_queue_wait_seconds{quantile="0.95"} > 5` - Queue wait time too high
- `securellm_mcp_tool_latency_seconds{quantile="0.99"} > 30` - Tool execution too slow
- `securellm_mcp_tool_requests_total{status="failed"} / securellm_mcp_tool_requests_total > 0.05` - Error rate > 5%

## Configuration Examples

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: securellm-mcp
spec:
  template:
    spec:
      containers:
      - name: mcp-server
        env:
        - name: METRICS_PORT
          value: "9090"
        - name: METRICS_HOST
          value: "0.0.0.0"
        - name: TOOL_LIMITER_GLOBAL_MAX_CONCURRENCY
          value: "100"
        - name: TOOL_LIMITER_DEFAULT_TIMEOUT
          value: "30000"
        - name: TOOL_LIMITER_TIMEOUTS
          value: "ssh_execute:60000,web_search:10000"
        - name: TOOL_LIMITER_CONCURRENCY
          value: "ssh_execute:5,web_search:20"
```

### ServiceMonitor for Prometheus

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: securellm-mcp
spec:
  selector:
    matchLabels:
      app: securellm-mcp
  endpoints:
  - port: metrics
    path: /metrics
    interval: 30s
```

## Performance Tuning Tips

1. **Adjust concurrency limits** - Start conservative and increase based on metrics
2. **Set tool-specific timeouts** - Longer-running tools (SSH) need longer timeouts
3. **Monitor cache hit rates** - If low, consider adjusting `SEMANTIC_CACHE_THRESHOLD`
4. **Watch queue length** - If consistently high, increase `TOOL_LIMITER_GLOBAL_MAX_CONCURRENCY`
5. **Use short-circuit threshold** - Higher values reduce lookup time but may miss matches

## Troubleshooting

### High Queue Wait Times

- Increase `TOOL_LIMITER_GLOBAL_MAX_CONCURRENCY`
- Check for slow tools blocking the queue
- Consider tool-specific concurrency limits

### High Latency (p99)

- Check for timeout errors
- Review tool execution times
- Consider increasing timeouts for specific tools

### Low Cache Hit Rate

- Lower `SEMANTIC_CACHE_THRESHOLD` (but may increase false positives)
- Check cache size (`SEMANTIC_CACHE_MAX_ENTRIES`)
- Review cache TTL (`SEMANTIC_CACHE_TTL`)

### Memory Issues

- Reduce `TOOL_LIMITER_MAX_QUEUE_SIZE`
- Lower `SEMANTIC_CACHE_MAX_ENTRIES`
- Check for memory leaks in tool handlers
