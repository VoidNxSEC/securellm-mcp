/**
 * Web Search Tools for MCP Server
 *
 * Enhanced version with:
 * - Spider-Nix integration for real web crawling
 * - Intelligent formatted outputs
 * - Actionable summaries
 * - Source credibility indicators
 * - OSINT capabilities
 */

import type { ExtendedTool } from "../types/mcp-tool-extensions.js";
import { PackageSearch } from "./nix/package-search.js";
import { logger } from "../utils/logger.js";
import { getGitHubToken } from "../utils/github-token.js";
import {
  webSearch as spiderWebSearch,
  crawlWebsite,
  osintDns,
  osintSubdomains,
  osintPortScan,
} from "./spider-nix-wrapper.js";

const packageSearch = new PackageSearch();

export function getNixCacheStats() {
  return packageSearch.getCacheStats();
}

export interface WebSearchArgs {
  query: string;
  search_type?: "general" | "nixos" | "github" | "stackoverflow" | "reddit";
  limit?: number;
}

export interface NixSearchArgs {
  package_name?: string;
  query?: string;
  channel?: "stable" | "unstable";
  type?: "packages" | "options";
}

export interface GithubSearchArgs {
  query: string;
  type?: "repositories" | "issues" | "code";
  language?: string;
  sort?: "stars" | "updated" | "relevance";
}

export interface TechNewsArgs {
  topic: string;
  source?: "hackernews" | "reddit" | "lobsters" | "all";
  time_range?: "day" | "week" | "month";
}

const USER_AGENT = "SecureLLM-MCP/2.0 (NixOS Research Agent)";

/**
 * Format results for intelligent consumption
 */
function formatIntelligentOutput(data: {
  query: string;
  source: string;
  results: any[];
  summary?: string;
}) {
  const { query, source, results, summary } = data;

  // Generate actionable summary
  const actionSummary = results.length > 0
    ? `Found ${results.length} results. ${summary || ""}`
    : `No results found for "${query}".`;

  // Format each result with relevance indicator  
  const formattedResults = results.map((r, i) => ({
    rank: i + 1,
    ...r,
    relevance: i < 3 ? "high" : i < 6 ? "medium" : "low",
  }));

  return {
    success: true,
    query,
    source,
    summary: actionSummary,
    result_count: results.length,
    results: formattedResults,
    // Quick reference for LLM
    quick_answer: results[0]?.title || results[0]?.description || null,
    top_urls: results.slice(0, 3).map(r => r.url).filter(Boolean),
  };
}

/**
 * Web search tool schemas for MCP
 */
