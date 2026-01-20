import crypto from 'crypto';
import { logger } from '../utils/logger.js';
export function stableStringify(value) {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((v) => stableStringify(v)).join(',')}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(',')}}`;
}
export class RequestDeduplicator {
    staleTimeoutMs;
    inFlight = new Map();
    stats = {
        total: 0,
        deduplicated: 0,
        unique: 0,
    };
    cleanupInterval = null;
    constructor(staleTimeoutMs = 60_000, cleanupEveryMs = 30_000) {
        this.staleTimeoutMs = staleTimeoutMs;
        if (cleanupEveryMs > 0) {
            this.cleanupInterval = setInterval(() => {
                try {
                    this.cleanupStale(this.staleTimeoutMs);
                }
                catch (error) {
                    logger.error({ err: error }, 'Request deduplicator stale cleanup failed');
                }
            }, cleanupEveryMs);
            this.cleanupInterval.unref();
        }
    }
    /**
     * Generate hash key from request parameters
     */
    generateKey(provider, requestData) {
        const content = stableStringify({
            provider,
            data: requestData,
        });
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    /**
     * Execute request with deduplication
     * Returns existing promise if identical request is in-flight
     */
    async deduplicate(provider, requestData, fn) {
        this.stats.total++;
        // Generate unique key for this request
        const key = this.generateKey(provider, requestData);
        // Check if identical request is already in-flight
        const existing = this.inFlight.get(key);
        if (existing) {
            this.stats.deduplicated++;
            logger.debug({
                provider,
                deduplicated: this.stats.deduplicated,
                total: this.stats.total,
                inFlightCount: this.inFlight.size,
            }, 'Request deduplicated (in-flight cache hit)');
            return existing.promise;
        }
        // Execute new request
        this.stats.unique++;
        const promise = fn().finally(() => {
            // Clear cache when request completes
            this.inFlight.delete(key);
        });
        // Cache the promise
        this.inFlight.set(key, {
            promise,
            timestamp: Date.now(),
            provider,
        });
        return promise;
    }
    /**
     * Get deduplication statistics
     */
    getStats() {
        const savingsPercent = this.stats.total > 0
            ? ((this.stats.deduplicated / this.stats.total) * 100).toFixed(1)
            : '0.0';
        return {
            ...this.stats,
            savingsPercent: `${savingsPercent}%`,
            inFlightCount: this.inFlight.size,
        };
    }
    /**
     * Clear all in-flight requests (for cleanup/reset)
     */
    clear() {
        this.inFlight.clear();
    }
    close() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    /**
     * Clean up stale in-flight requests (older than timeout)
     */
    cleanupStale(timeoutMs = 60000) {
        const now = Date.now();
        const stale = [];
        for (const [key, request] of this.inFlight.entries()) {
            if (now - request.timestamp > timeoutMs) {
                stale.push(key);
            }
        }
        stale.forEach(key => this.inFlight.delete(key));
        if (stale.length > 0) {
            logger.info({
                staleCount: stale.length,
                timeoutMs,
                inFlightCount: this.inFlight.size,
            }, 'Cleaned up stale in-flight requests');
        }
    }
}
//# sourceMappingURL=request-deduplicator.js.map