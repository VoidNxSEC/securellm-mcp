// src/tools/bridge-ux.ts
// SecureLLM Bridge — UX Design Mode
//
// Declarative UX specification tools for AI agents.
// Agents receive complete design context (colors, typography, layout)
// and generate components that follow the Bridge design system exactly.

import * as fs from "fs/promises";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ExtendedTool } from "../types/mcp-tool-extensions.js";

// ── Types ───────────────────────────────────────────────────────────

interface UxSpec {
  name: string;
  version: string;
  extends?: string;
  philosophy: {
    tone: string;
    purpose: string;
    memorable_element: string;
    target_audience: string[];
  };
  typography: Record<string, unknown>;
  color_system: Record<string, unknown>;
  layout_rules: Record<string, unknown>;
  animation: Record<string, unknown>;
  constraints: Record<string, unknown>;
  anti_patterns: string[];
  components?: Record<string, unknown>;
  validation_checklist?: string[];
}

// ── Config ──────────────────────────────────────────────────────────

const UX_SPECS_DIR =
  process.env.BRIDGE_UX_SPECS_DIR ||
  path.resolve(process.env.PROJECT_ROOT || process.cwd(), "ux", "specs");

// ── Tool Definitions ────────────────────────────────────────────────

export const uxTools: ExtendedTool[] = [
  {
    name: "ux_list_specs",
    description:
      "List all available UX design specifications for SecureLLM Bridge components",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "ux_get_spec",
    description:
      "Retrieve a complete UX specification for generating UI components with precise design rules. Use format='prompt' to get an optimized agent prompt.",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        spec_name: {
          type: "string",
          description: "Name of the UX spec (e.g., 'bridge-gateway', 'bridge-security')",
        },
        format: {
          type: "string",
          enum: ["yaml", "json", "markdown", "prompt"],
          description:
            "Output format. 'prompt' generates an optimized agent prompt for component generation.",
          default: "markdown",
        },
      },
      required: ["spec_name"],
    },
  },
  {
    name: "ux_generate_prompt",
    description:
      "Generate an optimized AI agent prompt for creating a specific UI component following Bridge design specs precisely",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        spec_name: {
          type: "string",
          description: "UX spec name (e.g., 'bridge-gateway')",
        },
        component: {
          type: "string",
          description:
            "Component to generate (e.g., 'provider_card', 'topology_graph', 'rate_limit_bucket')",
        },
        requirements: {
          type: "string",
          description: "Additional specific requirements for this component instance",
        },
      },
      required: ["spec_name", "component"],
    },
  },
  {
    name: "ux_validate_component",
    description:
      "Validate a generated component against Bridge UX specifications — checks colors, fonts, layout, and anti-patterns",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        spec_name: {
          type: "string",
          description: "UX spec to validate against",
        },
        component_type: {
          type: "string",
          description: "Component type being validated (e.g., 'provider_card')",
        },
        code: {
          type: "string",
          description: "The generated component source code to validate",
        },
      },
      required: ["spec_name", "component_type", "code"],
    },
  },
  {
    name: "ux_design_system",
    description:
      "Get the complete Bridge Design System reference — colors, typography, spacing, and component patterns",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["colors", "typography", "layout", "animation", "components", "all"],
          description: "Which section of the design system to retrieve",
          default: "all",
        },
      },
    },
  },
  {
    name: "ux_create_spec",
    description:
      "Create a new UX specification from a template for a Bridge component or view",
    defer_loading: true,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the new UX spec (kebab-case, e.g., 'my-dashboard')",
        },
        purpose: {
          type: "string",
          description: "What this component or view does",
        },
        tone: {
          type: "string",
          description:
            "Aesthetic direction (e.g., 'terminal-native', 'industrial precision')",
          default: "industrial precision",
        },
      },
      required: ["name", "purpose"],
    },
  },
];

// ── Spec Loading ────────────────────────────────────────────────────

