/**
 * Cerebro RAG Tools — Direct integration with the Cerebro RAG platform.
 *
 * 4 deferred tools for grounded knowledge retrieval, document ingestion,
 * engine status, and ad-hoc latency benchmarking.
 *
 * Cerebro endpoints used:
 *   POST /rag/query    — grounded generation with citations
 *   POST /rag/ingest   — batch document ingestion
 *   GET  /rag/status   — engine runtime state
 *   GET  /health       — liveness probe
 *   GET  /status       — system / hardware info
 */

import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

const CEREBRO_URL = process.env.CEREBRO_API_URL ?? "http://localhost:8009";

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const cerebroRagTools: ExtendedTool[] = [
  {
    name: "cerebro_rag_query",
    description:
      "Query Cerebro RAG for grounded answers with source citations. Uses semantic vector search (Jina Code v2 embeddings, 8192-token context) + cross-encoder reranking + LLM generation. Best for codebase questions, architecture exploration, and knowledge retrieval across indexed projects.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language or code question" },
        grounded: {
          type: "boolean",
          description: "Require source citations in the response (default: true)",
          default: true,
        },
        limit: {
          type: "number",
          description: "Max retrieved documents before generation (1-20, default: 5)",
          default: 5,
        },
        namespace: {
          type: "string",
          description: "Optional vector store namespace for tenant isolation",
        },
        min_score: {
          type: "number",
          description: "Minimum relevance score 0-1; queries below this are rejected (default: 0.25)",
          default: 0.25,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "cerebro_rag_ingest",
    description:
      "Index documents or code snippets into Cerebro's vector store for future RAG queries. Supports batch ingestion with metadata and idempotent upsert by document ID. Content is embedded via Jina Code v2 and stored with HNSW indexing.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          description: "Documents to ingest",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique document ID (idempotent upsert key)" },
              content: { type: "string", description: "Document text or code content" },
              metadata: {
                type: "object",
                description: "Arbitrary metadata (tags, source, project, language, etc.)",
                additionalProperties: true,
              },
            },
            required: ["id", "content"],
          },
        },
        namespace: {
          type: "string",
          description: "Target namespace in the vector store (optional)",
        },
      },
      required: ["documents"],
    },
  },
  {
    name: "cerebro_rag_status",
    description:
      "Get Cerebro RAG engine status: loaded embedding models, vector store backend (chroma/pgvector/azure), document count, GPU/CPU device info, and service health. Use before ingestion or to diagnose connectivity issues.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        include_hardware: {
          type: "boolean",
          description: "Include GPU/CPU hardware info via /status endpoint (default: true)",
          default: true,
        },
      },
    },
  },
  {
    name: "cerebro_rag_benchmark",
    description:
      "Run an ad-hoc latency benchmark against the live Cerebro RAG engine. Reports p50/p95/p99 query latency, throughput (queries/s), min/max/avg. Optionally benchmarks ingest throughput. Use to size GPU/CPU requirements before deployment.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        n_queries: {
          type: "number",
          description: "Number of benchmark queries (1-100, default: 20)",
          default: 20,
        },
        query_text: {
          type: "string",
          description: "Query template for the benchmark (default: generic code question)",
        },
        include_ingest: {
          type: "boolean",
          description: "Also benchmark document ingestion throughput with 10 test documents",
          default: false,
        },
      },
    },
  },
];

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function cerebroFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  return fetch(`${CEREBRO_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function handleCerebroRagQuery(args: {
  query: string;
  grounded?: boolean;
  limit?: number;
  namespace?: string;
  min_score?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { query, grounded = true, limit = 5, namespace, min_score = 0.25 } = args;

  try {
    const resp = await cerebroFetch(
      "/rag/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, grounded, limit, namespace, min_score }),
      },
      30_000
    );

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Cerebro RAG returned HTTP ${resp.status}`,
              detail: errBody,
              cerebro_url: CEREBRO_URL,
            }),
          },
        ],
      };
    }

    const data = await resp.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Cerebro RAG unavailable",
            detail: err.message,
            cerebro_url: CEREBRO_URL,
            hint: "Start with: docker-compose up -d cerebro (from securellm-mcp/)",
          }),
        },
      ],
    };
  }
}

