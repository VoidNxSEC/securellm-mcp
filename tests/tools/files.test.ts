import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { FilesAnalyzeStructureTool, FilesAutoOrganizeTool, FilesCreateCatalogTool } from '../../src/tools/files/index.js';
import { createTempDir, populateTempDir, type TempDir } from '../helpers/sandbox.js';

describe('File Tools Security', () => {
  let tempDir: TempDir;

  before(async () => {
    tempDir = await createTempDir('files-test-');
    await populateTempDir(tempDir.path, {
      'src/index.ts': 'export {};',
      'src/utils/helper.ts': 'export const x = 1;',
      'data/test.json': '{"test": true}',
    });
    // Override cwd for tests
    process.chdir(tempDir.path);
  });

  after(async () => {
    process.chdir('/home/kernelcore/master/securellm-mcp');
    await tempDir.cleanup();
  });

  describe('FilesAnalyzeStructureTool', () => {
    const tool = new FilesAnalyzeStructureTool();

    it('should analyze directories within boundary', async () => {
      const result = await tool.execute({
        base_path: tempDir.path,
        max_depth: 3,
      });
      assert.equal(result.success, true);
      assert.ok(result.data);
    });

    it('should reject path traversal in base_path', async () => {
      const result = await tool.execute({
        base_path: '/etc',
      });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('escapes allowed boundary'));
    });

    it('should reject relative traversal in base_path', async () => {
      const result = await tool.execute({
        base_path: '../../../etc',
      });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('escapes allowed boundary'));
    });
  });

  describe('FilesAutoOrganizeTool', () => {
    const tool = new FilesAutoOrganizeTool();

    it('should accept paths within boundary', async () => {
      const result = await tool.execute({
        source_path: path.join(tempDir.path, 'src'),
        strategy: 'by_type',
        dry_run: true,
      });
      assert.equal(result.success, true);
    });

    it('should reject path traversal in source_path', async () => {
      const result = await tool.execute({
        source_path: '/var/log',
        strategy: 'by_type',
        dry_run: true,
      });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('escapes allowed boundary'));
    });
  });

  describe('FilesCreateCatalogTool', () => {
    const tool = new FilesCreateCatalogTool();

    it('should accept paths within boundary', async () => {
      const result = await tool.execute({
        paths: [tempDir.path],
      });
      assert.equal(result.success, true);
      assert.ok((result.data as any)?.files_indexed >= 0);
    });

    it('should reject path traversal in catalog paths', async () => {
      const result = await tool.execute({
        paths: ['/etc'],
      });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('escapes allowed boundary'));
    });
  });
});