async function loadSpec(name: string): Promise<UxSpec> {
  const specPath = path.join(UX_SPECS_DIR, `${name}.yml`);
  try {
    const content = await fs.readFile(specPath, "utf-8");
    return parseYaml(content) as UxSpec;
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `UX spec not found: ${name}. Available specs are in ${UX_SPECS_DIR}`);
  }
}

async function listSpecFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(UX_SPECS_DIR);
    return files
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .map((f) => path.basename(f, path.extname(f)));
  } catch {
    return [];
  }
}

// ── Formatters ──────────────────────────────────────────────────────

function specToMarkdown(spec: UxSpec): string {
  const out: string[] = [
    `# ${spec.name} — UX Specification`,
    `**Version**: ${spec.version}`,
    spec.extends ? `**Extends**: ${spec.extends}` : "",
    "",
    "## 🎯 Design Philosophy",
    `- **Tone**: ${spec.philosophy.tone}`,
    `- **Purpose**: ${spec.philosophy.purpose}`,
    `- **Unforgettable**: ${spec.philosophy.memorable_element}`,
    `- **Audience**: ${spec.philosophy.target_audience.join(", ")}`,
    "",
    "## 🔤 Typography",
    `| Role | Font |`,
    `|------|------|`,
    `| Display | ${spec.typography.display_font} |`,
    `| Monospace | ${spec.typography.mono_font} |`,
    `| Body | ${spec.typography.body_font} |`,
    ...((spec.typography.rules as string[]) || []).map((r) => `- ${r}`),
    "",
    "## 🎨 Color System (Dark Mode)",
    "### Base",
    ...Object.entries(spec.color_system.base as Record<string, string>).map(
      ([k, v]) => `- \`${k}\`: \`${v}\``,
    ),
    "### Accents",
    ...Object.entries(spec.color_system.accents as Record<string, string>).map(
      ([k, v]) => `- \`${k}\`: \`${v}\``,
    ),
    "### Semantic",
    ...Object.entries(spec.color_system.semantic as Record<string, string>).map(
      ([k, v]) => `- \`${k}\`: \`${v}\``,
    ),
    "",
    "## 📐 Layout",
    `- Grid: ${(spec.layout_rules.grid as any).columns} cols, ${(spec.layout_rules.grid as any).gutter} gutters`,
    `- Direction: ${spec.layout_rules.direction}`,
    `- Section margin: ${(spec.layout_rules.spacing as any).section_margin}`,
    `- Card padding: ${(spec.layout_rules.spacing as any).card_padding}`,
    "",
    "## 🎬 Animation",
    `- Page load: ${(spec.animation as any).page_load.strategy} (stagger: ${(spec.animation as any).page_load.stagger}s)`,
    `- Hover: ${(spec.animation as any).interactions.hover_effect} (${(spec.animation as any).interactions.hover_duration}ms)`,
    "",
    "## 🚫 Anti-Patterns",
    ...spec.anti_patterns.map((a) => `- ❌ ${a}`),
    "",
  ];

  if (spec.components) {
    out.push("## 🧩 Components");
    for (const [name, comp] of Object.entries(spec.components)) {
      out.push(`### ${name}`, `${(comp as any).description || ""}`, "");
      if ((comp as any).structure) {
        out.push("```", (comp as any).structure, "```", "");
      }
    }
  }

  if (spec.validation_checklist) {
    out.push(
      "## ✅ Validation Checklist",
      ...spec.validation_checklist.map((c) => `- [ ] ${c}`),
      "",
    );
  }

  return out.join("\n");
}

