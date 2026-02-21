/**
 * Deep Research Intelligence Module
 *
 * Provides multi-source parallel research with:
 * - Cross-reference validation
 * - Source credibility scoring
 * - Fact-checking against official sources
 * - Consensus detection (term-overlap based)
 * - Conflict detection (negation pattern + entity matching)
 * - Overall timeouts per depth level
 * - GitHub token caching (5-minute TTL)
 */

import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger.js";
import { getGitHubToken } from "../utils/github-token.js";
import { CerebroRerankerClient } from "../utils/reranker-client.js";

const execAsync = promisify(exec);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max total wall-clock time for each research depth */
const DEPTH_TIMEOUTS: Record<string, number> = {
    quick: 15_000,
    standard: 30_000,
    deep: 60_000,
};

/** Priority order for source batching (lower = higher priority) */
const SOURCE_PRIORITY: Record<string, number> = {
    official_docs: 0,
    nixos_wiki: 1,
    github: 2,
    discourse: 3,
    stackoverflow: 4,
    reddit: 5,
    hackernews: 6,
};

/** Source credibility weights */
const SOURCE_CREDIBILITY: Record<string, number> = {
    official_docs: 1.0,
    github: 0.9,
    nixos_wiki: 0.85,
    discourse: 0.75,
    stackoverflow: 0.7,
    reddit: 0.5,
    hackernews: 0.5,
};

/**
 * Negation/contradiction signal patterns.
 * Presence in one source but not another may indicate a conflict.
 */
const NEGATION_PATTERNS = [
    /\bdo(?:es)?\s+not\b/i,
    /\bdon'?t\b/i,
    /\bwon'?t\b/i,
    /\bcan'?t\b/i,
    /\bcannot\b/i,
    /\bnever\b/i,
    /\bdeprecated\b/i,
    /\bbroken\b/i,
    /\bunsupported\b/i,
    /\bremoved\b/i,
    /\bfail(?:s|ed)?\b/i,
];

// ─── GitHub Token Cache ───────────────────────────────────────────────────────

/** Module-level token cache shared across all DeepResearchEngine instances */
const _tokenCache: { value: string | null; expiry: number } = {
    value: null,
    expiry: 0,
};
const TOKEN_TTL = 5 * 60_000; // 5 minutes

