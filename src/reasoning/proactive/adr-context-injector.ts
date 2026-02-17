/**
 * ADR Context Injector (ADR-0036)
 *
 * Enriches agent workflow with relevant open ADR context.
 * Before file-modifying tool calls, searches proposed ADRs for
 * keyword matches and injects brief decision context.
 *
 * Uses an in-memory cache (5min TTL) to avoid repeated filesystem reads.
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { logger } from "../../utils/logger.js";

interface CachedADR {
  id: string;
  title: string;
  status: string;
  keywords: string[];
  summary: string;
  date: string;
  reviewDeadline?: string;
}

interface ADRCache {
  adrs: CachedADR[];
  loadedAt: number;
}

/** Tools that modify files or architecture — worth checking ADR context */
const CONTEXT_WORTHY_TOOLS = new Set([
  // File operations
  "write_file",
  "replace_in_file",
  "patch_file",
  // Build/infrastructure
  "build_and_test",
  "execute_in_sandbox",
  // Code quality
  "lint_code",
  "format_code",
  // ADR-related (for lifecycle awareness)
  "adr_new",
  "adr_accept",
]);

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_INJECTED_ADRS = 2;
const MIN_KEYWORD_OVERLAP = 1;

export class ADRContextInjector {
  private cache: ADRCache | null = null;

  constructor(private repoPath: string) {}

  /**
   * Enrich a tool call with relevant ADR context.
   * Returns a context string if relevant ADRs found, null otherwise.
   */
  async enrichWithADRContext(
    toolName: string,
    args: any
  ): Promise<string | null> {
    if (!CONTEXT_WORTHY_TOOLS.has(toolName)) {
      return null;
    }

    try {
      const adrs = await this.getProposedADRs();
      if (adrs.length === 0) return null;

      const inputKeywords = this.extractKeywords(toolName, args);
      if (inputKeywords.length === 0) return null;

      const relevant = this.findRelevant(adrs, inputKeywords);
      if (relevant.length === 0) return null;

      return this.formatContext(relevant);
    } catch (error) {
      logger.debug({ error }, "ADR context enrichment failed (non-blocking)");
      return null;
    }
  }

  /**
   * Get proposed ADRs from cache or filesystem
   */
  private async getProposedADRs(): Promise<CachedADR[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.adrs;
    }

    const proposedDir = join(this.repoPath, "adr", "proposed");
    if (!existsSync(proposedDir)) return [];

    const files = await readdir(proposedDir);
    const adrFiles = files.filter(
      (f) => f.startsWith("ADR-") && f.endsWith(".md")
    );

    const adrs: CachedADR[] = [];

    for (const file of adrFiles) {
      try {
        const content = await readFile(join(proposedDir, file), "utf-8");
        const parsed = this.parseADRForCache(content);
        if (parsed) adrs.push(parsed);
      } catch {
        // Skip unreadable files
      }
    }

