/**
 * Spider-Nix Wrapper for MCP
 *
 * Provides async interface to spider-nix OSINT/crawler toolkit
 * Uses execa to execute spider-nix CLI commands without blocking event loop
 */

import { execa } from 'execa';
import { logger } from '../utils/logger.js';

export interface SpiderNixOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

export interface CrawlOptions extends SpiderNixOptions {
  pages?: number;
  browser?: boolean;
  aggressive?: boolean;
  followLinks?: boolean;
  proxyFile?: string;
  outputFormat?: 'json' | 'csv';
}

export interface OsintDnsOptions extends SpiderNixOptions {
  output?: string;
  recordTypes?: string[];
}

export interface OsintSubdomainOptions extends SpiderNixOptions {
  output?: string;
  wordlist?: string;
}

export interface OsintPortScanOptions extends SpiderNixOptions {
  ports?: string;
  output?: string;
}

export interface CrawlResult {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  links?: string[];
  statusCode?: number;
  headers?: Record<string, string>;
}

export interface DnsResult {
  domain: string;
  records: Record<string, string[]>;
  nameservers?: string[];
  mx?: string[];
}

export interface SubdomainResult {
  domain: string;
  subdomains: string[];
  sources?: string[];
}

export interface PortScanResult {
  host: string;
  ports: Array<{
    port: number;
    state: 'open' | 'closed' | 'filtered';
    service?: string;
  }>;
}

/**
 * Execute spider-nix command asynchronously
 *
 * @param args - spider-nix command arguments
 * @param options - Execution options
 * @returns Promise resolving to command stdout
 */
