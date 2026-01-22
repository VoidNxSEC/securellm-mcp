/**
 * GitHub OAuth provider types
 */

/**
 * GitHub user information
 */
export interface GitHubUser {
  /** GitHub user ID */
  id: number;
  /** Username */
  login: string;
  /** Display name */
  name: string | null;
  /** Email address */
  email: string | null;
  /** Avatar URL */
  avatar_url: string;
  /** Profile URL */
  html_url: string;
  /** User type (User or Organization) */
  type: string;
  /** Account creation date */
  created_at: string;
  /** Last update date */
  updated_at: string;
}

/**
 * GitHub OAuth scopes
 */
export type GitHubScope =
  | "repo" // Full repo access
  | "repo:status" // Repo status access
  | "public_repo" // Public repo access
  | "user" // User data access
  | "user:email" // User email access
  | "read:user" // Read user data
  | "gist" // Gist access
  | "workflow"; // GitHub Actions workflow access

/**
 * GitHub user email information
 */
export interface GitHubUserEmail {
  /** Email address */
  email: string;
  /** Whether this is the primary email */
  primary: boolean;
  /** Whether this email is verified */
  verified: boolean;
  /** Email visibility */
  visibility: string | null;
}

/**
 * GitHub repository information (simplified)
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

/**
 * GitHub gist information (simplified)
 */
export interface GitHubGist {
  id: string;
  html_url: string;
  public: boolean;
  created_at: string;
  updated_at: string;
  description: string | null;
  files: Record<
    string,
    {
      filename: string;
      type: string;
      language: string | null;
      raw_url: string;
      size: number;
    }
  >;
}

/**
 * GitHub API endpoints
 */
export const GITHUB_API_ENDPOINTS = {
  authorization: "https://github.com/login/oauth/authorize",
  token: "https://github.com/login/oauth/access_token",
  user: "https://api.github.com/user",
  userEmails: "https://api.github.com/user/emails",
} as const;