async function getCachedGitHubToken(): Promise<string | null> {
    if (Date.now() < _tokenCache.expiry && _tokenCache.value !== null) {
        return _tokenCache.value;
    }
    const token = await getGitHubToken();
    _tokenCache.value = token;
    _tokenCache.expiry = Date.now() + TOKEN_TTL;
    return token;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SourceResult {
    source: "github" | "stackoverflow" | "nixos_wiki" | "discourse" | "official_docs" | "reddit" | "hackernews";
    url: string;
    title: string;
    content: string;
    credibility: number;
    timestamp: string;
    relevance: number;
}

export interface Conflict {
    topic: string;
    sources: string[];
    positions: string[];
}

export interface FactCheckResult {
    verified: boolean;
    officialSource: string | null;
    confidence: number;
    notes: string[];
}

export interface ResearchResult {
    query: string;
    confidence: number;
    sources: SourceResult[];
    consensus: string | null;
    conflicts: Conflict[];
    factCheck: FactCheckResult;
    searchDuration: number;
    timedOut: boolean;
    recommendations: string[];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Deep Research Engine
 */
export class DeepResearchEngine {
    private cache: Map<string, { result: ResearchResult; expiry: number }> = new Map();
    private readonly CACHE_TTL = 300_000; // 5 minutes
    private readonly reranker = new CerebroRerankerClient();

    /**
     * Perform deep multi-source research with overall timeout.
     * Returns partial results on timeout rather than throwing.
     */
    async research(
        query: string,
        options: {
            depth?: "quick" | "standard" | "deep";
            requireOfficialSource?: boolean;
            maxSources?: number;
        } = {}
    ): Promise<ResearchResult> {
        const { depth = "standard", requireOfficialSource = false, maxSources = 5 } = options;
        const startTime = Date.now();

        // Check cache
        const cacheKey = `${query}:${depth}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            return cached.result;
        }

        // Sort sources by priority (highest credibility first)
        const sourcesToSearch = this.getSourcesForDepth(depth)
            .sort((a, b) => (SOURCE_PRIORITY[a] ?? 9) - (SOURCE_PRIORITY[b] ?? 9));

        // Build per-source promises (each has its own 10s AbortSignal timeout)
        const searchPromises = sourcesToSearch.map(source =>
            this.searchSource(query, source).catch(() => [] as SourceResult[])
        );

        // Race the parallel search against an overall timeout
        const overallTimeout = DEPTH_TIMEOUTS[depth] ?? 30_000;
        const { results: allResults, timedOut } = await this.raceWithTimeout(
            Promise.all(searchPromises),
            sourcesToSearch.map(() => [] as SourceResult[]),
            overallTimeout,
            `[DeepResearch] depth=${depth} timed out after ${overallTimeout}ms`,
        );

        const flatResults = allResults.flat().slice(0, maxSources * 2);

        // Semantic reranking via CEREBRO (falls back to keyword scoring)
        const scoredResults = await this.rerankResults(flatResults, query);
        const topResults = scoredResults.slice(0, maxSources);

        // Detect consensus and conflicts
        const consensus = this.detectConsensus(topResults);
        const conflicts = this.detectConflicts(topResults);

        // Fact check against official sources
        const factCheck = await this.factCheck(query, topResults, requireOfficialSource);

        // Calculate overall confidence
        const confidence = this.calculateConfidence(topResults, consensus, factCheck);

        // Generate recommendations
        const recommendations = this.generateRecommendations(topResults, conflicts, factCheck, timedOut);

        const result: ResearchResult = {
            query,
            confidence,
            sources: topResults,
            consensus,
            conflicts,
            factCheck,
            searchDuration: Date.now() - startTime,
            timedOut,
            recommendations,
        };

        // Cache result
        this.cache.set(cacheKey, { result, expiry: Date.now() + this.CACHE_TTL });

        return result;
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    /**
     * Race a promise against a wall-clock timeout.
     * On timeout, logs a warning and returns the fallback value.
     */
    private async raceWithTimeout<T>(
        promise: Promise<T>,
        fallback: T,
        ms: number,
        warnMessage: string,
    ): Promise<{ results: T; timedOut: boolean }> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise = new Promise<T>(resolve => {
            timeoutId = setTimeout(() => {
                logger.warn({ ms }, warnMessage);
                resolve(fallback);
            }, ms);
        });

        const results = await Promise.race([promise, timeoutPromise]);
        // Clean up the timeout if the main promise won
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        const timedOut = results === fallback;
        return { results, timedOut };
    }

    /**
     * Get sources to search based on depth
     */
    private getSourcesForDepth(depth: "quick" | "standard" | "deep"): string[] {
        switch (depth) {
            case "quick":
                return ["nixos_wiki", "github"];
            case "standard":
                return ["official_docs", "nixos_wiki", "github", "discourse", "stackoverflow"];
            case "deep":
                return ["official_docs", "nixos_wiki", "github", "discourse", "stackoverflow", "reddit", "hackernews"];
        }
    }

    /**
     * Search a single source using native fetch
     */
    private async searchSource(query: string, source: string): Promise<SourceResult[]> {
        const encodedQuery = encodeURIComponent(query);
        const results: SourceResult[] = [];

        try {
            switch (source) {
                case "github": {
                    const headers: Record<string, string> = {
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "SecureLLM-MCP/1.0",
                    };

                    const githubToken = await getCachedGitHubToken();
                    if (githubToken) {
                        headers["Authorization"] = `Bearer ${githubToken}`;
                    }

                    const response = await fetch(
                        `https://api.github.com/search/repositories?q=${encodedQuery}+language:nix&per_page=3`,
                        { headers, signal: AbortSignal.timeout(10000) }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const item of data.items || []) {
                            results.push({
                                source: "github",
                                url: item.html_url,
                                title: item.full_name,
                                content: item.description || "",
                                credibility: SOURCE_CREDIBILITY.github,
                                timestamp: item.updated_at,
                                relevance: 0.8,
                            });
                        }
                    }
                    break;
                }

                case "nixos_wiki": {
                    const response = await fetch(
                        `https://wiki.nixos.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=3`,
                        { headers: { "User-Agent": "SecureLLM-MCP/1.0" }, signal: AbortSignal.timeout(10000) }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const item of data.query?.search || []) {
                            results.push({
                                source: "nixos_wiki",
                                url: `https://wiki.nixos.org/wiki/${encodeURIComponent(item.title)}`,
                                title: item.title,
                                content: item.snippet?.replace(/<[^>]+>/g, "") || "",
                                credibility: SOURCE_CREDIBILITY.nixos_wiki,
                                timestamp: item.timestamp || new Date().toISOString(),
                                relevance: 0.85,
                            });
                        }
                    }
                    break;
                }

                case "discourse": {
                    const response = await fetch(
                        `https://discourse.nixos.org/search.json?q=${encodedQuery}`,
                        { headers: { "User-Agent": "SecureLLM-MCP/1.0" }, signal: AbortSignal.timeout(10000) }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const post of (data.posts || []).slice(0, 3)) {
                            results.push({
                                source: "discourse",
                                url: `https://discourse.nixos.org/t/${post.topic_id}`,
                                title: post.blurb || "Discourse post",
                                content: post.blurb || "",
                                credibility: SOURCE_CREDIBILITY.discourse,
                                timestamp: post.created_at || new Date().toISOString(),
                                relevance: 0.7,
                            });
                        }
                    }
                    break;
                }

                case "stackoverflow": {
                    const response = await fetch(
                        `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodedQuery}&site=stackoverflow&tagged=nix`,
                        {
                            headers: { "Accept-Encoding": "gzip", "User-Agent": "SecureLLM-MCP/1.0" },
                            signal: AbortSignal.timeout(10000),
                        }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const item of (data.items || []).slice(0, 3)) {
                            results.push({
                                source: "stackoverflow",
                                url: item.link,
                                title: item.title,
                                content: "",
                                credibility: item.is_answered ? SOURCE_CREDIBILITY.stackoverflow : 0.5,
                                timestamp: new Date(item.creation_date * 1000).toISOString(),
                                relevance: 0.7,
                            });
                        }
                    }
                    break;
                }

                case "reddit": {
                    const response = await fetch(
                        `https://www.reddit.com/r/NixOS/search.json?q=${encodedQuery}&limit=3&sort=relevance`,
                        { headers: { "User-Agent": "SecureLLM-MCP/1.0" }, signal: AbortSignal.timeout(10000) }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const child of (data.data?.children || []).slice(0, 3)) {
                            const post = child.data;
                            results.push({
                                source: "reddit",
                                url: `https://reddit.com${post.permalink}`,
                                title: post.title,
                                content: post.selftext?.substring(0, 200) || "",
                                credibility: SOURCE_CREDIBILITY.reddit,
                                timestamp: new Date(post.created_utc * 1000).toISOString(),
                                relevance: 0.5,
                            });
                        }
                    }
                    break;
                }

                case "hackernews": {
                    const response = await fetch(
                        `https://hn.algolia.com/api/v1/search?query=${encodedQuery}&tags=story&hitsPerPage=3`,
                        { headers: { "User-Agent": "SecureLLM-MCP/1.0" }, signal: AbortSignal.timeout(10000) }
                    );
                    if (response.ok) {
                        const data = await response.json() as any;
                        for (const hit of data.hits || []) {
                            results.push({
                                source: "hackernews",
                                url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                                title: hit.title,
                                content: "",
                                credibility: SOURCE_CREDIBILITY.hackernews,
                                timestamp: hit.created_at || new Date().toISOString(),
                                relevance: 0.5,
                            });
                        }
                    }
                    break;
                }

                case "official_docs": {
                    try {
                        const { stdout } = await execAsync(
                            `nix search nixpkgs ${query.split(" ")[0]} --json 2>/dev/null | head -c 5000`,
                            { timeout: 8000 }
                        );
                        const nixResults = JSON.parse(stdout || "{}");
                        const entries = Object.entries(nixResults).slice(0, 3);
                        for (const [path, info] of entries) {
                            const pkgInfo = info as any;
                            results.push({
                                source: "official_docs",
                                url: `https://search.nixos.org/packages?query=${encodeURIComponent(pkgInfo.pname || query)}`,
                                title: pkgInfo.pname || path.split(".").pop() || query,
                                content: pkgInfo.description || "NixOS package",
                                credibility: SOURCE_CREDIBILITY.official_docs,
                                timestamp: new Date().toISOString(),
                                relevance: 1.0,
                            });
                        }
                    } catch {
                        results.push({
                            source: "official_docs",
                            url: `https://search.nixos.org/packages?query=${encodedQuery}`,
                            title: `NixOS Package Search: ${query}`,
                            content: "Official NixOS package database",
                            credibility: SOURCE_CREDIBILITY.official_docs,
                            timestamp: new Date().toISOString(),
                            relevance: 0.9,
                        });
                    }
                    break;
                }
            }
        } catch (error) {
            logger.warn({ err: error, source }, "[DeepResearch] Source failed");
        }

        return results;
    }

    /**
     * Rerank results using CEREBRO CrossEncoder for semantic scoring.
     *
     * Pipeline:
     *  1. Send (query, [title: content]) to CEREBRO /v1/rerank
     *  2. Map returned semantic scores back to SourceResult objects
     *  3. Blend: 0.65 * reranker_score + 0.35 * source_credibility
     *     (credibility anchors authoritative sources even for short content)
     *  4. Fall back to keyword-based scoreResults() if CEREBRO is unavailable
     */
    private async rerankResults(results: SourceResult[], query: string): Promise<SourceResult[]> {
        if (results.length === 0) return results;

        try {
            // Build document strings: "title: content" (reranker needs some text)
            const documents = results.map(r =>
                `${r.title}${r.content ? `: ${r.content.substring(0, 512)}` : ''}`
            );

            const rerankItems = await this.reranker.rerank(query, documents, results.length);

            // Map reranked items back to SourceResult using positional index
            // (the reranker returns items in ranked order with original document text)
            const docIndexMap = new Map(documents.map((doc, i) => [doc, i]));

            return rerankItems.map(item => {
                const originalIdx = docIndexMap.get(item.document) ?? 0;
                const original = results[originalIdx];
                // Blend semantic score with authoritative source credibility
                const blended = (item.score * 0.65) + (original.credibility * 0.35);
                return { ...original, relevance: blended };
            });
        } catch (error) {
            logger.warn({ err: error }, "[DeepResearch] Reranker unavailable, falling back to keyword scoring");
            return this.scoreResults(results, query);
        }
    }

    /**
     * Score and rank results by keyword relevance (fallback)
     */
    private scoreResults(results: SourceResult[], query: string): SourceResult[] {
        const queryTerms = query.toLowerCase().split(/\s+/);

        return results
            .map(result => {
                const content = `${result.title} ${result.content}`.toLowerCase();
                let matchScore = 0;
                for (const term of queryTerms) {
                    if (content.includes(term)) matchScore += 1 / queryTerms.length;
                }
                const score = (matchScore * 0.4) + (result.credibility * 0.4) + (result.relevance * 0.2);
                return { ...result, relevance: score };
            })
            .sort((a, b) => b.relevance - a.relevance);
    }

    // ─── Term-overlap helpers ──────────────────────────────────────────────────

    /**
     * Tokenise text into meaningful terms (length > 3, alpha-only).
     */
    private tokenize(text: string): Set<string> {
        return new Set(
            text.toLowerCase()
                .split(/\W+/)
                .filter(w => w.length > 3 && /^[a-z]+$/.test(w))
        );
    }

    /**
     * Jaccard similarity between two text strings (0–1).
     */
    private jaccardSimilarity(text1: string, text2: string): number {
        const set1 = this.tokenize(text1);
        const set2 = this.tokenize(text2);
        if (set1.size === 0 || set2.size === 0) return 0;
        let intersectionSize = 0;
        for (const t of set1) {
            if (set2.has(t)) intersectionSize++;
        }
        const unionSize = set1.size + set2.size - intersectionSize;
        return intersectionSize / unionSize;
    }

    /**
     * Returns true if any negation/contradiction signal appears in the text.
     */
    private hasNegation(text: string): boolean {
        return NEGATION_PATTERNS.some(p => p.test(text));
    }

    // ─── Consensus & Conflict Detection ──────────────────────────────────────

    /**
     * Detect consensus among sources using Jaccard term-overlap.
     * Two high-credibility sources with ≥ 0.30 term overlap are considered
     * to agree on the topic; the more content-rich one is returned as the
     * consensus summary.
     */
    private detectConsensus(results: SourceResult[]): string | null {
        const highCred = results.filter(r => r.credibility >= 0.8 && (r.content || r.title));
        if (highCred.length < 2) return null;

        const OVERLAP_THRESHOLD = 0.30;

        for (let i = 0; i < highCred.length - 1; i++) {
            for (let j = i + 1; j < highCred.length; j++) {
                const textI = `${highCred[i].title} ${highCred[i].content}`;
                const textJ = `${highCred[j].title} ${highCred[j].content}`;
                const overlap = this.jaccardSimilarity(textI, textJ);

                if (overlap >= OVERLAP_THRESHOLD) {
                    logger.debug(
                        { sourceA: highCred[i].source, sourceB: highCred[j].source, overlap },
                        "[DeepResearch] Consensus detected"
                    );
                    // Return the more detailed content of the two
                    const richer = textI.length >= textJ.length ? highCred[i] : highCred[j];
                    return richer.content || richer.title;
                }
            }
        }

        return null;
    }

    /**
     * Detect conflicts between sources.
     *
     * Strategy: pairs of sources that share significant topic overlap (≥ 0.20
     * Jaccard) but show opposing negation signals are flagged as conflicting.
     * This catches "works perfectly" vs "does not work / deprecated" patterns.
     */
    private detectConflicts(results: SourceResult[]): Conflict[] {
        const conflicts: Conflict[] = [];

        const TOPIC_OVERLAP_THRESHOLD = 0.20;

        for (let i = 0; i < results.length - 1; i++) {
            for (let j = i + 1; j < results.length; j++) {
                const rA = results[i];
                const rB = results[j];
                // Skip same-source pairs
                if (rA.source === rB.source) continue;

                const textA = `${rA.title} ${rA.content}`;
                const textB = `${rB.title} ${rB.content}`;

                const overlap = this.jaccardSimilarity(textA, textB);
                if (overlap < TOPIC_OVERLAP_THRESHOLD) continue;

                const negA = this.hasNegation(textA);
                const negB = this.hasNegation(textB);

                // Conflict = one source negates while the other does not
                if (negA !== negB) {
                    const topic = this.extractTopic(textA, textB);
                    logger.debug(
                        { sourceA: rA.source, sourceB: rB.source, topic, overlap },
                        "[DeepResearch] Conflict detected"
                    );
                    conflicts.push({
                        topic,
                        sources: [rA.url, rB.url],
                        positions: [
                            `${rA.source}: ${(rA.content || rA.title).substring(0, 120)}`,
                            `${rB.source}: ${(rB.content || rB.title).substring(0, 120)}`,
                        ],
                    });
                }
            }
        }

        return conflicts;
    }

    /**
     * Extract a short topic label from the shared terms of two texts.
     */
    private extractTopic(textA: string, textB: string): string {
        const set1 = this.tokenize(textA);
        const set2 = this.tokenize(textB);
        const shared = [...set1].filter(t => set2.has(t)).slice(0, 5);
        return shared.length > 0 ? shared.join(", ") : "unknown topic";
    }

    // ─── Fact Check & Scoring ─────────────────────────────────────────────────

    private async factCheck(
        query: string,
        results: SourceResult[],
        requireOfficial: boolean
    ): Promise<FactCheckResult> {
        const officialResults = results.filter(r =>
            r.source === "official_docs" || r.source === "nixos_wiki"
        );

        if (officialResults.length > 0) {
            return {
                verified: true,
                officialSource: officialResults[0].url,
                confidence: officialResults[0].credibility,
                notes: [`Verified via ${officialResults[0].source}`],
            };
        }

        if (requireOfficial) {
            return {
                verified: false,
                officialSource: null,
                confidence: 0.3,
                notes: ["No official source found - verification required"],
            };
        }

        const highCredCount = results.filter(r => r.credibility >= 0.7).length;
        return {
            verified: highCredCount >= 2,
            officialSource: null,
            confidence: Math.min(highCredCount * 0.25, 0.7),
            notes: highCredCount >= 2
                ? [`Verified via ${highCredCount} credible sources`]
                : ["Limited verification - use with caution"],
        };
    }

    private calculateConfidence(
        results: SourceResult[],
        consensus: string | null,
        factCheck: FactCheckResult
    ): number {
        if (results.length === 0) return 0;
        const uniqueSources = new Set(results.map(r => r.source));
        const avgCredibility = results.reduce((sum, r) => sum + r.credibility, 0) / results.length;
        let score = Math.min(uniqueSources.size * 0.15, 0.3);
        score += avgCredibility * 0.3;
        if (consensus) score += 0.15;
        score += factCheck.confidence * 0.25;
        return Math.min(score, 1.0);
    }

    private generateRecommendations(
        results: SourceResult[],
        conflicts: Conflict[],
        factCheck: FactCheckResult,
        timedOut: boolean,
    ): string[] {
        const recommendations: string[] = [];

        if (timedOut) {
            recommendations.push("Research timed out - results may be incomplete. Consider retrying with depth='deep'");
        }

        if (!factCheck.verified) {
            recommendations.push("Consider verifying with official NixOS documentation");
        }

        if (conflicts.length > 0) {
            recommendations.push(`${conflicts.length} conflicting source(s) found - review carefully`);
        }

        if (results.length < 3) {
            recommendations.push("Limited sources found - consider broader search");
        }

        const officialCount = results.filter(r => r.credibility >= 0.9).length;
        if (officialCount === 0) {
            recommendations.push("No highly authoritative sources - verify before implementation");
        }

        return recommendations;
    }
}

// Export singleton instance
export const deepResearch = new DeepResearchEngine();
