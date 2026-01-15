import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { SSHConnectionManager } from '../src/tools/ssh/connection-manager.js';
import { SSHTunnelManager } from '../src/tools/ssh/tunnel-manager.js';
import { SSHJumpHostManager } from '../src/tools/ssh/jump-host-manager.js';
import { SSHSessionManager } from '../src/tools/ssh/session-manager.js';

describe('SSH Advanced Tools', () => {
  const tempDir = path.join(process.cwd(), 'temp_test_ssh');
  const dbPath = path.join(tempDir, 'ssh_sessions.db');
  let connectionManager: SSHConnectionManager;
  let tunnelManager: SSHTunnelManager;
  let jumpHostManager: SSHJumpHostManager;
  let sessionManager: SSHSessionManager;

  before(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    // Allow localhost for testing
    connectionManager = new SSHConnectionManager(['localhost', '127.0.0.1', 'example.com']);
    tunnelManager = new SSHTunnelManager(connectionManager);
    jumpHostManager = new SSHJumpHostManager(connectionManager);
    sessionManager = new SSHSessionManager(dbPath, connectionManager, tunnelManager, jumpHostManager);
  });

  after(() => {
    sessionManager.close();
    connectionManager.disconnectAll();
    // Cleanup
    try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(path.join(tempDir, 'ssh_sessions.db-wal'))) fs.unlinkSync(path.join(tempDir, 'ssh_sessions.db-wal'));
        if (fs.existsSync(path.join(tempDir, 'ssh_sessions.db-shm'))) fs.unlinkSync(path.join(tempDir, 'ssh_sessions.db-shm'));
        if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir, { recursive: true });
    } catch (e) {
        console.error('Cleanup failed:', e);
    }
  });

  it('should validate allowed hosts', async () => {
    const result = await connectionManager.connect({
      host: 'evil.com',
      username: 'user',
      auth_method: 'password',
      password: 'pass'
    });
    
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /not in whitelist/);
  });

  it('should allow whitelisted hosts', async () => {
    // Note: This will fail connection but pass whitelist check
    const result = await connectionManager.connect({
      host: 'example.com',
      username: 'user',
      auth_method: 'password',
      password: 'pass'
    });
    
    // Should proceed to connection attempt, not blocked by whitelist
    // The error should come from SSH connection failure, not whitelist
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.doesNotMatch(result.error || '', /not in whitelist/);
  });

  it('should generate connection key correctly', async () => {
    // Access private method for testing logic
    const key = (connectionManager as any).generateConnectionKey({
      host: 'example.com',
      username: 'user',
      port: 22
    });
    assert.strictEqual(key, 'user@example.com:22');
  });

  it('should support session persistence', async () => {
    // We can't fully test without a real connection, but we can test the structure
    // Mock a connection
    const mockConnId = 'test-conn-1';
    (connectionManager as any).connections.set(mockConnId, {
      id: mockConnId,
      client: { end: () => {} }, // Mock client
      host: 'example.com',
      username: 'user',
      connected: true,
      created: new Date(),
      created_at: new Date(),
      last_used: new Date(),
      config: { host: 'example.com', username: 'user', port: 22 },
      bytes_sent: 100,
      bytes_received: 200,
      commands_executed: 5
    });

    const result = await sessionManager.persistSession({
      connection_id: mockConnId,
      persist: true,
      auto_recover: false
    });

    assert.ok(result.session_id);
    assert.strictEqual(result.connection_metadata.bytes_sent, 100);
  });
});
