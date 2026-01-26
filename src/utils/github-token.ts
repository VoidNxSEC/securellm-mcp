/**
 * GitHub Token Provider
 *
 * Retrieves GitHub Personal Access Token from multiple sources with fallback.
 *
 * Priority order:
 * 1. Environment variable (GITHUB_TOKEN) - for testing/override
 * 2. gh CLI (`gh auth token`) - PRIMARY SOURCE (current convenience)
 * 3. SOPS secrets (/run/secrets/github_token) - FUTURE MIGRATION PATH
 *
 * KNOWN TRADE-OFFS (using gh CLI):
 * - ❌ Requires gh CLI installed and authenticated
 * - ❌ Token scope may differ per user/environment
 * - ❌ Not suitable for production/CI without gh setup
 * - ❌ Token rotation depends on user running `gh auth login`
 *
 * MIGRATION PATH TO SOPS:
 * When conflicts arise, enable NixOS module:
 *   kernelcore.secrets.github.enable = true;
 * Then rebuild: sudo nixos-rebuild switch
 * Token will be available at /run/secrets/github_token
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { logger } from './logger.js';

const execAsync = promisify(exec);

interface TokenSource {
  name: string;
  priority: number;
  fetch: () => Promise<string | null>;
}

class GitHubTokenProvider {
  private cachedToken: string | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 300000; // 5 minutes

  private sources: TokenSource[] = [
    {
      name: 'ENV',
      priority: 1,
      fetch: async () => process.env.GITHUB_TOKEN || null,
    },
    {
      name: 'gh CLI',
      priority: 2,
      fetch: async () => {
        try {
          const { stdout } = await execAsync('gh auth token');
          const token = stdout.trim();
          if (token && (token.startsWith('gho_') || token.startsWith('ghp_'))) {
            return token;
          }
          return null;
        } catch (error) {
          logger.debug({ error }, '[GitHubToken] gh CLI not available');
          return null;
        }
      },
    },
    {
      name: 'SOPS',
      priority: 3,
      fetch: async () => {
        try {
          const token = await readFile('/run/secrets/github_token', 'utf-8');
          return token.trim() || null;
        } catch (error) {
          logger.debug({ error }, '[GitHubToken] SOPS secret not available');
          return null;
        }
      },
    },
  ];

  /**
   * Get GitHub token from available sources
   * Returns null if no token is available
   */
  async getToken(): Promise<string | null> {
    // Return cached token if still valid
    const now = Date.now();
    if (this.cachedToken && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.cachedToken;
    }

    // Try each source in priority order
    for (const source of this.sources.sort((a, b) => a.priority - b.priority)) {
      try {
        const token = await source.fetch();
        if (token) {
          logger.info(`[GitHubToken] Using token from: ${source.name}`);
          this.cachedToken = token;
          this.cacheTimestamp = now;
          return token;
        }
      } catch (error) {
        logger.debug({ error, source: source.name }, '[GitHubToken] Source failed');
      }
    }

    logger.warn('[GitHubToken] No token available from any source');
    return null;
  }

  /**
   * Clear cached token (useful for testing or forcing refresh)
   */
  clearCache(): void {
    this.cachedToken = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Check token validity and rate limits
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    rateLimit: number;
    remaining: number;
  }> {
    try {
      const response = await fetch('https://api.github.com/rate_limit', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        return { valid: false, rateLimit: 0, remaining: 0 };
      }

      const data = await response.json() as any;
      return {
        valid: true,
        rateLimit: data.rate.limit,
        remaining: data.rate.remaining,
      };
    } catch (error) {
      logger.error({ error }, '[GitHubToken] Validation failed');
      return { valid: false, rateLimit: 0, remaining: 0 };
    }
  }
}

// Singleton instance
export const githubTokenProvider = new GitHubTokenProvider();

// Convenience function
export async function getGitHubToken(): Promise<string | null> {
  return githubTokenProvider.getToken();
}