    this.cache = { adrs, loadedAt: Date.now() };
    logger.debug("ADR cache loaded: %d proposed ADRs indexed", adrs.length);
    return adrs;
  }

  /**
   * Parse ADR content into lightweight cached representation
   */
  private parseADRForCache(content: string): CachedADR | null {
    const id = content.match(/^id:\s*"([^"]+)"/m)?.[1];
    const title = content.match(/^title:\s*"([^"]+)"/m)?.[1];
    const date = content.match(/^date:\s*"([^"]+)"/m)?.[1];
    const deadline = content.match(/review_deadline:\s*"([^"]+)"/m)?.[1];

    if (!id || !title) return null;

    // Extract keywords from multiple sources
    const keywordsBlock = content.match(
      /keywords:\s*\n((?:\s*-\s*"[^"]+"\s*\n?)*)/m
    );
    const parsedKeywords: string[] = [];

    if (keywordsBlock) {
      const matches = keywordsBlock[1].matchAll(/-\s*"([^"]+)"/g);
      for (const m of matches) {
        parsedKeywords.push(m[1].toLowerCase());
      }
    }

    // Also extract keywords from title
    const titleWords = title
      .toLowerCase()
      .split(/[\s\-_:,]+/)
      .filter((w) => w.length > 3);
    parsedKeywords.push(...titleWords);

    // Extract project names from scope
    const projects = content.match(
      /projects:\s*\n((?:\s*-\s*\w+\s*\n?)*)/m
    );
    if (projects) {
      const matches = projects[1].matchAll(/-\s*(\w+)/g);
      for (const m of matches) {
        parsedKeywords.push(m[1].toLowerCase());
      }
    }

    // Build a short summary from the first sentence of Context section
    const contextSection = content.match(
      /## Context\s*\n+([\s\S]*?)(?=\n## |\n---|\Z)/
    );
    let summary = "";
    if (contextSection) {
      const firstSentence = contextSection[1]
        .replace(/\n/g, " ")
        .trim()
        .split(/\.\s/)[0];
      summary =
        firstSentence.length > 120
          ? firstSentence.slice(0, 117) + "..."
          : firstSentence + ".";
    }

    return {
      id,
      title,
      status: "proposed",
      keywords: [...new Set(parsedKeywords)],
      summary,
      date: date || "",
      reviewDeadline: deadline,
    };
  }

  /**
   * Extract search keywords from tool arguments
   */
  private extractKeywords(toolName: string, args: any): string[] {
    const keywords: string[] = [];
    const argsStr = JSON.stringify(args || {}).toLowerCase();

    // Extract file paths — split into meaningful parts
    const pathMatches = argsStr.match(
      /[\w-]+\.(ts|js|py|nix|toml|rs|go|sol)/g
    );
    if (pathMatches) {
      for (const p of pathMatches) {
        keywords.push(...p.replace(/\.\w+$/, "").split(/[-_]/));
      }
    }

    // Extract directory names
    const dirMatches = argsStr.match(/(?:src|lib|core|commands|tools)\/[\w-]+/g);
    if (dirMatches) {
      for (const d of dirMatches) {
        keywords.push(...d.split("/"));
      }
    }

    // Extract significant words from string values (skip short/common words)
    const wordMatches = argsStr.match(/\b[a-z][a-z-]{3,}\b/g);
    if (wordMatches) {
      const stopWords = new Set([
        "true", "false", "null", "undefined", "function", "return",
        "const", "this", "that", "from", "import", "export", "with",
        "file", "path", "name", "type", "data", "string", "number",
      ]);
      keywords.push(...wordMatches.filter((w) => !stopWords.has(w)));
    }

    // Tool name itself
    keywords.push(...toolName.split("_"));

    return [...new Set(keywords)].slice(0, 30); // Cap at 30 keywords
  }

  /**
   * Find ADRs with keyword overlap above threshold
   */
  private findRelevant(
    adrs: CachedADR[],
    inputKeywords: string[]
  ): CachedADR[] {
    const scored = adrs.map((adr) => {
      const overlap = adr.keywords.filter((k) =>
        inputKeywords.some(
          (ik) => ik.includes(k) || k.includes(ik)
        )
      ).length;
      return { adr, overlap };
    });

    return scored
      .filter((s) => s.overlap >= MIN_KEYWORD_OVERLAP)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, MAX_INJECTED_ADRS)
      .map((s) => s.adr);
  }

  /**
   * Format relevant ADRs into a concise context string
   */
  private formatContext(adrs: CachedADR[]): string {
    const lines = ["[ADR Context] Relevant open decisions:"];

    for (const adr of adrs) {
      lines.push(`  ${adr.id}: ${adr.title}`);
      if (adr.summary) {
        lines.push(`    → ${adr.summary}`);
      }
      if (
        adr.reviewDeadline &&
        new Date(adr.reviewDeadline) < new Date()
      ) {
        lines.push(`    ⚠ Review deadline expired: ${adr.reviewDeadline}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Force cache invalidation (useful after ADR status changes)
   */
  invalidateCache(): void {
    this.cache = null;
  }
}
