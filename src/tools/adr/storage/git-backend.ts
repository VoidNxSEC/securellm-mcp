/**
 * Git-based storage backend for ADRs
 *
 * Manages ADR files in Git repository with automated commits
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import type { ADRRecord } from "../types.js";
import { logger } from "../../../utils/logger.js";

const execAsync = promisify(exec);

export class GitBackend {
    constructor(private repoPath: string) { }

    /**
     * Create new ADR file in proposed status
     */
    async create(adr: Partial<ADRRecord> & { content: string }): Promise<ADRRecord> {
        const status = adr.status || "proposed";
        const dirPath = join(this.repoPath, "adr", status);
        const filePath = join(dirPath, `${adr.id}.md`);

        // Write file
        await writeFile(filePath, adr.content, "utf-8");

        // Git add and commit
        try {
            await execAsync(`git add "${filePath}"`, { cwd: this.repoPath });
            await execAsync(
                `git commit -m "ADR: ${adr.title || 'New decision'}"`,
                { cwd: this.repoPath }
            );
        } catch (error) {
            // Git operations optional - files still created
            logger.warn({ error }, "Git commit failed");
        }

        return {
            id: adr.id!,
            title: adr.title!,
            status,
            content: adr.content,
        } as ADRRecord;
    }

    /**
     * List all ADRs with optional status filter
     */
    async list(statusFilter?: string): Promise<Array<Partial<ADRRecord>>> {
        const results: Array<Partial<ADRRecord>> = [];
        const statuses = statusFilter ? [statusFilter] : ["proposed", "accepted", "superseded", "rejected", "deprecated"];

        for (const status of statuses) {
            const dirPath = join(this.repoPath, "adr", status);

            if (!existsSync(dirPath)) continue;

            try {
                const files = await readdir(dirPath);
                const adrFiles = files.filter(f => f.startsWith("ADR-") && f.endsWith(".md"));

                for (const file of adrFiles) {
                    const filePath = join(dirPath, file);
                    const content = await readFile(filePath, "utf-8");
                    const parsed = this.parseADR(content);
                    results.push({ ...parsed, status: status as any });
                }
            } catch (error) {
                // Log errors but continue processing other directories
                logger.warn({ error, dirPath }, "Failed to read ADR directory");
                continue;
            }
        }

        return results;
    }

    /**
     * Get single ADR by ID
     */
    async get(id: string): Promise<ADRRecord | null> {
        const statuses = ["proposed", "accepted", "superseded", "rejected", "deprecated"];

        for (const status of statuses) {
            const filePath = join(this.repoPath, "adr", status, `${id}.md`);

            if (existsSync(filePath)) {
                const content = await readFile(filePath, "utf-8");
                return {
                    ...this.parseADR(content),
                    status: status as any,
                    content
                } as ADRRecord;
            }
        }

        return null;
    }

    /**
     * Search ADRs by text query
     */
    async search(query: string, statusFilter?: string): Promise<Array<Partial<ADRRecord>>> {
        const allAdrs = await this.list(statusFilter);
        const lowerQuery = query.toLowerCase();

        return allAdrs.filter(adr =>
            adr.title?.toLowerCase().includes(lowerQuery) ||
            adr.content?.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Accept a proposed ADR (move to accepted folder)
     */
    async accept(id: string): Promise<void> {
        const sourcePath = join(this.repoPath, "adr", "proposed", `${id}.md`);
        const targetPath = join(this.repoPath, "adr", "accepted", `${id}.md`);

        if (!existsSync(sourcePath)) {
            throw new Error(`ADR ${id} not found in proposed`);
        }

        // Read and update status
        let content = await readFile(sourcePath, "utf-8");
        content = content.replace(/^status:\s*proposed/m, "status: accepted");

        // Update last_modified
        const timestamp = new Date().toISOString();
        content = content.replace(
            /last_modified:\s*"[^"]*"/,
            `last_modified: "${timestamp}"`
        );

        // Write to accepted folder
        await writeFile(targetPath, content, "utf-8");

        // Git operations
        try {
            await execAsync(`rm "${sourcePath}"`, { cwd: this.repoPath });
            await execAsync(`git add "${targetPath}" "${sourcePath}"`, { cwd: this.repoPath });
            await execAsync(`git commit -m "ADR: Accept ${id}"`, { cwd: this.repoPath });
        } catch (error) {
            logger.warn({ error }, "Git commit failed");
        }
    }

    /**
     * Parse ADR markdown to extract metadata
     */
    private parseADR(content: string): Partial<ADRRecord> {
        const idMatch = content.match(/^id:\s*"([^"]+)"/m);
        const titleMatch = content.match(/^title:\s*"([^"]+)"/m);
        const dateMatch = content.match(/^date:\s*"([^"]+)"/m);

        return {
            id: idMatch?.[1],
            title: titleMatch?.[1],
            date: dateMatch?.[1],
            content
        };
    }

    /**
     * Suggest lifecycle changes for proposed ADRs based on task completion
     * and topic overlap detection (ADR-0036 Phase 3)
     */
    async suggestLifecycleChanges(): Promise<Array<{ adrId: string; action: string; reason: string }>> {
        const proposed = await this.list("proposed");
        const suggestions: Array<{ adrId: string; action: string; reason: string }> = [];

        for (const adr of proposed) {
            if (!adr.content || !adr.id) continue;

            // Check task completion — parse markdown checkboxes
            const tasks = this.parseTasks(adr.content);
            if (tasks.total > 0 && tasks.completed === tasks.total) {
                suggestions.push({
                    adrId: adr.id,
                    action: "accept",
                    reason: `All ${tasks.total} implementation tasks completed`,
                });
            }

            // Check for stale ADRs (>60 days with no updates)
            const dateMatch = adr.content.match(/^date:\s*"([^"]+)"/m);
            if (dateMatch) {
                const created = new Date(dateMatch[1]);
                const daysSince = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince > 60) {
                    suggestions.push({
                        adrId: adr.id,
                        action: "review",
                        reason: `Proposed for ${Math.floor(daysSince)} days — consider accepting, rejecting, or updating`,
                    });
                }
            }

            // Check for topic overlap with other proposed ADRs
            const adrKeywords = this.extractTopicKeywords(adr.content);
            for (const other of proposed) {
                if (!other.content || !other.id || other.id === adr.id) continue;
                if (other.id <= adr.id) continue; // avoid duplicate pairs

                const otherKeywords = this.extractTopicKeywords(other.content);
                const overlap = this.calculateOverlap(adrKeywords, otherKeywords);

                if (overlap > 0.6) {
                    suggestions.push({
                        adrId: adr.id,
                        action: "supersede",
                        reason: `High topic overlap (${Math.round(overlap * 100)}%) with ${other.id} — consider consolidating`,
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Parse markdown checkbox tasks from ADR content
     */
    private parseTasks(content: string): { total: number; completed: number } {
        const taskLines = content.match(/^- \[[ x]\] .+$/gm) || [];
        const completed = taskLines.filter(l => l.startsWith("- [x]")).length;
        return { total: taskLines.length, completed };
    }

    /**
     * Extract topic keywords from ADR content for overlap detection
     */
    private extractTopicKeywords(content: string): Set<string> {
        const keywords = new Set<string>();

        // From title
        const title = content.match(/^title:\s*"([^"]+)"/m)?.[1] || "";
        title.toLowerCase().split(/[\s\-_:,]+/).filter(w => w.length > 3).forEach(w => keywords.add(w));

        // From keywords block
        const kwBlock = content.match(/keywords:\s*\n((?:\s*-\s*"[^"]+"\s*\n?)*)/m);
        if (kwBlock) {
            for (const m of kwBlock[1].matchAll(/-\s*"([^"]+)"/g)) {
                m[1].toLowerCase().split(/[\s-]+/).filter(w => w.length > 3).forEach(w => keywords.add(w));
            }
        }

        // From scope projects
        const projects = content.match(/projects:\s*\n((?:\s*-\s*\w+\s*\n?)*)/m);
        if (projects) {
            for (const m of projects[1].matchAll(/-\s*(\w+)/g)) {
                keywords.add(m[1].toLowerCase());
            }
        }

        return keywords;
    }

    /**
     * Calculate Jaccard similarity between two keyword sets
     */
    private calculateOverlap(a: Set<string>, b: Set<string>): number {
        if (a.size === 0 || b.size === 0) return 0;
        let intersection = 0;
        for (const word of a) {
            if (b.has(word)) intersection++;
        }
        const union = a.size + b.size - intersection;
        return union > 0 ? intersection / union : 0;
    }

    /**
     * Get next available ADR ID
     */
    async getNextId(): Promise<string> {
        const allAdrs = await this.list();
        const ids = allAdrs
            .map(adr => adr.id)
            .filter((id): id is string => !!id)
            .map(id => parseInt(id.replace("ADR-", ""), 10))
            .filter(num => !isNaN(num));

        const maxId = ids.length > 0 ? Math.max(...ids) : 0;
        return `ADR-${String(maxId + 1).padStart(4, '0')}`;
    }
}