export async function executeSpiderNixCommand(
  args: string[],
  options: SpiderNixOptions = {}
): Promise<string> {
  const {
    cwd = process.cwd(),
    timeout = 60000, // Default 60s for web operations
    maxBuffer = 50 * 1024 * 1024, // 50MB for large crawl results
  } = options;

  const startTime = Date.now();

  try {
    logger.debug(
      {
        command: 'spider-nix',
        args,
        cwd,
        timeout,
      },
      'Executing spider-nix command'
    );

    const result = await execa('spider-nix', args, {
      cwd,
      timeout,
      maxBuffer,
      reject: false,
      env: {
        ...process.env,
        // Ensure spider-nix uses machine-readable output
        PYTHONIOENCODING: 'utf-8',
      },
    });

    const duration = Date.now() - startTime;

    if (result.failed) {
      logger.error(
        {
          args,
          stderr: result.stderr.substring(0, 500),
          exitCode: result.exitCode,
          durationMs: duration,
        },
        'Spider-nix command failed'
      );
      throw new Error(`Spider-nix command failed: ${result.stderr}`);
    }

    logger.debug(
      {
        args,
        exitCode: result.exitCode,
        durationMs: duration,
        stdoutLength: result.stdout.length,
      },
      'Spider-nix command succeeded'
    );

    return result.stdout;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    if (error.name === 'ExecaError' && error.timedOut) {
      logger.warn({ args, timeout, durationMs: duration }, 'Spider-nix command timed out');
      throw new Error(`Spider-nix command timed out after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * Crawl a website using spider-nix
 *
 * @param url - Target URL to crawl
 * @param options - Crawl options
 * @returns Promise resolving to crawl results
 */
export async function crawlWebsite(
  url: string,
  options: CrawlOptions = {}
): Promise<CrawlResult[]> {
  const args = ['crawl', url];

  if (options.pages) {
    args.push('--pages', options.pages.toString());
  }

  if (options.browser) {
    args.push('--browser');
  }

  if (options.aggressive) {
    args.push('--aggressive');
  }

  if (options.followLinks !== false) {
    args.push('--follow-links');
  }

  if (options.proxyFile) {
    args.push('--proxy-file', options.proxyFile);
  }

  // Force JSON output for parsing
  const format = options.outputFormat || 'json';
  args.push('--output-format', format);

  try {
    const stdout = await executeSpiderNixCommand(args, {
      timeout: options.timeout || 120000, // 2 minutes for crawling
      maxBuffer: options.maxBuffer,
    });

    if (format === 'json') {
      return JSON.parse(stdout) as CrawlResult[];
    }

    // Fallback for non-JSON output
    return [
      {
        url,
        content: stdout,
      },
    ];
  } catch (error: any) {
    logger.error({ err: error, url, options }, 'Crawl failed');
    throw new Error(`Failed to crawl ${url}: ${error.message}`);
  }
}

/**
 * Perform DNS reconnaissance
 *
 * @param domain - Target domain
 * @param options - DNS options
 * @returns Promise resolving to DNS results
 */
export async function osintDns(
  domain: string,
  options: OsintDnsOptions = {}
): Promise<DnsResult> {
  const args = ['recon', 'dns', domain];

  if (options.recordTypes && options.recordTypes.length > 0) {
    args.push('--records', options.recordTypes.join(','));
  }

  // Force JSON output
  args.push('--output-format', 'json');

  try {
    const stdout = await executeSpiderNixCommand(args, {
      timeout: options.timeout || 30000,
    });

    return JSON.parse(stdout) as DnsResult;
  } catch (error: any) {
    logger.error({ err: error, domain }, 'DNS recon failed');
    throw new Error(`DNS reconnaissance failed for ${domain}: ${error.message}`);
  }
}

/**
 * Discover subdomains
 *
 * @param domain - Target domain
 * @param options - Subdomain discovery options
 * @returns Promise resolving to subdomain results
 */
export async function osintSubdomains(
  domain: string,
  options: OsintSubdomainOptions = {}
): Promise<SubdomainResult> {
  const args = ['recon', 'subdomains', domain];

  if (options.wordlist) {
    args.push('--wordlist', options.wordlist);
  }

  args.push('--output-format', 'json');

  try {
    const stdout = await executeSpiderNixCommand(args, {
      timeout: options.timeout || 60000,
    });

    return JSON.parse(stdout) as SubdomainResult;
  } catch (error: any) {
    logger.error({ err: error, domain }, 'Subdomain discovery failed');
    throw new Error(`Subdomain discovery failed for ${domain}: ${error.message}`);
  }
}

/**
 * Perform port scanning
 *
 * @param host - Target host IP or hostname
 * @param options - Port scan options
 * @returns Promise resolving to port scan results
 */
export async function osintPortScan(
  host: string,
  options: OsintPortScanOptions = {}
): Promise<PortScanResult> {
  const args = ['recon', 'portscan', host];

  if (options.ports) {
    args.push('-p', options.ports);
  }

  args.push('--output-format', 'json');

  try {
    const stdout = await executeSpiderNixCommand(args, {
      timeout: options.timeout || 120000, // Port scanning can take time
    });

    return JSON.parse(stdout) as PortScanResult;
  } catch (error: any) {
    logger.error({ err: error, host }, 'Port scan failed');
    throw new Error(`Port scan failed for ${host}: ${error.message}`);
  }
}

/**
 * Search the web using spider-nix crawler
 * Performs intelligent crawling with content extraction
 *
 * @param query - Search query
 * @param maxResults - Maximum number of results
 * @returns Promise resolving to search results
 */
export async function webSearch(
  query: string,
  maxResults: number = 10
): Promise<Array<{ title: string; url: string; description: string; content: string }>> {
  // Use DuckDuckGo as entry point, then crawl results
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

  try {
    const results = await crawlWebsite(searchUrl, {
      pages: maxResults,
      browser: true, // Use browser mode for JavaScript-heavy search engines
      followLinks: true,
      timeout: 90000,
    });

    return results.map((r) => ({
      title: r.title || 'No title',
      url: r.url,
      description: r.description || '',
      content: r.content || '',
    }));
  } catch (error: any) {
    logger.error({ err: error, query }, 'Web search failed');
    throw new Error(`Web search failed for "${query}": ${error.message}`);
  }
}
