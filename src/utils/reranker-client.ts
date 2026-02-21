/**
 * CEREBRO-Reranker Client
 *
 * Integrates with the CEREBRO hybrid reranking service to replace the
 * keyword-based scoreResults() in deep-research.ts with semantic scoring.
 *
 * CEREBRO uses CrossEncoder models (MiniLM-L6-v2 → Electra → DeBERTa)
 * selected adaptively based on query difficulty — giving 0.89–0.97
 * accuracy at 15–120 ms latency per batch.
 *
 * API (default: http://localhost:8016)
 *   POST /v1/rerank — JSON body { query, documents[], top_k, mode, use_cache }
 *   GET  /health    — liveness probe
 */

import { logger } from './logger.js';

export interface RerankItem {
  document: string;
  score: number;       // 0.0–1.0 semantic relevance
  model: string;       // 'fast' | 'accurate' | 'cloud'
  confidence: number;  // 0.0–1.0 confidence in the ranking
}

export interface RerankResponse {
  results: RerankItem[];
  mode_used: string;
  cache_hit: boolean;
  latency_ms: number;
}

export type RerankMode = 'auto' | 'fast' | 'accurate' | 'cloud';

export class CerebroRerankerClient {
  private readonly baseUrl: string;
  /** Per-request timeout (ms) — DeBERTa can take ~120 ms; allow headroom */
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string = process.env.CEREBRO_RERANKER_URL ?? 'http://localhost:8016',
    timeoutMs = 15_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Rerank a list of documents against a query using CEREBRO's hybrid
   * CrossEncoder pipeline.
   *
   * @param query     - The research query string
   * @param documents - Candidate document texts (title + content snippets)
   * @param topK      - How many results to return (≤ documents.length)
   * @param mode      - Model selection strategy (default: 'auto')
   * @returns Ranked list with semantic scores and per-model confidence
   *
   * Throws on network/timeout errors so callers can fall back to
   * keyword-based scoring.
   */
  async rerank(
    query: string,
    documents: string[],
    topK: number,
    mode: RerankMode = 'auto',
  ): Promise<RerankItem[]> {
    if (documents.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/v1/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        documents,
        top_k: Math.min(topK, documents.length),
        mode,
        use_cache: true,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`[Reranker] /v1/rerank returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as RerankResponse;

    logger.debug(
      {
        mode_used: data.mode_used,
        latency_ms: data.latency_ms,
        cache_hit: data.cache_hit,
        count: data.results.length,
      },
      '[Reranker] Rerank completed',
    );

    return data.results ?? [];
  }

  /** Quick liveness probe — returns true if the reranker is reachable */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Module-level singleton — shared across all DeepResearchEngine instances */
export const cerebroReranker = new CerebroRerankerClient();
