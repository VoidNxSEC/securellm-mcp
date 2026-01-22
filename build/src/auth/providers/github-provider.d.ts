/**
 * GitHub OAuth Provider
 *
 * Implements OAuth 2.0 authentication for GitHub API access.
 *
 * Features:
 * - Full OAuth 2.0 flow with PKCE
 * - Token validation via GitHub API
 * - User info fetching
 * - Automatic token refresh
 * - Rate limit handling
 *
 * Documentation: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps
 */
import { OAuthManager } from "../oauth-manager.js";
import { OAuthToken } from "../../types/oauth.js";
import { GitHubUser, GitHubScope, GitHubRepository, GitHubGist } from "../../types/providers/github.js";
/**
 * GitHub OAuth Provider implementation
 */
export declare class GitHubOAuthProvider extends OAuthManager {
    /**
     * Create GitHub OAuth provider with default configuration
     */
    static createDefault(clientId: string, clientSecret: string, redirectUri: string, scopes?: GitHubScope[]): GitHubOAuthProvider;
    /**
     * Validate token by calling GitHub API
     */
    validateToken(token: OAuthToken): Promise<boolean>;
    /**
     * Get user information from GitHub
     */
    getUserInfo(token: OAuthToken): Promise<GitHubUser>;
    /**
     * Make authenticated request to GitHub API
     */
    makeRequest<T = unknown>(token: OAuthToken, endpoint: string, options?: RequestInit): Promise<T>;
    /**
     * List user repositories
     */
    listRepositories(token: OAuthToken, options?: {
        type?: "all" | "owner" | "public" | "private" | "member";
        sort?: "created" | "updated" | "pushed" | "full_name";
        per_page?: number;
        page?: number;
    }): Promise<GitHubRepository[]>;
    /**
     * Get repository details
     */
    getRepository(token: OAuthToken, owner: string, repo: string): Promise<GitHubGist>;
    /**
     * Create a gist
     */
    createGist(token: OAuthToken, files: Record<string, {
        content: string;
    }>, description?: string, isPublic?: boolean): Promise<GitHubRepository>;
}
//# sourceMappingURL=github-provider.d.ts.map