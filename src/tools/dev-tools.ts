import { z } from "zod";
import type { ExtendedTool } from "../types/mcp-tool-extensions.js";
import { zodToMcpSchema } from "../utils/schema-converter.js";
import * as path from "path";
import * as fs from "fs";
import { stringifyGeneric } from "../utils/json-schemas.js";
import { validatePath } from "../security/path-validator.js";
import { execa } from "execa";

// --- Schemas ---

const lintCodeSchema = z.object({
  target: z.string().describe("File or directory to lint"),
  fix: z.boolean().optional().default(false).describe("Automatically fix issues"),
});

const formatCodeSchema = z.object({
  target: z.string().describe("File or directory to format"),
  check_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("Check if formatted without modifying"),
});

const runTestsSchema = z.object({
  target: z.string().optional().describe("Specific test file or directory"),
  watch: z
    .boolean()
    .optional()
    .default(false)
    .describe("Run in watch mode (not recommended for MCP)"),
});

const manageGithubActionsSchema = z.object({
  action: z.enum(["list", "trigger", "status", "logs"]),
  workflow: z.string().optional().describe("Workflow file name or ID (required for trigger/logs)"),
  branch: z.string().optional().default("main").describe("Branch to target"),
});

// --- Implementation Helpers ---

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  command: string;
  exitCode: number;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

function resolveTarget(target: string): { resolvedTarget: string; stats: fs.Stats } {
  const resolvedTarget = validatePath(target, process.cwd());
  const stats = fs.statSync(resolvedTarget);
  return { resolvedTarget, stats };
}

function hasPackageJson(startDir: string): boolean {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return true;
    }
    if (current === root) {
      return false;
    }
    current = path.dirname(current);
  }
}

function findFlakeRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    if (fs.existsSync(path.join(current, "flake.nix"))) {
      return current;
    }
    if (current === root) {
      return null;
    }
    current = path.dirname(current);
  }
}

async function detectAndRun(
  command: string,
  args: string[],
  cwd: string = process.cwd(),
  preferNix: boolean = true
) {
  const filteredArgs = args.filter((arg) => arg.length > 0);
  const flakeRoot = preferNix ? findFlakeRoot(cwd) : null;
  const runCommand = flakeRoot ? "nix" : command;
  const runArgs = flakeRoot
    ? ["develop", flakeRoot, "--command", command, ...filteredArgs]
    : filteredArgs;

  const result = await execa(runCommand, runArgs, {
    cwd,
    reject: false,
    preferLocal: true,
    env: flakeRoot
      ? {
          ...process.env,
          PROJECT_ROOT: process.env.PROJECT_ROOT || flakeRoot,
          SECURELLM_MCP_QUIET: "1",
        }
      : process.env,
  });

  return {
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    command: formatCommand(runCommand, runArgs),
    exitCode: result.exitCode ?? 0,
  } satisfies CommandResult;
}

// --- Tool Implementations ---

