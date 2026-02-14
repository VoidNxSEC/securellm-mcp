import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { validatePath } from '../../src/security/path-validator.js';

describe('Dev Tools Security', () => {
  describe('path validation in lint/format/test', () => {
    const cwd = process.cwd();

    it('should accept paths within cwd', () => {
      const result = validatePath(path.join(cwd, 'src/index.ts'), cwd);
      assert.ok(result.startsWith(cwd));
    });

    it('should accept relative paths that resolve within cwd', () => {
      const result = validatePath('src/index.ts', cwd);
      assert.ok(result.startsWith(cwd));
    });

    it('should reject paths escaping cwd', () => {
      assert.throws(
        () => validatePath('/etc/passwd', cwd),
        /escapes allowed boundary/
      );
    });

    it('should reject ../../../ traversal', () => {
      assert.throws(
        () => validatePath('../../../etc/passwd', cwd),
        /escapes allowed boundary/
      );
    });

    it('should reject /tmp/evil target', () => {
      assert.throws(
        () => validatePath('/tmp/evil/script.sh', cwd),
        /escapes allowed boundary/
      );
    });

    it('should accept package.json at root', () => {
      const result = validatePath('package.json', cwd);
      assert.equal(result, path.join(cwd, 'package.json'));
    });

    it('should accept nested test paths', () => {
      const result = validatePath('tests/security/path-validator.test.ts', cwd);
      assert.ok(result.startsWith(cwd));
    });
  });
});
