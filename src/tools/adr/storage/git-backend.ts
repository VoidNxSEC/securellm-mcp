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