async function handleLintCode(args: z.infer<typeof lintCodeSchema>) {
  const { target, fix } = args;
  const { resolvedTarget, stats } = resolveTarget(target);
  const ext = path.extname(resolvedTarget);

  let cmd = "";
  let cmdArgs: string[] = [];

  if (stats.isDirectory() || [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    cmd = "eslint";
    cmdArgs = [resolvedTarget, ...(fix ? ["--fix"] : [])];
  } else if ([".py"].includes(ext)) {
    cmd = "ruff";
    cmdArgs = ["check", resolvedTarget, ...(fix ? ["--fix"] : [])];
  } else {
    return {
      content: [{ type: "text", text: `Unsupported file type for linting: ${ext}` }],
      isError: true,
    };
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [
      {
        type: "text",
        text: stringifyGeneric(result),
      },
    ],
    isError: !result.success,
  };
}

async function handleFormatCode(args: z.infer<typeof formatCodeSchema>) {
  const { target, check_only } = args;
  const { resolvedTarget, stats } = resolveTarget(target);
  const ext = path.extname(resolvedTarget);

  let cmd = "";
  let cmdArgs: string[] = [];

  if (
    stats.isDirectory() ||
    [
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
      ".md",
      ".css",
      ".html",
      ".yml",
      ".yaml",
    ].includes(ext)
  ) {
    cmd = "prettier";
    cmdArgs = [check_only ? "--check" : "--write", resolvedTarget];
  } else if ([".py"].includes(ext)) {
    cmd = "black";
    cmdArgs = [...(check_only ? ["--check"] : []), resolvedTarget];
  } else {
    return {
      content: [{ type: "text", text: `Unsupported file type for formatting: ${ext}` }],
      isError: true,
    };
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [
      {
        type: "text",
        text: stringifyGeneric(result),
      },
    ],
    isError: !result.success,
  };
}

async function handleRunTests(args: z.infer<typeof runTestsSchema>) {
  const { target, watch } = args;
  let resolvedTarget: string | undefined;
  let stats: fs.Stats | undefined;

  if (target) {
    const resolved = resolveTarget(target);
    resolvedTarget = resolved.resolvedTarget;
    stats = resolved.stats;
  }

  if (watch) {
    return {
      content: [
        {
          type: "text",
          text: "Watch mode is disabled for MCP to avoid long-lived interactive test processes.",
        },
      ],
      isError: true,
    };
  }

  let cmd = "npm";
  let cmdArgs: string[] = ["test"];

  if (resolvedTarget && stats && !stats.isDirectory() && resolvedTarget.endsWith(".py")) {
    cmd = "pytest";
    cmdArgs = [resolvedTarget];
  } else if (hasPackageJson(resolvedTarget ? path.dirname(resolvedTarget) : process.cwd())) {
    cmdArgs = resolvedTarget ? ["test", "--", resolvedTarget] : ["test"];
  } else {
    return {
      content: [
        {
          type: "text",
          text: "Could not detect a supported test runner. Provide a Python test target or run inside a project with package.json.",
        },
      ],
      isError: true,
    };
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [
      {
        type: "text",
        text: stringifyGeneric({
          ...result,
          summary: result.success ? "Tests passed" : "Tests failed",
        }),
      },
    ],
    isError: !result.success,
  };
}

async function handleGithubActions(args: z.infer<typeof manageGithubActionsSchema>) {
  const { action, workflow, branch } = args;

  const cmd = "gh";
  let cmdArgs: string[] = [];

  switch (action) {
    case "list":
      cmdArgs = ["run", "list", "--limit", "5"];
      break;
    case "status":
      cmdArgs = ["workflow", "list"];
      break;
    case "trigger":
      if (!workflow) throw new Error("Workflow required for trigger");
      cmdArgs = ["workflow", "run", workflow, "--ref", branch || "main"];
      break;
    case "logs":
      if (!workflow) throw new Error("Run ID required for logs (passed in workflow field)");
      cmdArgs = ["run", "view", workflow, "--log"];
      break;
  }

  const result = await detectAndRun(cmd, cmdArgs, process.cwd(), false);
  return {
    content: [{ type: "text", text: stringifyGeneric(result) }],
    isError: !result.success,
  };
}

// --- Exports ---

export const devTools: ExtendedTool[] = [
  {
    name: "lint_code",
    description: "Lint code using ESLint (JS/TS) or Ruff (Python)",
    inputSchema: zodToMcpSchema(lintCodeSchema),
    defer_loading: true,
  },
  {
    name: "format_code",
    description: "Format code using Prettier (JS/TS/Web) or Black (Python)",
    inputSchema: zodToMcpSchema(formatCodeSchema),
    defer_loading: true,
  },
  {
    name: "run_tests",
    description: "Run tests using Vitest/Jest or Pytest",
    inputSchema: zodToMcpSchema(runTestsSchema),
    defer_loading: true,
  },
  {
    name: "github_actions",
    description: "Manage GitHub Actions CI/CD workflows",
    inputSchema: zodToMcpSchema(manageGithubActionsSchema),
    defer_loading: true,
  },
];

export const devToolHandlers = {
  lint_code: handleLintCode,
  format_code: handleFormatCode,
  run_tests: handleRunTests,
  github_actions: handleGithubActions,
};