export const webSearchTools: ExtendedTool[] = [
  {
    name: "web_search",
    description: "Search the web for configurations, news, features, issues, and bug reports. Uses DuckDuckGo for privacy-focused searches.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        search_type: {
          type: "string",
          enum: ["general", "nixos", "github", "stackoverflow", "reddit"],
          description: "Type of search to perform (default: general)",
          default: "general",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "nix_search",
    description: "Search NixOS packages and options on search.nixos.org. Find package configurations, versions, and documentation.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        package_name: {
          type: "string",
          description: "Specific package name to search for",
        },
        query: {
          type: "string",
          description: "General search query",
        },
        channel: {
          type: "string",
          enum: ["stable", "unstable"],
          description: "NixOS channel to search (default: unstable)",
          default: "unstable",
        },
        type: {
          type: "string",
          enum: ["packages", "options"],
          description: "Search type (default: packages)",
          default: "packages",
        },
      },
    },
  },
  {
    name: "github_search",
    description: "Search GitHub for repositories, issues, and code. Find NixOS configurations, bug reports, and implementation examples.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "GitHub search query",
        },
        type: {
          type: "string",
          enum: ["repositories", "issues", "code"],
          description: "Type of GitHub content to search (default: repositories)",
          default: "repositories",
        },
        language: {
          type: "string",
          description: "Filter by programming language (e.g., 'nix', 'python')",
        },
        sort: {
          type: "string",
          enum: ["stars", "updated", "relevance"],
          description: "Sort results by (default: relevance)",
          default: "relevance",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "tech_news_search",
    description: "Search tech news sources (Hacker News, Reddit, Lobsters) for discussions about packages, features, and issues.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic to search for (e.g., 'NixOS 25.11', 'nvidia drivers')",
        },
        source: {
          type: "string",
          enum: ["hackernews", "reddit", "lobsters", "all"],
          description: "News source to search (default: all)",
          default: "all",
        },
        time_range: {
          type: "string",
          enum: ["day", "week", "month"],
          description: "Time range for search (default: week)",
          default: "week",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "nixos_discourse_search",
    description: "Search NixOS Discourse forum for community discussions, solutions, and best practices.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for Discourse",
        },
        category: {
          type: "string",
          description: "Filter by category (e.g., 'Help', 'Development')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "stackoverflow_search",
    description: "Search Stack Overflow for technical solutions and code examples related to NixOS and related technologies.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Stack Overflow search query",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags (e.g., ['nixos', 'nix'])",
        },
        sort: {
          type: "string",
          enum: ["relevance", "votes", "activity", "creation"],
          description: "Sort results by (default: relevance)",
          default: "relevance",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "osint_dns",
    description: "Perform DNS reconnaissance on a domain using spider-nix. Retrieves DNS records, nameservers, MX records, and more.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Target domain for DNS reconnaissance",
        },
        record_types: {
          type: "array",
          items: { type: "string" },
          description: "DNS record types to query (e.g., ['A', 'AAAA', 'MX', 'NS', 'TXT'])",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
          default: 30000,
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "osint_subdomains",
    description: "Discover subdomains for a target domain using spider-nix. Uses certificate transparency, DNS bruteforce, and other techniques.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Target domain for subdomain discovery",
        },
        wordlist: {
          type: "string",
          description: "Path to custom subdomain wordlist (optional)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 60000)",
          default: 60000,
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "osint_portscan",
    description: "Perform port scanning on a target host using spider-nix. Identifies open ports and running services.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Target host (IP address or hostname)",
        },
        ports: {
          type: "string",
          description: "Port range (e.g., '1-1000', '80,443,8080'). Default: common ports",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)",
          default: 120000,
        },
      },
      required: ["host"],
    },
  },
  {
    name: "web_crawl",
    description: "Crawl a website using spider-nix with advanced stealth and content extraction. Use for deep analysis of specific sites.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Target URL to crawl",
        },
        pages: {
          type: "number",
          description: "Maximum number of pages to crawl (default: 10)",
          default: 10,
        },
        browser: {
          type: "boolean",
          description: "Use browser mode for JavaScript-heavy sites (default: false)",
          default: false,
        },
        follow_links: {
          type: "boolean",
          description: "Follow links on pages (default: true)",
          default: true,
        },
        aggressive: {
          type: "boolean",
          description: "Use aggressive crawling mode (default: false)",
          default: false,
        },
      },
      required: ["url"],
    },
  },
];

/**
 * Execute web search using spider-nix crawler
 *
 * Provides real web crawling with content extraction instead of limited API results
 */
export async function handleWebSearch(args: WebSearchArgs) {
  const { query, search_type = "general", limit = 10 } = args;

  try {
    let searchQuery = query;

    // Add site-specific filters based on search type
    switch (search_type) {
      case "nixos":
        searchQuery = `${query} site:nixos.org OR site:discourse.nixos.org OR site:wiki.nixos.org`;
        break;
      case "github":
        searchQuery = `${query} site:github.com`;
        break;
      case "stackoverflow":
        searchQuery = `${query} site:stackoverflow.com`;
        break;
      case "reddit":
        searchQuery = `${query} site:reddit.com/r/nixos OR site:reddit.com/r/nix`;
        break;
    }

    logger.info(
      { query: searchQuery, search_type, limit },
      "Executing spider-nix web search"
    );

    // Use spider-nix for real web crawling
    const crawlResults = await spiderWebSearch(searchQuery, limit);

    // Transform spider-nix results to our format
    const results = crawlResults.map((result, index) => ({
      type: "crawl_result",
      rank: index + 1,
      title: result.title || "No title",
      description: result.description || result.content?.substring(0, 200) || "",
      url: result.url,
      content_preview: result.content?.substring(0, 500),
      relevance: index < 3 ? "high" : index < 6 ? "medium" : "low",
    }));

    return formatIntelligentOutput({
      query: searchQuery,
      source: "Spider-Nix Crawler",
      results,
      summary: `Found ${results.length} results via intelligent web crawling.`,
    });
  } catch (error: any) {
    logger.error({ err: error, query, search_type }, "Spider-nix search failed");

    // Fallback: try simple DuckDuckGo instant answer
    try {
      const encodedQuery = encodeURIComponent(query);
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

      const response = await fetch(ddgUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json() as any;

        if (data.AbstractText) {
          return formatIntelligentOutput({
            query,
            source: "DuckDuckGo (Fallback)",
            results: [{
              type: "instant_answer",
              title: data.Heading || "Answer",
              description: data.AbstractText,
              url: data.AbstractURL,
              source: data.AbstractSource,
            }],
            summary: "Spider-nix unavailable, using fallback instant answer.",
          });
        }
      }
    } catch (fallbackError: any) {
      logger.warn({ err: fallbackError }, "Fallback search also failed");
    }

    return {
      success: false,
      error: error.message,
      message: "Web search failed",
      suggestion: "Try using research_agent for more comprehensive results, or check if spider-nix is installed",
    };
  }
}