function specToPrompt(spec: UxSpec): string {
  return [
    "# SECURELLM BRIDGE — UX COMPONENT SPECIFICATION",
    "",
    "## Design Identity",
    `AESTHETIC: ${spec.philosophy.tone}`,
    `PURPOSE: ${spec.philosophy.purpose}`,
    `UNFORGETTABLE: ${spec.philosophy.memorable_element}`,
    "",
    "## Typography",
    `DISPLAY: ${spec.typography.display_font} (headers, nav)`,
    `MONO: ${spec.typography.mono_font} (data, code, metrics)`,
    `BODY: ${spec.typography.body_font} (long text only)`,
    ...((spec.typography.rules as string[]) || []).map((r) => `RULE: ${r}`),
    "",
    "## Colors (DARK MODE ONLY)",
    ...Object.entries(spec.color_system.base as Record<string, string>).map(
      ([k, v]) => `--${k}: ${v}`,
    ),
    ...Object.entries(spec.color_system.accents as Record<string, string>).map(
      ([k, v]) => `--accent-${k}: ${v}`,
    ),
    ...Object.entries(spec.color_system.semantic as Record<string, string>).map(
      ([k, v]) => `--semantic-${k}: ${v}`,
    ),
    "",
    "## Layout",
    `GRID: ${(spec.layout_rules.grid as any).columns}-col, ${(spec.layout_rules.grid as any).gutter} gutters`,
    `SPACING: ${(spec.layout_rules.spacing as any).section_margin} sections, ${(spec.layout_rules.spacing as any).card_padding} cards`,
    `DIRECTION: ${spec.layout_rules.direction}`,
    "",
    "## Animation",
    `LOAD: ${(spec.animation as any).page_load.strategy} (${(spec.animation as any).page_load.stagger}s stagger)`,
    `HOVER: ${(spec.animation as any).interactions.hover_effect} (${(spec.animation as any).interactions.hover_duration}ms)`,
    "",
    "## Tech Constraints",
    ...Object.entries(spec.constraints).map(([k, v]) => {
      if (typeof v === "object") return `${k}: ${JSON.stringify(v)}`;
      return `${k}: ${v}`;
    }),
    "",
    "## ANTI-PATTERNS (DO NOT DO)",
    ...spec.anti_patterns.map((a) => `❌ ${a}`),
    "",
    "---",
    "IMPORTANT: Follow this specification EXACTLY.",
    "Do not use generic AI aesthetics. Do not default to Inter/Roboto.",
    "Use the specified color palette precisely. Dark mode is mandatory.",
    "Generate production-ready React + Tailwind + TypeScript code.",
    "Include Framer Motion for animations. Use Lucide React for icons.",
  ].join("\n");
}

// ── Handlers ────────────────────────────────────────────────────────

export async function handleUxListSpecs(): Promise<{ content: { type: string; text: string }[] }> {
  const specs = await listSpecFiles();
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { specs, count: specs.length, specs_dir: UX_SPECS_DIR },
          null,
          2,
        ),
      },
    ],
  };
}

export async function handleUxGetSpec(args: {
  spec_name: string;
  format?: string;
}): Promise<{ content: { type: string; text: string }[] }> {
  const spec = await loadSpec(args.spec_name);
  let text: string;

  switch (args.format) {
    case "yaml": {
      const specPath = path.join(UX_SPECS_DIR, `${args.spec_name}.yml`);
      text = await fs.readFile(specPath, "utf-8");
      break;
    }
    case "json":
      text = JSON.stringify(spec, null, 2);
      break;
    case "prompt":
      text = specToPrompt(spec);
      break;
    case "markdown":
    default:
      text = specToMarkdown(spec);
      break;
  }

  return { content: [{ type: "text", text }] };
}

export async function handleUxGeneratePrompt(args: {
  spec_name: string;
  component: string;
  requirements?: string;
}): Promise<{ content: { type: string; text: string }[] }> {
  const spec = await loadSpec(args.spec_name);
  const compDef = spec.components?.[args.component];

  let prompt = specToPrompt(spec);
  prompt += `\n\n## COMPONENT TO BUILD: ${args.component}\n`;

  if (compDef) {
    prompt += `\n${(compDef as any).description}\n`;
    if ((compDef as any).structure) {
      prompt += `\nLAYOUT:\n${(compDef as any).structure}\n`;
    }
    if ((compDef as any).states) {
      prompt += `\nSTATES:\n${Object.entries((compDef as any).states)
        .map(([s, d]) => `  ${s}: ${d}`)
        .join("\n")}\n`;
    }
  }

  if (args.requirements) {
    prompt += `\nADDITIONAL REQUIREMENTS:\n${args.requirements}\n`;
  }

  prompt += [
    "",
    "## OUTPUT EXPECTED",
    "1. Complete React + TypeScript component file",
    "2. Tailwind CSS classes (no inline styles)",
    "3. Framer Motion animations where specified",
    "4. TypeScript interfaces for all props",
    "5. Responsive design (mobile-first)",
    "6. WCAG AA accessible",
    "",
    "Generate production-ready code now.",
  ].join("\n");

  return { content: [{ type: "text", text: prompt }] };
}

