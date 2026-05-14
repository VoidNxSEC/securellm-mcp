/**
 * ADR-0057: Generate .mcp.json manifest from tool definitions.
 *
 * Strategy: reads all tool definition files, extracts name fields,
 * and applies the ADR-0059 curation filter.
 *
 * Usage:
 *   npx tsx scripts/generate-mcp-manifest.ts          — generate .mcp.json
 *   npx tsx scripts/generate-mcp-manifest.ts --check  — validate (CI gate)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src", "tools");
const MCP_JSON_PATH = join(__dirname, "..", ".mcp.json");
const CHECK_MODE = process.argv.includes("--check");

// ADR-0059: tools removed from catalog
const CURATION_REMOVED = new Set([
  "thermal_check",
  "thermal_forensics",
  "thermal_warroom",
  "rebuild_safety_check",
  "laptop_verdict",
  "full_investigation",
  "force_cooldown",
  "reset_performance",
  "emergency_abort",
  "emergency_cooldown",
  "emergency_nuke",
  "emergency_swap",
  "browser_launch_advanced",
  "browser_extract_data",
  "browser_interact_form",
  "browser_monitor_changes",
  "osint_dns",
  "osint_subdomains",
  "osint_portscan",
  "web_crawl",
  "tech_news_search",
  "crypto_key_generate",
  "build_and_test",
  "security_audit",
  "browser_search_aggregate",
  // Also filter resource-like names
  "Hacker News",
  "Reddit r/NixOS",
  "AI Agent",
]);

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith(".")) continue;
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

// Extract name fields from TypeScript tool definitions
const toolNames = new Set<string>();
const toolFiles = collectFiles(SRC_DIR);

for (const file of toolFiles) {
  try {
    const content = readFileSync(file, "utf-8");
    // Match patterns like: name: "tool_name" or name: 'tool_name'
    const regex = /name:\s*["']([a-z][a-z0-9_]+)["']/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      // Filter out non-tool names
      if (name.length > 2 && !name.startsWith("_") && !CURATION_REMOVED.has(name)) {
        toolNames.add(name);
      }
    }
  } catch {
    // Skip files that can't be read
  }
}

// Also add tools defined inline in index.ts
try {
  const indexContent = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");
  const regex = /name:\s*["']([a-z][a-z0-9_]+)["']/g;
  let match;
  while ((match = regex.exec(indexContent)) !== null) {
    const name = match[1];
    if (name.length > 2 && !name.startsWith("_") && !CURATION_REMOVED.has(name)) {
      // Skip non-tool names that leak through
      if (!["securellm", "default", "architect"].includes(name)) {
        toolNames.add(name);
      }
    }
  }
} catch {
  // ok
}

const toolList = [...toolNames].sort();

if (CHECK_MODE) {
  if (!existsSync(MCP_JSON_PATH)) {
    console.error("ERROR: .mcp.json not found");
    process.exit(1);
  }
  const mcpJson = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8"));
  const declared = new Set(mcpJson.capabilities?.tools?.names || []);
  const actual = new Set(toolList);

  const missing = [...actual].filter((t) => !declared.has(t));
  const extra = [...declared].filter((t) => !actual.has(t));

  if (missing.length > 0 || extra.length > 0) {
    if (missing.length > 0) console.error(`  Missing from .mcp.json: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  Extra in .mcp.json (removed?): ${extra.join(", ")}`);
    console.error(`ERROR: manifest drift — .mcp.json=${declared.size} vs source=${actual.size}`);
    process.exit(1);
  }

  console.log(`✅ .mcp.json in sync: ${actual.size} tools`);
  process.exit(0);
}

// Generate
const mcpJson = {
  mcpServers: {
    securellm: {
      command: "node",
      args: ["build/src/index.js"],
      env: {
        PROJECT_ROOT: "${PROJECT_ROOT:-.}",
        ENABLE_KNOWLEDGE: "true",
        LLAMA_CPP_URL: "${LLAMA_CPP_URL:-http://localhost:8081}",
      },
    },
  },
  capabilities: {
    tools: {
      count: toolList.length,
      names: toolList,
    },
  },
  _generated: {
    by: "scripts/generate-mcp-manifest.ts",
    adr: "ADR-0057",
    at: new Date().toISOString(),
    curation: "ADR-0059 (25 tools removed)",
  },
};

writeFileSync(MCP_JSON_PATH, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
console.log(`✅ .mcp.json generated: ${toolList.length} tools (after ADR-0059 curation)`);
console.log(`   ${toolList.slice(0, 10).join(", ")}...`);