/**
 * Search GitHub using native fetch
 */
export async function handleGithubSearch(args: GithubSearchArgs) {
  const { query, type = "repositories", language, sort = "relevance" } = args;

  try {
    let searchQuery = query;
    if (language) {
      searchQuery += ` language:${language}`;
    }

    const encodedQuery = encodeURIComponent(searchQuery);
    const apiUrl = `https://api.github.com/search/${type}?q=${encodedQuery}&sort=${sort}&per_page=10`;

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": USER_AGENT,
    };

    // Add token if available (increases rate limit from 60 to 5000 req/h)
    // Token sources: ENV > gh CLI > SOPS (see src/utils/github-token.ts)
    const githubToken = await getGitHubToken();
    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const response = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.message || `GitHub API error: ${response.status}`);
    }

    const data = await response.json() as any;

    const results = (data.items || []).map((item: any) => {
      if (type === "repositories") {
        return {
          name: item.full_name,
          description: item.description,
          url: item.html_url,
          stars: item.stargazers_count,
          language: item.language,
          updated: item.updated_at,
          // Actionable info
          clone_cmd: `git clone ${item.clone_url}`,
          nix_flake: item.language === "Nix" ? `nix flake show github:${item.full_name}` : null,
        };
      } else if (type === "issues") {
        return {
          title: item.title,
          url: item.html_url,
          state: item.state,
          labels: item.labels?.map((l: any) => l.name) || [],
          created: item.created_at,
          updated: item.updated_at,
          is_solved: item.state === "closed",
        };
      } else {
        return {
          path: item.path,
          repository: item.repository?.full_name,
          url: item.html_url,
        };
      }
    });

    // Generate summary
    let summary = "";
    if (type === "repositories") {
      const topStars = results[0]?.stars || 0;
      const nixRepos = results.filter((r: any) => r.language === "Nix").length;
      summary = `Top repo has ${topStars} stars. ${nixRepos} are Nix-based.`;
    } else if (type === "issues") {
      const solved = results.filter((r: any) => r.is_solved).length;
      summary = `${solved}/${results.length} issues are solved.`;
    }

    return formatIntelligentOutput({
      query,
      source: `GitHub (${type})`,
      results,
      summary,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: "GitHub search failed",
    };
  }
}

/**
 * Search NixOS packages using nix command (local) or fallback URL
 */
