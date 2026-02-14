import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { WildcardCommandSystem } from '../../src/tools/wildcard-commands.js';
import { shellInjectionPayloads } from '../helpers/fixtures.js';

describe('WildcardCommandSystem', () => {
  const wcs = new WildcardCommandSystem();

  describe('generate', () => {
    it('should generate commands for valid patterns', () => {
      const result = wcs.generate('temp-check');
      assert.ok(result);
      assert.equal(result.riskLevel, 'safe');
      assert.ok(result.commands.length > 0);
    });

    it('should return null for unknown patterns', () => {
      const result = wcs.generate('unknown-pattern-xyz');
      assert.equal(result, null);
    });

    it('should generate port-check commands', () => {
      const result = wcs.generate('port-check 8080');
      assert.ok(result);
      assert.ok(result.commands.some(cmd => cmd.includes('8080')));
    });

    it('should generate debug-service commands', () => {
      const result = wcs.generate('debug sshd');
      assert.ok(result);
      assert.ok(result.commands.some(cmd => cmd.includes('sshd')));
    });

    it('should generate net-diagnose commands', () => {
      const result = wcs.generate('net-diagnose');
      assert.ok(result);
      assert.ok(result.commands.some(cmd => cmd.includes('ip addr')));
    });

    it('should generate net-diagnose with target', () => {
      const result = wcs.generate('net-diagnose 8.8.8.8');
      assert.ok(result);
      assert.ok(result.commands.some(cmd => cmd.includes('8.8.8.8')));
    });
  });

  describe('execute - confirmation required', () => {
    it('should require confirmation for dangerous commands', async () => {
      const result = await wcs.execute('docker-cleanup');
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('Confirmation required'));
    });

    it('should require confirmation for kill patterns', async () => {
      const result = await wcs.execute('kill nginx', {}, { confirm: false });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('Confirmation required'));
    });
  });

  describe('execute - input validation', () => {
    it('should reject malicious service names in debug', async () => {
      const result = await wcs.execute('debug $(whoami)');
      assert.equal(result.success, false);
    });

    it('should reject malicious service names in restart', async () => {
      const result = await wcs.execute('restart ; rm -rf /');
      assert.equal(result.success, false);
    });

    it('should reject malicious service names in analyze-logs', async () => {
      const result = await wcs.execute('analyze-logs `id`');
      assert.equal(result.success, false);
    });

    it('should reject net-diagnose with shell injection in target', async () => {
      const result = await wcs.execute('net-diagnose $(cat /etc/passwd)');
      assert.equal(result.success, false);
    });

    it('should reject net-diagnose with semicolon injection', async () => {
      const result = await wcs.execute('net-diagnose 8.8.8.8; cat /etc/shadow');
      assert.equal(result.success, false);
    });

    for (const payload of shellInjectionPayloads.slice(0, 5)) {
      it(`should reject kill pattern with: "${payload.slice(0, 30)}..."`, async () => {
        const result = await wcs.execute(`kill ${payload}`);
        assert.equal(result.success, false);
      });
    }
  });

  describe('listCommands', () => {
    it('should list all registered commands', () => {
      const cmds = wcs.listCommands();
      assert.ok(cmds.length > 0);
      assert.ok(cmds.every(cmd => cmd.pattern && cmd.description && cmd.riskLevel));
    });
  });

  describe('getHistory', () => {
    it('should return execution history', async () => {
      const freshWcs = new WildcardCommandSystem();
      // Execute something safe that won't need confirmation
      const result = freshWcs.generate('temp-check');
      assert.ok(result);

      const history = freshWcs.getHistory();
      assert.ok(Array.isArray(history));
    });

    it('should respect limit', () => {
      const freshWcs = new WildcardCommandSystem();
      const history = freshWcs.getHistory(5);
      assert.ok(history.length <= 5);
    });
  });

  describe('register', () => {
    it('should allow registering custom templates', () => {
      const freshWcs = new WildcardCommandSystem();
      freshWcs.register('custom-test', {
        pattern: /^custom-test$/i,
        generator: () => ['echo "custom"'],
        description: 'Custom test command',
        riskLevel: 'safe',
      });

      const result = freshWcs.generate('custom-test');
      assert.ok(result);
      assert.deepEqual(result.commands, ['echo "custom"']);
    });
  });
});