export async function handleUxValidateComponent(args: {
  spec_name: string;
  component_type: string;
  code: string;
}): Promise<{ content: { type: string; text: string }[] }> {
  const spec = await loadSpec(args.spec_name);
  const results: string[] = [];
  const colors = spec.color_system as any;

  // Check 1: Dark background color
  const bgPrimary = colors.base?.bg_primary as string | undefined;
  if (bgPrimary && args.code.includes(bgPrimary)) {
    results.push("✅ Background color matches spec");
  } else if (bgPrimary) {
    results.push(`⚠️  Background color ${bgPrimary} not found`);
  }

  // Check 2: Display font
  const displayFont = spec.typography.display_font as string;
  if (args.code.includes(displayFont)) {
    results.push(`✅ Display font "${displayFont}" found`);
  } else {
    results.push(`⚠️  Display font "${displayFont}" not found — may default to Inter`);
  }

  // Check 3: Mono font for data
  const monoFont = spec.typography.mono_font as string;
  if (args.code.includes(monoFont)) {
    results.push(`✅ Mono font "${monoFont}" found`);
  } else {
    results.push(`⚠️  Mono font "${monoFont}" not found — metrics need monospace`);
  }

  // Check 4: Accent color used
  const accentPrimary = colors.accents?.primary as string | undefined;
  if (accentPrimary && args.code.includes(accentPrimary)) {
    results.push(`✅ Accent color "${accentPrimary}" used`);
  } else if (accentPrimary) {
    results.push(`⚠️  Accent color "${accentPrimary}" not found`);
  }

  // Check 5: Anti-patterns
  for (const anti of spec.anti_patterns) {
    const keyword = anti.split(" ").slice(0, 3).join(" ").toLowerCase();
    if (args.code.toLowerCase().includes(keyword)) {
      results.push(`🔴 ANTI-PATTERN DETECTED: "${anti}"`);
    }
  }

  // Check 6: Component-specific validation
  const comp = spec.components?.[args.component_type];
  if (comp) {
    results.push(`📋 Validating against ${args.component_type} spec:`);
    results.push(`  Expected: ${(comp as any).description}`);
    if ((comp as any).layout) {
      results.push(`  Layout: ${JSON.stringify((comp as any).layout)}`);
    }
  } else {
    results.push(`ℹ️  No specific component definition for "${args.component_type}" in spec`);
  }

  results.push("", "---", "Validation complete. Fix warnings before proceeding.");

  return { content: [{ type: "text", text: results.join("\n") }] };
}