export async function handleNixSearch(args: NixSearchArgs) {
  const { package_name, query, channel = "unstable", type = "packages" } = args;

  try {
    const searchTerm = package_name || query;
    if (!searchTerm) {
      throw new Error("Either package_name or query must be provided");
    }

    // Try local nix search first
    try {
      const packages = await packageSearch.search(searchTerm, 10);

      const results = packages.map(pkg => ({
        name: pkg.name,
        path: pkg.attrPath,
        version: pkg.version,
        description: pkg.description,
        // Actionable info
        install_cmd: `nix profile install nixpkgs#${pkg.attrPath}`,
        shell_cmd: `nix shell nixpkgs#${pkg.attrPath}`,
      }));

      return formatIntelligentOutput({
        query: searchTerm,
        source: `NixOS (${channel})`,
        results,
        summary: results.length > 0
          ? `Found packages. Latest version: ${results[0]?.version || "unknown"}`
          : undefined,
      });
    } catch (nixError) {
      // Fallback to web interface link
      const searchUrl = `https://search.nixos.org/${type}?channel=${channel === "stable" ? "25.05" : "unstable"}&query=${encodeURIComponent(searchTerm)}`;

      return {
        success: true,
        query: searchTerm,
        source: "NixOS (web)",
        message: "Local nix command unavailable, use web interface",
        search_url: searchUrl,
        quick_action: `Open: ${searchUrl}`,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: "NixOS search failed",
    };
  }
}

/**
 * Search tech news using native fetch
 */
export async function handleTechNewsSearch(args: TechNewsArgs) {
  const { topic, source = "all", time_range = "week" } = args;

  try {
    const allResults: any[] = [];
    const sources: any[] = [];

    // Hacker News via Algolia
    if (source === "hackernews" || source === "all") {
      try {
        const timeSeconds = time_range === "day" ? 86400 : time_range === "week" ? 604800 : 2592000;
        const timeFilter = Math.floor(Date.now() / 1000 - timeSeconds);
        const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&numericFilters=created_at_i>${timeFilter}`;

        const response = await fetch(hnUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const hn = await response.json() as any;
          const hnResults = (hn.hits || []).slice(0, 5).map((hit: any) => ({
            source: "Hacker News",
            title: hit.title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            points: hit.points,
            comments: hit.num_comments,
            discussion_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
            created: new Date(hit.created_at).toISOString(),
          }));
          allResults.push(...hnResults);
          sources.push({ name: "Hacker News", count: hnResults.length });
        }
      } catch (e) {
        logger.warn({ err: e }, "HN search failed");
      }
    }

    // Reddit
    if (source === "reddit" || source === "all") {
      try {
        const redditUrl = `https://www.reddit.com/r/NixOS/search.json?q=${encodeURIComponent(topic)}&limit=5&sort=relevance&restrict_sr=1`;

        const response = await fetch(redditUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const reddit = await response.json() as any;
          const redditResults = (reddit.data?.children || []).slice(0, 5).map((child: any) => ({
            source: "Reddit",
            title: child.data.title,
            url: `https://reddit.com${child.data.permalink}`,
            subreddit: child.data.subreddit,
            score: child.data.score,
            comments: child.data.num_comments,
            created: new Date(child.data.created_utc * 1000).toISOString(),
          }));
          allResults.push(...redditResults);
          sources.push({ name: "Reddit r/NixOS", count: redditResults.length });
        }
      } catch (e) {
        logger.warn({ err: e }, "Reddit search failed");
      }
    }

    // Sort by engagement (points/score)
    allResults.sort((a, b) => (b.points || b.score || 0) - (a.points || a.score || 0));

    // Generate summary
    const totalEngagement = allResults.reduce((sum, r) => sum + (r.points || r.score || 0), 0);
    const topSource = sources.sort((a, b) => b.count - a.count)[0]?.name || "none";
    const summary = `Found ${allResults.length} discussions. Total engagement: ${totalEngagement}. Most results from: ${topSource}`;

    return formatIntelligentOutput({
      query: topic,
      source: sources.map(s => s.name).join(", "),
      results: allResults,
      summary,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: "Tech news search failed",
    };
  }
}

/**
 * Search NixOS Discourse using native fetch
 */
export async function handleDiscourseSearch(args: { query: string; category?: string }) {
  const { query, category } = args;

  try {
    let searchUrl = `https://discourse.nixos.org/search.json?q=${encodeURIComponent(query)}`;
    if (category) {
      searchUrl += `&category=${encodeURIComponent(category)}`;
    }

    const response = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Discourse API error: ${response.status}`);
    }

    const data = await response.json() as any;

    const results = (data.posts || []).slice(0, 10).map((post: any) => ({
      title: post.blurb?.substring(0, 100),
      url: `https://discourse.nixos.org/t/${post.topic_id}/${post.post_number}`,
      username: post.username,
      likes: post.like_count,
      created: post.created_at,
      // Actionable
      is_solution: post.accepted_answer || false,
    }));

    // Count solutions
    const solutionCount = results.filter((r: any) => r.is_solution).length;
    const summary = solutionCount > 0
      ? `Found ${solutionCount} marked solutions.`
      : `Found ${results.length} discussions.`;

    return formatIntelligentOutput({
      query,
      source: "NixOS Discourse",
      results,
      summary,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: "Discourse search failed",
    };
  }
}

/**
 * Search Stack Overflow using native fetch
 */
