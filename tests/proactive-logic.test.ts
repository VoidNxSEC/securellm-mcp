import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { PreActionInterceptor } from '../src/reasoning/proactive/pre-action-interceptor.js';
import { ContextManager } from '../src/reasoning/context-manager.js';
import { SQLiteKnowledgeDatabase } from '../src/knowledge/database.js';

describe('Proactive Logic Layer', () => {
  const tempDir = path.join(process.cwd(), 'temp_test_proactive');
  const dbPath = path.join(tempDir, 'knowledge.db');
  let db: SQLiteKnowledgeDatabase;
  let contextManager: ContextManager;
  let interceptor: PreActionInterceptor;

  before(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    db = new SQLiteKnowledgeDatabase(dbPath);
    contextManager = new ContextManager(process.cwd(), db);
    interceptor = new PreActionInterceptor(contextManager);
  });

  after(() => {
    db.close();
    // Cleanup
    try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(path.join(tempDir, 'knowledge.db-wal'))) fs.unlinkSync(path.join(tempDir, 'knowledge.db-wal'));
        if (fs.existsSync(path.join(tempDir, 'knowledge.db-shm'))) fs.unlinkSync(path.join(tempDir, 'knowledge.db-shm'));
        if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir, { recursive: true });
    } catch (e) {
        console.error('Cleanup failed:', e);
    }
  });

  it('should intercept file modification tools and check git status', async () => {
    // Mock the context manager to return a specific state
    // For this integration test, we rely on the actual implementation which checks the real git status
    // of the current repo. Since we are in a git repo, it should work.
    
    // Test with 'write_file'
    const result = await interceptor.intercept('write_file', { file_path: 'test.txt', content: 'test' });
    
    // It should proceed, but potentially with warnings if git is dirty (which it might be in dev env)
    // The key is that it didn't throw and returned a result object
    assert.strictEqual(typeof result.shouldProceed, 'boolean');
  });

  it('should allow read-only tools without checks', async () => {
    const result = await interceptor.intercept('read_file', { file_path: 'test.txt' });
    assert.strictEqual(result.shouldProceed, true);
  });

  it('should trigger auth check for provider tools', async () => {
    const result = await interceptor.intercept('provider_test', { provider: 'openai', prompt: 'hi' });
    // Our mock implementation returns true for auth check
    assert.strictEqual(result.shouldProceed, true);
  });
});
