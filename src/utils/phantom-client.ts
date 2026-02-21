/**
 * PHANTOM Semantic Search Client
 *
 * Integrates with the PHANTOM document intelligence service for real
 * semantic similarity — replacing the char-frequency fallback that
 * produces ~0.998 cosine similarity for ANY two English texts.
 *
 * PHANTOM uses sentence-transformers (all-MiniLM-L6-v2, 384 dims)
 * backed by a FAISS index, giving accurate vector-space similarity.
 *
 * API (default: http://localhost:8008)
 *   POST /vectors/index  — multipart file upload to index a document
 *   POST /vectors/search — query params: ?query=...&top_k=N
 */

import { logger } from './logger.js';

export interface PhantomSearchResult {
  text: string;
  score: number;
  /** Entry ID extracted from the filename used at index time (cache_<id>.txt) */
  entryId: string | null;
}

export class PhantomClient {
  private readonly baseUrl: string;
  /** Per-request timeout (ms) — PHANTOM must respond within this window */
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string = process.env.PHANTOM_URL ?? 'http://localhost:8008',
    timeoutMs = 5_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Index a single query text into PHANTOM's FAISS vector store.
   * The filename `cache_<entryId>.txt` acts as the opaque key so we
   * can recover the cache entry ID from search results later.
   *
   * Failures are non-fatal — logged at WARN and silently swallowed
   * so the semantic cache continues to work with its SQLite fallback.
   */
  async indexQuery(entryId: string, queryText: string): Promise<void> {
    try {
      const formData = new FormData();
      const blob = new Blob([queryText], { type: 'text/plain; charset=utf-8' });
      formData.append('file', blob, `cache_${entryId}.txt`);

      const response = await fetch(`${this.baseUrl}/vectors/index`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        logger.warn(
          { entryId, status: response.status, statusText: response.statusText },
          '[PHANTOM] Failed to index cache entry',
        );
      } else {
        logger.debug({ entryId }, '[PHANTOM] Cache entry indexed');
      }
    } catch (error) {
      logger.warn({ err: error, entryId }, '[PHANTOM] indexQuery error (non-fatal)');
    }
  }

  /**
   * Search PHANTOM's FAISS index for queries semantically similar to
   * the given text.  Returns results with entryId parsed from filename.
   *
   * PHANTOM endpoint: POST /vectors/search?query=<text>&top_k=<N>
   *
   * Throws on network/timeout errors so callers can fall back to the
   * SQLite embedding approach.
   */
  async findSimilar(queryText: string, topK = 5): Promise<PhantomSearchResult[]> {
    const url = new URL(`${this.baseUrl}/vectors/search`);
    url.searchParams.set('query', queryText);
    url.searchParams.set('top_k', String(topK));

    const response = await fetch(url.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`[PHANTOM] /vectors/search returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as {
      query: string;
      results: Array<{ text: string; score: number; metadata: Record<string, unknown> }>;
      total_results: number;
    };

    return (data.results ?? []).map(r => {
      // Source filename format: cache_<uuid>.txt
      const source = String(r.metadata?.source ?? '');
      const match = /^cache_([a-f0-9-]+)\.txt$/i.exec(source);
      return {
        text: r.text,
        score: r.score,
        entryId: match ? match[1] : null,
      };
    });
  }

  /** Quick liveness probe — returns true if PHANTOM is reachable */
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
