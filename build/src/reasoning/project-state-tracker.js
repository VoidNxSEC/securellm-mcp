/**
 * Project State Tracker
 *
 * Monitors project state including file system, git, and build status.
 * Provides real-time awareness of project changes.
 */
import { execa } from 'execa';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
/**
 * Project State Tracker
 */
export class ProjectStateTracker {
    projectRoot;
    cache = null;
    cacheExpiry = 0;
    CACHE_TTL = 10_000; // 10 seconds
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    /**
     * Get current project state (cached)
     */
    async getState() {
        const now = Date.now();
        if (this.cache && now < this.cacheExpiry) {
            return this.cache;
        }
        this.cache = await this.buildState();
        this.cacheExpiry = now + this.CACHE_TTL;
        return this.cache;
    }
    /**
     * Force refresh state
     */
    async refresh() {
        this.cacheExpiry = 0;
        return this.getState();
    }
    /**
     * Build complete project state
     */
    async buildState() {
        return {
            root: this.projectRoot,
            git: await this.getGitState(),
            build: await this.getBuildState(),
            recentFiles: await this.getRecentFiles(),
            fileTypes: this.getFileTypeCounts(),
            timestamp: Date.now(),
        };
    }
    /**
     * Get git repository state
     */
    async getGitState() {
        try {
            // Check if git repo
            await execa('git', ['rev-parse', '--git-dir'], {
                cwd: this.projectRoot,
                stdio: 'ignore',
            });
            // Get current branch
            const branchResult = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: this.projectRoot,
            });
            const branch = branchResult.stdout.trim();
            // Get status
            const statusResult = await execa('git', ['status', '--porcelain'], {
                cwd: this.projectRoot,
            });
            const modified = [];
            const staged = [];
            const untracked = [];
            for (const line of statusResult.stdout.split('\n')) {
                if (!line)
                    continue;
                const status = line.substring(0, 2);
                const file = line.substring(3);
                if (status[0] !== ' ' && status[0] !== '?') {
                    staged.push(file);
                }
                if (status[1] === 'M') {
                    modified.push(file);
                }
                if (status === '??') {
                    untracked.push(file);
                }
            }
            // Get last commit
            let lastCommit;
            let lastCommitMessage;
            try {
                const lastCommitResult = await execa('git', ['rev-parse', '--short', 'HEAD'], {
                    cwd: this.projectRoot,
                });
                lastCommit = lastCommitResult.stdout.trim();
                const msgResult = await execa('git', ['log', '-1', '--pretty=%B'], {
                    cwd: this.projectRoot,
                });
                lastCommitMessage = msgResult.stdout.trim();
            }
            catch {
                // No commits yet
            }
            return {
                branch,
                modified,
                staged,
                untracked,
                isDirty: modified.length > 0 || staged.length > 0 || untracked.length > 0,
                lastCommit,
                lastCommitMessage,
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Get build state (check if nix build succeeds)
     */
    async getBuildState() {
        try {
            // Try nix flake check
            // Use execa directly as we want to capture error output for analysis
            await execa('nix', ['flake', 'check', '--no-build'], {
                cwd: this.projectRoot,
                timeout: 5000, // 5s timeout
                stderr: 'pipe', // Capture stderr
            });
            return {
                success: true,
                errors: [],
                warnings: [],
                timestamp: Date.now(),
            };
        }
        catch (error) {
            const output = error.stdout || error.stderr || '';
            return {
                success: false,
                errors: this.parseErrors(output),
                warnings: this.parseWarnings(output),
                timestamp: Date.now(),
            };
        }
    }
    /**
     * Parse errors from build output
     */
    parseErrors(output) {
        const errors = [];
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes('error:') || line.includes('ERROR')) {
                errors.push(line.trim());
            }
        }
        return errors.slice(0, 10); // Limit to 10 errors
    }
    /**
     * Parse warnings from build output
     */
    parseWarnings(output) {
        const warnings = [];
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes('warning:') || line.includes('WARN')) {
                warnings.push(line.trim());
            }
        }
        return warnings.slice(0, 10); // Limit to 10 warnings
    }
    /**
     * Get recently modified files
     */
    async getRecentFiles() {
        try {
            const result = await execa('git', ['diff', '--name-only', 'HEAD~5..HEAD'], {
                cwd: this.projectRoot,
                timeout: 2000,
            });
            return result.stdout.split('\n').filter(f => f.length > 0).slice(0, 20);
        }
        catch {
            return [];
        }
    }
    /**
     * Count files by extension
     */
    getFileTypeCounts() {
        const counts = {};
        try {
            this.walkDirectory(this.projectRoot, (file) => {
                const ext = extname(file);
                if (ext) {
                    counts[ext] = (counts[ext] || 0) + 1;
                }
            });
        }
        catch {
            // Ignore errors
        }
        return counts;
    }
    /**
     * Walk directory tree (limited depth)
     */
    walkDirectory(dir, callback, depth = 0) {
        if (depth > 3)
            return; // Max depth 3
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                // Skip hidden and common ignore dirs
                if (entry.startsWith('.') || entry === 'node_modules' || entry === 'target') {
                    continue;
                }
                const fullPath = join(dir, entry);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    this.walkDirectory(fullPath, callback, depth + 1);
                }
                else {
                    callback(fullPath);
                }
            }
        }
        catch {
            // Ignore errors
        }
    }
}
//# sourceMappingURL=project-state-tracker.js.map