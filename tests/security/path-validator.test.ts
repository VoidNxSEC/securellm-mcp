import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { validatePath, validatePaths, isPathWithinBoundary } from '../../src/security/path-validator.js';
import { createTempDir, populateTempDir, type TempDir } from '../helpers/sandbox.js';

describe('Path Validator', () => {
  let tempDir: TempDir;

  before(async () => {
    tempDir = await createTempDir('path-validator-');
    await populateTempDir(tempDir.path, {
      'src/index.ts': 'export {};',
      'src/utils/helper.ts': 'export const x = 1;',
    });
  });

  after(async () => {
    await tempDir.cleanup();
  });

  describe('validatePath', () => {
    it('should allow paths within the boundary', () => {
      const result = validatePath(path.join(tempDir.path, 'src/index.ts'), tempDir.path);
      assert.equal(result, path.join(tempDir.path, 'src/index.ts'));
    });

    it('should allow the root directory itself', () => {
      const result = validatePath(tempDir.path, tempDir.path);
      assert.equal(result, tempDir.path);
    });

    it('should allow relative paths that resolve within boundary', () => {
      const result = validatePath(
        path.join(tempDir.path, 'src', '..', 'src', 'index.ts'),
        tempDir.path
      );
      assert.equal(result, path.join(tempDir.path, 'src/index.ts'));
    });

    it('should reject ../ traversal attempts', () => {
      assert.throws(
        () => validatePath(path.join(tempDir.path, '../../etc/passwd'), tempDir.path),
        /escapes allowed boundary/
      );
    });

    it('should reject absolute paths outside boundary', () => {
      assert.throws(
        () => validatePath('/etc/passwd', tempDir.path),
        /escapes allowed boundary/
      );
    });

    it('should reject /etc/shadow', () => {
      assert.throws(
        () => validatePath('/etc/shadow', tempDir.path),
        /escapes allowed boundary/
      );
    });

    it('should reject deeply nested traversal', () => {
      assert.throws(
        () => validatePath(
          path.join(tempDir.path, 'src/../../../../../../../../etc/hosts'),
          tempDir.path
        ),
        /escapes allowed boundary/
      );
    });

    it('should reject sibling directory traversal', () => {
      assert.throws(
        () => validatePath(path.join(tempDir.path, '../other-project/secrets'), tempDir.path),
        /escapes allowed boundary/
      );
    });

    it('should reject traversal with intermediate valid component', () => {
      assert.throws(
        () => validatePath(
          path.join(tempDir.path, 'src/../../etc/passwd'),
          tempDir.path
        ),
        /escapes allowed boundary/
      );
    });

    it('should reject paths that match boundary prefix but are different dirs', () => {
      // e.g., boundary is /tmp/test, path is /tmp/test-evil/file
      const evilPath = tempDir.path + '-evil/file.txt';
      assert.throws(
        () => validatePath(evilPath, tempDir.path),
        /escapes allowed boundary/
      );
    });
  });

  describe('validatePaths', () => {
    it('should validate multiple paths', () => {
      const paths = [
        path.join(tempDir.path, 'src/index.ts'),
        path.join(tempDir.path, 'src/utils/helper.ts'),
      ];
      const result = validatePaths(paths, tempDir.path);
      assert.deepEqual(result, paths);
    });

    it('should throw if any path is invalid', () => {
      const paths = [
        path.join(tempDir.path, 'src/index.ts'),
        '/etc/passwd',
      ];
      assert.throws(
        () => validatePaths(paths, tempDir.path),
        /escapes allowed boundary/
      );
    });
  });

  describe('isPathWithinBoundary', () => {
    it('should return true for valid paths', () => {
      assert.equal(
        isPathWithinBoundary(path.join(tempDir.path, 'src/index.ts'), tempDir.path),
        true
      );
    });

    it('should return false for traversal paths', () => {
      assert.equal(isPathWithinBoundary('/etc/passwd', tempDir.path), false);
    });

    it('should return false for prefix-match attacks', () => {
      assert.equal(isPathWithinBoundary(tempDir.path + '-evil/file', tempDir.path), false);
    });
  });
});
