import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { InputAnalyzer } from '../src/reasoning/input-analyzer.js';
import { ContextManager } from '../src/reasoning/context-manager.js';
import { SQLiteKnowledgeDatabase } from '../src/knowledge/database.js';

describe('Reasoning System Validation', () => {
  const tempDir = path.join(process.cwd(), 'temp_test_reasoning');
  const dbPath = path.join(tempDir, 'knowledge.db');
  let db: SQLiteKnowledgeDatabase;

  before(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    db = new SQLiteKnowledgeDatabase(dbPath);
  });

  after(() => {
    db.close();
    // Try to cleanup, but ignore errors if file is locked or something
    try {
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        if (fs.existsSync(path.join(tempDir, 'knowledge.db-wal'))) {
            fs.unlinkSync(path.join(tempDir, 'knowledge.db-wal'));
        }
        if (fs.existsSync(path.join(tempDir, 'knowledge.db-shm'))) {
            fs.unlinkSync(path.join(tempDir, 'knowledge.db-shm'));
        }
        if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    } catch (e) {
        console.error('Cleanup failed:', e);
    }
  });

  describe('InputAnalyzer', () => {
    const analyzer = new InputAnalyzer();

    it('should classify "how do I run this?" as query', () => {
      const result = analyzer.analyze('how do I run this?');
      assert.strictEqual(result.intent, 'query');
    });

    it('should classify "run the build" as command', () => {
      const result = analyzer.analyze('run the build');
      assert.strictEqual(result.intent, 'command');
    });

    it('should extract file entities', () => {
      const result = analyzer.analyze('check src/index.ts for errors');
      assert.ok(result.entities.length > 0);
      const fileEntity = result.entities.find(e => e.type === 'file');
      assert.ok(fileEntity);
      assert.strictEqual(fileEntity?.value, 'src/index.ts');
    });

    it('should extract topics correctly', () => {
      const result = analyzer.analyze('optimize the git workflow');
      const topics = result.topics.map(t => t.name);
      assert.ok(topics.includes('git'));
      assert.ok(topics.includes('performance')); // optimize -> performance
    });
  });

  describe('ContextManager', () => {
    let contextManager: ContextManager;

    before(() => {
      contextManager = new ContextManager(process.cwd(), db);
    });

    it('should enrich context with project state', async () => {
      const result = await contextManager.enrichContext('what is the state of src/index.ts?');
      assert.ok(result.project);
      assert.ok(result.input);
      assert.strictEqual(result.input.intent, 'query');
    });
    
    it('should have access to pattern storage', () => {
       // Just verify database connection implicitly via contextManager
       const patterns = db.getPatterns();
       assert.ok(Array.isArray(patterns));
    });
  });
});
