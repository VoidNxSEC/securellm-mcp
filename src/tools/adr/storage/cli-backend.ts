/**
 * CLI-based storage backend for ADRs
 *
 * Delegates to `bash scripts/adr <cmd>` and Python .chain/ modules,
 * integrating with the full blockchain layer (ChainManager, MerkleTree,
 * SnapshotManager, GovernanceEngine, provenance, economics).
 */

import { execFile } from "child_process";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { promisify } from "util";
import { logger } from "../../../utils/logger.js";

const execFileAsync = promisify(execFile);

/** Strip ANSI color/escape sequences from CLI output */
function stripAnsi(str: string): string {
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "");
}

export class CLIBackend {
    private adrScript: string;
    private chainDir: string;
    private adrDir: string;

    constructor(private repoPath: string) {
        this.adrScript = join(repoPath, "scripts", "adr");
        this.chainDir = join(repoPath, ".chain");
        this.adrDir = join(repoPath, "adr");
    }

    // ─────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────

    private async runCLI(args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
        try {
            const { stdout, stderr } = await execFileAsync("bash", [this.adrScript, ...args], {
                cwd: this.repoPath,
                timeout: timeoutMs,
                env: { ...process.env, ADR_ROOT: this.repoPath, NO_COLOR: "1" },
            });
            return { stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), code: 0 };
        } catch (error: any) {
            return {
                stdout: stripAnsi(error.stdout || ""),
                stderr: stripAnsi(error.stderr || error.message || ""),
                code: error.code ?? 1,
            };
        }
    }

    private async runPython(module: string, args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
        const modulePath = join(this.chainDir, module);
        try {
            const { stdout, stderr } = await execFileAsync("python3.13", [modulePath, ...args], {
                cwd: this.repoPath,
                timeout: timeoutMs,
                env: { ...process.env, PYTHONPATH: this.chainDir },
            });
            return { stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), code: 0 };
        } catch (error: any) {
            return {
                stdout: stripAnsi(error.stdout || ""),
                stderr: stripAnsi(error.stderr || error.message || ""),
                code: error.code ?? 1,
            };
        }
    }

    /** Try to parse JSON from output, falling back to raw text */
    private tryParseJSON(text: string): any {
        // Find the first { or [ and try parsing from there
        const jsonStart = text.search(/[{\[]/);
        if (jsonStart >= 0) {
            try {
                return JSON.parse(text.slice(jsonStart));
            } catch {
                // fall through
            }
        }
        return null;
    }

    // ─────────────────────────────────────────────
    // ADR CRUD (delegating to CLI)
    // ─────────────────────────────────────────────

    async list(status?: string, project?: string): Promise<Array<{ id: string; title: string; status: string; date: string }>> {
        const args = ["list", "-f", "json"];
        if (status) args.push("-s", status);
        if (project) args.push("-p", project);

        const result = await this.runCLI(args);
        const lines = result.stdout.trim().split("\n").filter(l => l.startsWith("{"));
        return lines.map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    async get(id: string): Promise<string | null> {
        // Read raw file (avoid bat/glow formatting from cmd_show)
        const statuses = ["proposed", "accepted", "superseded", "rejected", "deprecated"];
        for (const status of statuses) {
            const filePath = join(this.adrDir, status, `${id}.md`);
            if (existsSync(filePath)) {
                return readFile(filePath, "utf-8");
            }
        }
        return null;
    }

    async search(query: string, statusFilter?: string): Promise<Array<{ id: string; title: string; status: string; date: string }>> {
        // Use the parser for real search when available
        const all = await this.list(statusFilter);
        const lowerQuery = query.toLowerCase();
        const results: typeof all = [];

        for (const adr of all) {
            if (adr.title.toLowerCase().includes(lowerQuery) || adr.id.toLowerCase().includes(lowerQuery)) {
                results.push(adr);
                continue;
            }
            // Check file content
            const content = await this.get(adr.id);
            if (content && content.toLowerCase().includes(lowerQuery)) {
                results.push(adr);
            }
        }
        return results;
    }

    async accept(id: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runCLI(["accept", id], 60_000);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    async supersede(oldId: string, newId: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runCLI(["supersede", oldId, newId], 30_000);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    async getNextId(): Promise<string> {
        const all = await this.list();
        const ids = all
            .map(a => parseInt(a.id.replace("ADR-", ""), 10))
            .filter(n => !isNaN(n));
        const maxId = ids.length > 0 ? Math.max(...ids) : 0;
        return `ADR-${String(maxId + 1).padStart(4, "0")}`;
    }

    // ─────────────────────────────────────────────
    // Blockchain / Chain
    // ─────────────────────────────────────────────

    async chainStatus(): Promise<{ raw: string; parsed: Record<string, string> | null }> {
        const result = await this.runPython("chain_manager.py", ["status"]);
        const parsed: Record<string, string> = {};
        for (const line of result.stdout.split("\n")) {
            const match = line.match(/^\s+(\w[\w\s]*):\s+(.+)$/);
            if (match) parsed[match[1].trim().toLowerCase().replace(/\s+/g, "_")] = match[2].trim();
        }
        return { raw: result.stdout, parsed: Object.keys(parsed).length > 0 ? parsed : null };
    }

    async chainVerify(): Promise<{ raw: string; success: boolean; blockResults: Array<{ block: number; adr: string; status: string }> }> {
        const result = await this.runPython("chain_manager.py", ["verify"], 60_000);
        const blocks: Array<{ block: number; adr: string; status: string }> = [];
        const regex = /Block\s+(\d+)\s+\((\S+)\s*\):\s*(PASS|FAIL)/g;
        let m;
        while ((m = regex.exec(result.stdout)) !== null) {
            blocks.push({ block: parseInt(m[1]), adr: m[2], status: m[3] });
        }
        const allPass = blocks.every(b => b.status === "PASS");
        return { raw: result.stdout, success: allPass && result.code === 0, blockResults: blocks };
    }

    async chainProve(adrId: string): Promise<{ raw: string; proof: any | null }> {
        const result = await this.runPython("merkle_tree.py", ["prove", adrId]);
        const proof = this.tryParseJSON(result.stdout);
        return { raw: result.stdout, proof };
    }

    async chainSign(adrId: string, signer: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runPython("chain_manager.py", ["sign", adrId, "--signer", signer]);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    // ─────────────────────────────────────────────
    // Governance
    // ─────────────────────────────────────────────

    async validate(adrId?: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const args = adrId ? ["validate", adrId] : ["validate"];
        const result = await this.runCLI(args, 60_000);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    async governanceRules(): Promise<any> {
        const govPath = join(this.repoPath, ".governance", "governance.yaml");
        if (!existsSync(govPath)) return null;
        const content = await readFile(govPath, "utf-8");
        return content;
    }

    // ─────────────────────────────────────────────
    // Provenance
    // ─────────────────────────────────────────────

    async provenanceTrace(adrId: string): Promise<{ raw: string; trace: any | null }> {
        const provPath = join(this.chainDir, "provenance", `${adrId}.json`);
        if (existsSync(provPath)) {
            const content = await readFile(provPath, "utf-8");
            try {
                return { raw: content, trace: JSON.parse(content) };
            } catch {
                return { raw: content, trace: null };
            }
        }
        // Fallback to CLI
        const result = await this.runPython("provenance.py", ["show", adrId]);
        const trace = this.tryParseJSON(result.stdout);
        return { raw: result.stdout, trace };
    }

    // ─────────────────────────────────────────────
    // Snapshots
    // ─────────────────────────────────────────────

    async snapshotCreate(): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runPython("snapshot_manager.py", ["create"], 60_000);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    async snapshotLatest(): Promise<{ raw: string; snapshot: any | null }> {
        const snapshotDir = join(this.chainDir, "snapshots");
        if (!existsSync(snapshotDir)) return { raw: "No snapshots directory", snapshot: null };

        const files = await readdir(snapshotDir);
        const snapshots = files.filter(f => f.startsWith("snapshot_") && f.endsWith(".json")).sort();
        if (snapshots.length === 0) return { raw: "No snapshots found", snapshot: null };

        const latest = snapshots[snapshots.length - 1];
        const content = await readFile(join(snapshotDir, latest), "utf-8");
        try {
            return { raw: content, snapshot: JSON.parse(content) };
        } catch {
            return { raw: content, snapshot: null };
        }
    }

    // ─────────────────────────────────────────────
    // Economics
    // ─────────────────────────────────────────────

    async economicsReport(): Promise<{ raw: string; metrics: any | null }> {
        const result = await this.runPython("economics.py", ["report"]);
        // Also read the generated JSON
        const metricsPath = join(this.chainDir, "economics", "metrics.json");
        if (existsSync(metricsPath)) {
            const content = await readFile(metricsPath, "utf-8");
            try {
                return { raw: result.stdout, metrics: JSON.parse(content) };
            } catch {
                return { raw: result.stdout, metrics: null };
            }
        }
        return { raw: result.stdout, metrics: null };
    }

    // ─────────────────────────────────────────────
    // SBOM
    // ─────────────────────────────────────────────

    async sbomStatus(): Promise<{ raw: string; sbom: any | null }> {
        const result = await this.runPython("sbom_manager.py", ["show"]);
        const sbom = this.tryParseJSON(result.stdout);
        return { raw: result.stdout, sbom };
    }

    async sbomGenerate(): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runPython("sbom_manager.py", ["generate"], 60_000);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    // ─────────────────────────────────────────────
    // Pre-signing
    // ─────────────────────────────────────────────

    async preSign(adrId: string, signer: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
        const result = await this.runPython("pre_sign.py", ["sign", adrId, "--signer", signer]);
        return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    }

    // ─────────────────────────────────────────────
    // Relations (graph)
    // ─────────────────────────────────────────────

    async relations(adrId: string): Promise<Record<string, any>> {
        const content = await this.get(adrId);
        if (!content) return { error: `ADR not found: ${adrId}` };

        const relations: Record<string, any> = {
            supersedes: [],
            superseded_by: null,
            related_to: [],
            implements: [],
            enables: [],
        };

        // Parse from YAML frontmatter
        const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatter) {
            const fm = frontmatter[1];
            // supersedes list
            const supersedes = fm.match(/supersedes:\s*\n((?:\s+-\s*.+\n)*)/);
            if (supersedes) {
                relations.supersedes = [...supersedes[1].matchAll(/-\s*"?([^"\n]+)"?/g)].map(m => m[1].trim());
            }
            // superseded_by
            const supersededBy = fm.match(/superseded_by:\s*"?([^"\n]+)"?/);
            if (supersededBy && supersededBy[1].trim() !== "null") {
                relations.superseded_by = supersededBy[1].trim();
            }
            // related_to list
            const relatedTo = fm.match(/related_to:\s*\n((?:\s+-\s*.+\n)*)/);
            if (relatedTo) {
                relations.related_to = [...relatedTo[1].matchAll(/-\s*"?([^"\n]+)"?/g)].map(m => m[1].trim());
            }
            // enables list
            const enables = fm.match(/enables:\s*\n((?:\s+-\s*.+\n)*)/);
            if (enables) {
                relations.enables = [...enables[1].matchAll(/-\s*"?([^"\n]+)"?/g)].map(m => m[1].trim());
            }
        }
        return relations;
    }

    // ─────────────────────────────────────────────
    // Lifecycle suggestions (reuse existing logic)
    // ─────────────────────────────────────────────

    async suggestLifecycleChanges(): Promise<Array<{ adrId: string; action: string; reason: string }>> {
        const proposed = await this.list("proposed");
        const suggestions: Array<{ adrId: string; action: string; reason: string }> = [];

        for (const adr of proposed) {
            const content = await this.get(adr.id);
            if (!content) continue;

            // Check task completion
            const taskLines = content.match(/^- \[[ x]\] .+$/gm) || [];
            const completed = taskLines.filter(l => l.startsWith("- [x]")).length;
            if (taskLines.length > 0 && completed === taskLines.length) {
                suggestions.push({
                    adrId: adr.id,
                    action: "accept",
                    reason: `All ${taskLines.length} implementation tasks completed`,
                });
            }

            // Check stale (>60 days)
            if (adr.date) {
                const created = new Date(adr.date);
                const daysSince = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince > 60) {
                    suggestions.push({
                        adrId: adr.id,
                        action: "review",
                        reason: `Proposed for ${Math.floor(daysSince)} days`,
                    });
                }
            }
        }
        return suggestions;
    }
}