export async function handleUxDesignSystem(args: {
  section?: string;
}): Promise<{ content: { type: string; text: string }[] }> {
  const spec = await loadSpec("bridge-gateway");
  const section = args.section || "all";

  let text: string;

  switch (section) {
    case "colors":
      text = [
        "# Bridge Design System — Colors",
        "",
        "## Base",
        ...Object.entries(spec.color_system.base as Record<string, string>).map(
          ([k, v]) => `- \`--${k}\`: \`${v}\``,
        ),
        "",
        "## Accents",
        ...Object.entries(spec.color_system.accents as Record<string, string>).map(
          ([k, v]) => `- \`--accent-${k}\`: \`${v}\``,
        ),
        "",
        "## Semantic",
        ...Object.entries(spec.color_system.semantic as Record<string, string>).map(
          ([k, v]) => `- \`--semantic-${k}\`: \`${v}\``,
        ),
        "",
        "## Tailwind Config",
        "```js",
        "colors: {",
        "  bridge: {",
        `    primary: '${(spec.color_system.accents as any).primary}',`,
        `    secondary: '${(spec.color_system.accents as any).secondary}',`,
        "  }",
        "}",
        "```",
      ].join("\n");
      break;

    case "typography":
      text = [
        "# Bridge Design System — Typography",
        "",
        "## Font Stack",
        `- Display: \`${spec.typography.display_font}\``,
        `- Monospace: \`${spec.typography.mono_font}\``,
        `- Body: \`${spec.typography.body_font}\``,
        "",
        "## Rules",
        ...((spec.typography.rules as string[]) || []).map((r) => `- ${r}`),
        "",
        "## Tailwind Config",
        "```js",
        "fontFamily: {",
        `  display: ['${spec.typography.display_font}', 'sans-serif'],`,
        `  mono: ['${spec.typography.mono_font}', 'monospace'],`,
        "}",
        "```",
      ].join("\n");
      break;

    case "layout":
      text = JSON.stringify(spec.layout_rules, null, 2);
      break;

    case "animation":
      text = JSON.stringify(spec.animation, null, 2);
      break;

    case "components":
      text = specToMarkdown(spec);
      break;

    case "all":
    default:
      text = specToMarkdown(spec);
      break;
  }

  return { content: [{ type: "text", text }] };
}

export function handleUxCreateSpec(args: {
  name: string;
  purpose: string;
  tone?: string;
}): { content: { type: string; text: string }[] } {
  const tone = args.tone || "industrial precision";
  const template = `# ${args.name} — UX Specification
name: ${args.name}
version: 0.1.0
extends: bridge-gateway

philosophy:
  tone: "${tone}"
  purpose: "${args.purpose}"
  memorable_element: "Describe the one unforgettable visual element"
  target_audience:
    - "Primary user persona"

typography:
  display_font: "Space Grotesk"
  mono_font: "JetBrains Mono"
  body_font: "Inter Variable"
  scale_ratio: 1.25
  weights: [400, 500, 600, 700]
  rules:
    - "Monospace for all data and metrics"

color_system:
  mode: "dark"
  base:
    bg_primary: "#0A0E1A"
    bg_secondary: "#111827"
    bg_tertiary: "#1A2236"
  text:
    primary: "#E2E8F0"
    secondary: "#94A3B8"
    tertiary: "#64748B"
  accents:
    primary: "#6366F1"
    secondary: "#06B6D4"
  semantic:
    online: "#22C55E"
    degraded: "#F59E0B"
    offline: "#EF4444"

layout_rules:
  grid:
    columns: 12
    gutter: "24px"
  asymmetry: true
  direction: "left-heavy"
  spacing:
    section_margin: "3rem"
    card_padding: "1.5rem"
    element_gap: "1rem"

animation:
  page_load:
    strategy: "staggered_reveal"
    base_delay: 0.2
    stagger: 0.08
  interactions:
    hover_duration: 200
    hover_effect: "glow + scale(1.01)"

constraints:
  framework: "React 18+"
  styling: "Tailwind CSS v3+"
  animation_lib: "Framer Motion"
  state: "Zustand"
  icons: "Lucide React"
  accessibility: "WCAG AA"

anti_patterns:
  - "generic card grids"
  - "low-contrast color schemes"

components:
  # Define your components here following bridge-gateway patterns
  # Example:
  # my_component:
  #   description: "What this component does"
  #   structure: |
  #     ┌──────────────────┐
  #     │ Component layout │
  #     └──────────────────┘

validation_checklist:
  - "Aesthetic is distinctive"
  - "Colors match spec"
  - "Fonts match spec"
  - "Animations are polished"
  - "Responsive at all breakpoints"
  - "WCAG AA compliant"
`;

  return {
    content: [
      {
        type: "text",
        text: [
          `# UX Spec Template: ${args.name}`,
          "",
          "Save this to `ux/specs/NAME.yml` and customize.",
          "Load with: `ux_get_spec('NAME')`",
          "Generate component prompt with: `ux_generate_prompt('NAME', 'component_name')`",
          "",
          "```yaml",
          template,
          "```",
        ].join("\n"),
      },
    ],
  };
}
