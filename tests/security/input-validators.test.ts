import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  SafeServiceName,
  SafeHostname,
  SafePort,
  SafeMfaCode,
  SafeTimePeriod,
  hasShellMeta,
  ShellSafeString,
  SafeK8sName,
  SafeResourceName,
  SafeCidrMask,
  NonEmptyString,
  PositiveInt,
} from '../../src/security/input-validators.js';

describe('Input Validators', () => {
  describe('SafeServiceName', () => {
    it('should accept valid service names', () => {
      const valid = ['sshd', 'nginx.service', 'my_app', 'foo@bar', 'a1-b2'];
      for (const name of valid) {
        assert.ok(SafeServiceName.safeParse(name).success, `Expected "${name}" to be valid`);
      }
    });

    it('should reject invalid service names', () => {
      const invalid = [
        '',
        '1starts-with-digit',
        'has space',
        'semi;colon',
        'pipe|char',
        '../traversal',
        'a'.repeat(65),
      ];
      for (const name of invalid) {
        assert.ok(!SafeServiceName.safeParse(name).success, `Expected "${name}" to be rejected`);
      }
    });
  });

  describe('SafeHostname', () => {
    it('should accept valid hostnames and IPs', () => {
      const valid = ['localhost', '192.168.1.1', 'my-host.example.com', '::1', 'fe80::1'];
      for (const h of valid) {
        assert.ok(SafeHostname.safeParse(h).success, `Expected "${h}" to be valid`);
      }
    });

    it('should reject hostnames with shell characters', () => {
      const invalid = ['host;rm -rf /', 'host$(whoami)', 'host`id`', ''];
      for (const h of invalid) {
        assert.ok(!SafeHostname.safeParse(h).success, `Expected "${h}" to be rejected`);
      }
    });
  });

  describe('SafePort', () => {
    it('should accept valid ports', () => {
      assert.ok(SafePort.safeParse(80).success);
      assert.ok(SafePort.safeParse(443).success);
      assert.ok(SafePort.safeParse(65535).success);
    });

    it('should reject invalid ports', () => {
      assert.ok(!SafePort.safeParse(0).success);
      assert.ok(!SafePort.safeParse(-1).success);
      assert.ok(!SafePort.safeParse(65536).success);
      assert.ok(!SafePort.safeParse(3.14).success);
    });
  });

  describe('SafeMfaCode', () => {
    it('should accept 6-digit codes', () => {
      assert.ok(SafeMfaCode.safeParse('123456').success);
      assert.ok(SafeMfaCode.safeParse('000000').success);
    });

    it('should reject non-6-digit codes', () => {
      assert.ok(!SafeMfaCode.safeParse('12345').success);
      assert.ok(!SafeMfaCode.safeParse('1234567').success);
      assert.ok(!SafeMfaCode.safeParse('abcdef').success);
      assert.ok(!SafeMfaCode.safeParse('').success);
    });
  });

  describe('SafeTimePeriod', () => {
    it('should accept valid journalctl time formats', () => {
      const valid = [
        '30 minute ago',
        '1 hour ago',
        '2 days ago',
        '7 day ago',
        '3 weeks ago',
        '1 month ago',
        '10 seconds ago',
      ];
      for (const t of valid) {
        assert.ok(SafeTimePeriod.safeParse(t).success, `Expected "${t}" to be valid`);
      }
    });

    it('should reject injection attempts', () => {
      const invalid = [
        '1 hour ago; rm -rf /',
        '$(whoami)',
        '-1 day ago',
        'all',
        '',
        '1 year ago',
      ];
      for (const t of invalid) {
        assert.ok(!SafeTimePeriod.safeParse(t).success, `Expected "${t}" to be rejected`);
      }
    });
  });

  describe('hasShellMeta', () => {
    it('should detect shell metacharacters', () => {
      const dangerous = [';', '|', '&', '`', '$', '<', '>', '(', ')', '{', '}', '!', '#', '~', '\\', '\n', '"', "'"];
      for (const char of dangerous) {
        assert.ok(hasShellMeta(`safe${char}text`), `Expected "${char}" to be detected`);
      }
    });

    it('should pass safe strings', () => {
      const safe = ['hello world', 'file.txt', 'my-service_v2', '192.168.1.1', 'foo@bar'];
      for (const s of safe) {
        assert.ok(!hasShellMeta(s), `Expected "${s}" to be safe`);
      }
    });
  });

  describe('ShellSafeString', () => {
    it('should accept safe strings', () => {
      assert.ok(ShellSafeString.safeParse('hello-world').success);
      assert.ok(ShellSafeString.safeParse('192.168.1.1').success);
    });

    it('should reject strings with metacharacters', () => {
      assert.ok(!ShellSafeString.safeParse('rm -rf /; echo').success);
      assert.ok(!ShellSafeString.safeParse('$(whoami)').success);
    });
  });

  describe('SafeK8sName', () => {
    it('should accept valid k8s names', () => {
      const valid = ['my-app', 'nginx', 'app123', 'a'];
      for (const n of valid) {
        assert.ok(SafeK8sName.safeParse(n).success, `Expected "${n}" to be valid`);
      }
    });

    it('should reject invalid k8s names', () => {
      const invalid = ['-starts-with-dash', 'UPPERCASE', 'has_underscore', 'ends-with-'];
      for (const n of invalid) {
        assert.ok(!SafeK8sName.safeParse(n).success, `Expected "${n}" to be rejected`);
      }
    });
  });

  describe('SafeResourceName', () => {
    it('should accept valid resource names', () => {
      assert.ok(SafeResourceName.safeParse('my-volume').success);
      assert.ok(SafeResourceName.safeParse('data_store_1').success);
    });

    it('should reject invalid resource names', () => {
      assert.ok(!SafeResourceName.safeParse('-starts-bad').success);
      assert.ok(!SafeResourceName.safeParse('').success);
      assert.ok(!SafeResourceName.safeParse('has space').success);
    });
  });

  describe('SafeCidrMask', () => {
    it('should accept valid CIDR masks', () => {
      assert.ok(SafeCidrMask.safeParse(0).success);
      assert.ok(SafeCidrMask.safeParse(24).success);
      assert.ok(SafeCidrMask.safeParse(32).success);
    });

    it('should reject invalid CIDR masks', () => {
      assert.ok(!SafeCidrMask.safeParse(-1).success);
      assert.ok(!SafeCidrMask.safeParse(33).success);
    });
  });

  describe('NonEmptyString', () => {
    it('should accept non-empty strings', () => {
      assert.ok(NonEmptyString.safeParse('hello').success);
    });

    it('should reject empty strings', () => {
      assert.ok(!NonEmptyString.safeParse('').success);
    });
  });

  describe('PositiveInt', () => {
    it('should accept positive integers', () => {
      assert.ok(PositiveInt.safeParse(1).success);
      assert.ok(PositiveInt.safeParse(100).success);
    });

    it('should reject non-positive values', () => {
      assert.ok(!PositiveInt.safeParse(0).success);
      assert.ok(!PositiveInt.safeParse(-1).success);
      assert.ok(!PositiveInt.safeParse(1.5).success);
    });
  });
});
