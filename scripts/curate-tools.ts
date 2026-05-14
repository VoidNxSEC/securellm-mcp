/**
 * Tool Curation — ADR-0059
 * Post-processes compiled JS to filter out 25 deprecated tools.
 * Usage: npx tsx scripts/curate-tools.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";

const REMOVED_TOOLS = [
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
];

const DRY_RUN = process.argv.includes("--dry-run");
const BUILD_PATH = "build/src/index.js";

let content = readFileSync(BUILD_PATH, "utf-8");

// Count before
const before = (content.match(/name:\s*"([^"]+)"/g) || []).length;

// Find catalog end marker
const marker = "// end buildToolCatalog";
const idx = content.indexOf(marker);
if (idx === -1) {
  console.error("ERROR: '// end buildToolCatalog' marker not found in build output.");
  console.error(
    "Add '// end buildToolCatalog' comment after the return array in buildToolCatalog()."
  );
  process.exit(1);
}

// Check if already curated
if (content.includes("ADR-0059 curation")) {
  console.log("ADR-0059 curation already applied. Skipping.");
  process.exit(0);
}

// Insert .filter() before the closing bracket
const filterCode =
  `.filter(function(t){` +
  `/* ADR-0059 curation */` +
  `var r=${JSON.stringify(REMOVED_TOOLS)};` +
  `return r.indexOf(t.name)===-1;` +
  `})`;

// Find the '];' that closes the array, then insert filter after it
// The marker is on the line with '] as ExtendedTool[]; // end buildToolCatalog'
// We need to insert the filter BEFORE the ']'
const lines = content.split("\n");
const markerLine = lines.findIndex((l) => l.includes(marker));
if (markerLine === -1) {
  console.error("ERROR: marker not found in lines");
  process.exit(1);
}
// Insert filter on a new line before the closing line
lines.splice(markerLine, 1, lines[markerLine].replace("];", filterCode + "];"));
content = lines.join("\n");

// Count after
const after = (content.match(/name:\s*"([^"]+)"/g) || []).length;

console.log(`ADR-0059 Tool Curation — ${DRY_RUN ? "DRY RUN" : "APPLIED"}`);
console.log(`  Before: ${before} tools`);
console.log(`  After:  ${after} tools`);
console.log(`  Delta:  ${before - after} removed`);

if (!DRY_RUN) {
  writeFileSync(BUILD_PATH, content, "utf-8");
  console.log("  ✅ Written to build/src/index.js");
} else {
  console.log("  (dry run — no changes written)");
}
