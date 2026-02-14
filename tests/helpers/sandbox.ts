/**
 * Sandbox utilities for tests
 * Temp directory creation, cleanup, and file helpers
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface TempDir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary directory for tests.
 * Returns the path and a cleanup function.
 */
export async function createTempDir(prefix: string = 'securellm-test-'): Promise<TempDir> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create files within a temp directory structure.
 */
export async function populateTempDir(
  basePath: string,
  files: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(basePath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
}

/**
 * Create a temp directory with nested structure for path traversal tests.
 */
export async function createNestedTempDir(): Promise<TempDir> {
  const temp = await createTempDir('securellm-nested-');
  await populateTempDir(temp.path, {
    'src/index.ts': 'export {};',
    'src/utils/helper.ts': 'export const x = 1;',
    'tests/test.ts': 'import { test } from "node:test";',
    'package.json': '{"name": "test"}',
  });
  return temp;
}