export async function handleStackOverflowSearch(args: { query: string; tags?: string[]; sort?: string }) {
  const { query, tags, sort = "relevance" } = args;

  try {
    let searchQuery = query;
    if (tags && tags.length > 0) {
      searchQuery += ` [${tags.join("] [")}]`;
    }

    const apiUrl = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=${sort}&q=${encodeURIComponent(searchQuery)}&site=stackoverflow&tagged=nix`;

    const response = await fetch(apiUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Stack Overflow API error: ${response.status}`);
    }

    const data = await response.json() as any;

    const results = (data.items || []).slice(0, 10).map((item: any) => ({
      title: item.title,
      url: item.link,
      score: item.score,
      answer_count: item.answer_count,
      is_answered: item.is_answered,
      has_accepted: item.accepted_answer_id ? true : false,
      view_count: item.view_count,
      tags: item.tags,
      created: new Date(item.creation_date * 1000).toISOString(),
    }));

    // Generate intelligent summary
    const answered = results.filter((r: any) => r.is_answered).length;
    const accepted = results.filter((r: any) => r.has_accepted).length;
    const avgScore = results.length > 0
      ? Math.round(results.reduce((sum: number, r: any) => sum + r.score, 0) / results.length)
      : 0;
    const summary = `${answered}/${results.length} answered, ${accepted} with accepted answer. Avg score: ${avgScore}`;

    return formatIntelligentOutput({
      query,
      source: "Stack Overflow",
      results,
      summary,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      message: "Stack Overflow search failed",
    };
  }
}

/**
 * Handle OSINT DNS reconnaissance
 */
export async function handleOsintDns(args: {
  domain: string;
  record_types?: string[];
  timeout?: number;
}) {
  const { domain, record_types, timeout } = args;

  try {
    logger.info({ domain, record_types }, "Performing DNS reconnaissance");

    const result = await osintDns(domain, {
      recordTypes: record_types,
      timeout,
    });

    return {
      success: true,
      domain,
      records: result.records,
      nameservers: result.nameservers,
      mx: result.mx,
      summary: `DNS records retrieved for ${domain}`,
    };
  } catch (error: any) {
    logger.error({ err: error, domain }, "DNS reconnaissance failed");
    return {
      success: false,
      error: error.message,
      message: "DNS reconnaissance failed",
    };
  }
}

/**
 * Handle OSINT subdomain discovery
 */
export async function handleOsintSubdomains(args: {
  domain: string;
  wordlist?: string;
  timeout?: number;
}) {
  const { domain, wordlist, timeout } = args;

  try {
    logger.info({ domain, wordlist }, "Performing subdomain discovery");

    const result = await osintSubdomains(domain, {
      wordlist,
      timeout,
    });

    return {
      success: true,
      domain,
      subdomains: result.subdomains,
      sources: result.sources,
      count: result.subdomains.length,
      summary: `Found ${result.subdomains.length} subdomains for ${domain}`,
    };
  } catch (error: any) {
    logger.error({ err: error, domain }, "Subdomain discovery failed");
    return {
      success: false,
      error: error.message,
      message: "Subdomain discovery failed",
    };
  }
}

/**
 * Handle OSINT port scanning
 */
export async function handleOsintPortScan(args: {
  host: string;
  ports?: string;
  timeout?: number;
}) {
  const { host, ports, timeout } = args;

  try {
    logger.info({ host, ports }, "Performing port scan");

    const result = await osintPortScan(host, {
      ports,
      timeout,
    });

    const openPorts = result.ports.filter(p => p.state === 'open');

    return {
      success: true,
      host,
      ports: result.ports,
      open_count: openPorts.length,
      open_ports: openPorts,
      summary: `Found ${openPorts.length} open ports on ${host}`,
    };
  } catch (error: any) {
    logger.error({ err: error, host }, "Port scan failed");
    return {
      success: false,
      error: error.message,
      message: "Port scan failed",
    };
  }
}

/**
 * Handle direct website crawling
 */
export async function handleWebCrawl(args: {
  url: string;
  pages?: number;
  browser?: boolean;
  follow_links?: boolean;
  aggressive?: boolean;
}) {
  const { url, pages = 10, browser = false, follow_links = true, aggressive = false } = args;

  try {
    logger.info({ url, pages, browser, aggressive }, "Crawling website");

    const results = await crawlWebsite(url, {
      pages,
      browser,
      followLinks: follow_links,
      aggressive,
      timeout: 120000,
    });

    return {
      success: true,
      url,
      pages_crawled: results.length,
      results: results.map((r, i) => ({
        rank: i + 1,
        url: r.url,
        title: r.title,
        description: r.description,
        content_length: r.content?.length || 0,
        links_found: r.links?.length || 0,
      })),
      summary: `Successfully crawled ${results.length} pages from ${url}`,
    };
  } catch (error: any) {
    logger.error({ err: error, url }, "Web crawl failed");
    return {
      success: false,
      error: error.message,
      message: "Web crawl failed",
    };
  }
}