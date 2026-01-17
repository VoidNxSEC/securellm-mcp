import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ExtendedTool } from '../types/mcp-tool-extensions.js';
import { zodToMcpSchema } from '../utils/schema-converter.js';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

// --- Schemas ---

const lintCodeSchema = z.object({
  target: z.string().describe('File or directory to lint'),
  fix: z.boolean().optional().default(false).describe('Automatically fix issues'),
});

const formatCodeSchema = z.object({
  target: z.string().describe('File or directory to format'),
  check_only: z.boolean().optional().default(false).describe('Check if formatted without modifying'),
});

const runTestsSchema = z.object({
  target: z.string().optional().describe('Specific test file or directory'),
  watch: z.boolean().optional().default(false).describe('Run in watch mode (not recommended for MCP)'),
});

const manageGithubActionsSchema = z.object({
  action: z.enum(['list', 'trigger', 'status', 'logs']),
  workflow: z.string().optional().describe('Workflow file name or ID (required for trigger/logs)'),
  branch: z.string().optional().default('main').describe('Branch to target'),
});

// --- Implementation Helpers ---

async function detectAndRun(command: string, args: string[], cwd: string = process.cwd()) {
  try {
    const fullCommand = `${command} ${args.join(' ')}`;
    const { stdout, stderr } = await execAsync(fullCommand, { cwd });
    return {
      success: true,
      stdout,
      stderr,
      command: fullCommand
    };
  } catch (error: any) {
    return {
      success: false,
      stdout: error.stdout,
      stderr: error.stderr,
      command: error.cmd,
      exitCode: error.code
    };
  }
}

// --- Tool Implementations ---

async function handleLintCode(args: z.infer<typeof lintCodeSchema>) {
  const { target, fix } = args;
  const ext = path.extname(target);
  
  let cmd = '';
  let cmdArgs: string[] = [];

  if (['.ts', '.js', '.tsx', '.jsx'].includes(ext) || fs.statSync(target).isDirectory()) {
    cmd = 'npx eslint';
    cmdArgs = [target, fix ? '--fix' : ''];
  } else if (['.py'].includes(ext)) {
    cmd = 'ruff check';
    cmdArgs = [target, fix ? '--fix' : ''];
  } else {
    return { content: [{ type: 'text', text: `Unsupported file type for linting: ${ext}` }], isError: true };
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }],
    isError: !result.success
  };
}

async function handleFormatCode(args: z.infer<typeof formatCodeSchema>) {
  const { target, check_only } = args;
  const ext = path.extname(target);

  let cmd = '';
  let cmdArgs: string[] = [];

  if (['.ts', '.js', '.json', '.md', '.css', '.html'].includes(ext)) {
    cmd = 'npx prettier';
    cmdArgs = [check_only ? '--check' : '--write', target];
  } else if (['.py'].includes(ext)) {
    cmd = 'black';
    cmdArgs = [check_only ? '--check' : '', target];
  } else {
     return { content: [{ type: 'text', text: `Unsupported file type for formatting: ${ext}` }], isError: true };
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }],
    isError: !result.success
  };
}

async function handleRunTests(args: z.infer<typeof runTestsSchema>) {
  const { target } = args;
  
  // Detect test runner based on package.json or file extension
  let cmd = 'npm test';
  let cmdArgs = target ? ['--', target] : [];

  // Override for python if detected
  if (target && target.endsWith('.py')) {
    cmd = 'pytest';
    cmdArgs = [target];
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...result,
        summary: result.success ? "Tests passed" : "Tests failed"
      }, null, 2)
    }],
    isError: !result.success
  };
}

async function handleGithubActions(args: z.infer<typeof manageGithubActionsSchema>) {
  const { action, workflow, branch } = args;
  
  let cmd = 'gh run';
  let cmdArgs: string[] = [];

  switch (action) {
    case 'list':
      cmdArgs = ['list', '--limit', '5'];
      break;
    case 'status':
      cmd = 'gh workflow';
      cmdArgs = ['list'];
      break;
    case 'trigger':
      if (!workflow) throw new Error("Workflow required for trigger");
      cmd = 'gh workflow run';
      cmdArgs = [workflow, '--ref', branch || 'main'];
      break;
    case 'logs':
      if (!workflow) throw new Error("Run ID required for logs (passed in workflow field)");
      cmdArgs = ['view', workflow, '--log'];
      break;
  }

  const result = await detectAndRun(cmd, cmdArgs);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.success
  };
}

// --- Exports ---

export const devTools: ExtendedTool[] = [
  {
    name: "lint_code",
    description: "Lint code using ESLint (JS/TS) or Ruff (Python)",
    inputSchema: zodToMcpSchema(lintCodeSchema),
    defer_loading: true
  },
  {
    name: "format_code",
    description: "Format code using Prettier (JS/TS/Web) or Black (Python)",
    inputSchema: zodToMcpSchema(formatCodeSchema),
    defer_loading: true
  },
  {
    name: "run_tests",
    description: "Run tests using Vitest/Jest or Pytest",
    inputSchema: zodToMcpSchema(runTestsSchema),
    defer_loading: true
  },
  {
    name: "github_actions",
    description: "Manage GitHub Actions CI/CD workflows",
    inputSchema: zodToMcpSchema(manageGithubActionsSchema),
    defer_loading: true
  }
];

export const devToolHandlers = {
  lint_code: handleLintCode,
  format_code: handleFormatCode,
  run_tests: handleRunTests,
  github_actions: handleGithubActions
};