export async function handleCerebroRagIngest(args: {
  documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>;
  namespace?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { documents, namespace } = args;

  if (!documents || documents.length === 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "No documents provided" }) }],
    };
  }

  try {
    const resp = await cerebroFetch(
      "/rag/ingest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents, namespace }),
      },
      60_000
    );

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Ingest returned HTTP ${resp.status}`,
              detail: errBody,
              cerebro_url: CEREBRO_URL,
            }),
          },
        ],
      };
    }

    const data = await resp.json();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { status: "ingested", documents_count: documents.length, ...data },
            null,
            2
          ),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Cerebro RAG ingest failed",
            detail: err.message,
            cerebro_url: CEREBRO_URL,
          }),
        },
      ],
    };
  }
}

export async function handleCerebroRagStatus(args: {
  include_hardware?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { include_hardware = true } = args;
  const results: Record<string, any> = { cerebro_url: CEREBRO_URL };

  // Liveness probe
  try {
    const healthResp = await cerebroFetch("/health", {}, 5_000);
    results.health = healthResp.ok ? "healthy" : `unhealthy (${healthResp.status})`;
  } catch (err: any) {
    results.health = "unreachable";
    results.detail = err.message;
    results.hint = "Start with: docker-compose up -d cerebro (from securellm-mcp/)";
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }

  // RAG engine status
  try {
    const statusResp = await cerebroFetch("/rag/status", {}, 10_000);
    if (statusResp.ok) {
      results.rag = await statusResp.json();
    }
  } catch {
    results.rag = "unavailable";
  }

  // System / hardware info
  if (include_hardware) {
    try {
      const sysResp = await cerebroFetch("/status", {}, 5_000);
      if (sysResp.ok) {
        results.system = await sysResp.json();
      }
    } catch {
      results.system = "unavailable";
    }
  }

  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
}

export async function handleCerebroRagBenchmark(args: {
  n_queries?: number;
  query_text?: string;
  include_ingest?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const {
    n_queries = 20,
    query_text = "How does the RAG engine handle embedding model fallback?",
    include_ingest = false,
  } = args;

  const n = Math.min(Math.max(1, n_queries), 100);
  const latencies: number[] = [];

  // Warm-up: prime model loading
  try {
    await cerebroFetch(
      "/rag/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query_text, grounded: false, limit: 3 }),
      },
      45_000
    );
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Cerebro not reachable — cannot run benchmark",
            detail: err.message,
            cerebro_url: CEREBRO_URL,
          }),
        },
      ],
    };
  }

  // Benchmark loop
  const startTotal = Date.now();
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      await cerebroFetch(
        "/rag/query",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `${query_text} (run ${i})`,
            grounded: false,
            limit: 3,
          }),
        },
        30_000
      );
    } catch {
      latencies.push(30_000); // Count timeouts as 30s
      continue;
    }
    latencies.push(Date.now() - t0);
  }
  const totalMs = Date.now() - startTotal;

  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];

  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    cerebro_url: CEREBRO_URL,
    query_benchmark: {
      n_queries: n,
      p50_ms: pct(0.5),
      p95_ms: pct(0.95),
      p99_ms: pct(0.99),
      min_ms: sorted[0],
      max_ms: sorted[sorted.length - 1],
      avg_ms: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      throughput_qps: parseFloat((n / (totalMs / 1000)).toFixed(2)),
      total_s: parseFloat((totalMs / 1000).toFixed(1)),
    },
  };

  if (include_ingest) {
    const testDocs = Array.from({ length: 10 }, (_, i) => ({
      id: `bench_ingest_${i}`,
      content: `Benchmark document ${i}: ${query_text}`,
      metadata: { source: "mcp_benchmark", index: i },
    }));

    const t0 = Date.now();
    try {
      const resp = await cerebroFetch(
        "/rag/ingest",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents: testDocs }),
        },
        60_000
      );
      const ingestMs = Date.now() - t0;
      result.ingest_benchmark = {
        docs_ingested: testDocs.length,
        total_ms: ingestMs,
        docs_per_second: parseFloat((testDocs.length / (ingestMs / 1000)).toFixed(2)),
        status: resp.ok ? "success" : `failed (${resp.status})`,
      };
    } catch (err: any) {
      result.ingest_benchmark = { error: err.message };
    }
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
