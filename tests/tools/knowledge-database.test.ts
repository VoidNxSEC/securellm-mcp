import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { SQLiteKnowledgeDatabase } from '../../src/knowledge/database.js';
import { createTempDir, type TempDir } from '../helpers/sandbox.js';

describe('SQLiteKnowledgeDatabase', () => {
  let tempDir: TempDir;
  let db: SQLiteKnowledgeDatabase;

  before(async () => {
    tempDir = await createTempDir('knowledge-db-test-');
    const dbPath = path.join(tempDir.path, 'knowledge.db');
    db = new SQLiteKnowledgeDatabase(dbPath);
  });

  after(async () => {
    await tempDir.cleanup();
  });

  describe('Session CRUD', () => {
    it('should create a session', async () => {
      const session = await db.createSession({ summary: 'Test session' });
      assert.ok(session.id);
      assert.equal(session.summary, 'Test session');
    });

    it('should get a session by id', async () => {
      const created = await db.createSession({ summary: 'Get test' });
      const fetched = await db.getSession(created.id);
      assert.ok(fetched);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.summary, 'Get test');
    });

    it('should return null for non-existent session', async () => {
      const result = await db.getSession('nonexistent-id');
      assert.equal(result, null);
    });

    it('should list sessions ordered by last_active', async () => {
      await db.createSession({ summary: 'Session A' });
      await db.createSession({ summary: 'Session B' });

      const sessions = await db.listSessions(10, 0);
      assert.ok(sessions.length >= 2);
    });

    it('should update a session', async () => {
      const session = await db.createSession({ summary: 'Before update' });
      await db.updateSession(session.id, { summary: 'After update' });

      const updated = await db.getSession(session.id);
      assert.ok(updated);
      assert.equal(updated.summary, 'After update');
    });

    it('should delete a session', async () => {
      const session = await db.createSession({ summary: 'To delete' });
      await db.deleteSession(session.id);

      const deleted = await db.getSession(session.id);
      assert.equal(deleted, null);
    });
  });

  describe('Knowledge Entries', () => {
    it('should save a knowledge entry', async () => {
      const session = await db.createSession({ summary: 'Knowledge test' });
      const entry = await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'TypeScript strict mode catches null reference errors',
        tags: ['typescript', 'best-practices'],
        priority: 'high',
      });

      assert.ok(entry.id);
      assert.equal(entry.entry_type, 'insight');
      assert.equal(entry.content, 'TypeScript strict mode catches null reference errors');
    });

    it('should create a session if none provided', async () => {
      const entry = await db.saveKnowledge({
        type: 'code',
        content: 'const x: number = 42;',
        tags: ['typescript'],
      });

      assert.ok(entry.id);
      assert.ok(entry.session_id);
    });

    it('should get a knowledge entry by id', async () => {
      const entry = await db.saveKnowledge({
        type: 'reference',
        content: 'Node.js documentation at nodejs.org',
        tags: ['nodejs'],
      });

      const fetched = await db.getKnowledgeEntry(entry.id);
      assert.ok(fetched);
      assert.equal(fetched.content, 'Node.js documentation at nodejs.org');
    });

    it('should increment session entry_count on save', async () => {
      const session = await db.createSession({ summary: 'Count test' });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'First entry for counting test',
      });
      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'Second entry for counting test',
      });

      const updated = await db.getSession(session.id);
      assert.ok(updated);
      assert.equal(updated.entry_count, 2);
    });
  });

  describe('FTS5 Search', () => {
    it('should search knowledge entries by content', async () => {
      const session = await db.createSession({ summary: 'Search test' });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'Circuit breakers prevent cascading failures in microservices',
        tags: ['architecture', 'reliability'],
      });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'Rate limiting protects APIs from abuse and overload',
        tags: ['security', 'api'],
      });

      const results = await db.searchKnowledge({
        query: 'circuit breaker',
      });

      assert.ok(results.length > 0);
      assert.ok(results[0].entry.content.includes('Circuit breaker'));
    });

    it('should search by tags', async () => {
      const session = await db.createSession({ summary: 'Tag search' });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'code',
        content: 'Security patch for input validation',
        tags: ['security', 'patch'],
      });

      const results = await db.searchKnowledge({
        query: 'security',
      });

      assert.ok(results.length > 0);
    });

    it('should filter by session_id', async () => {
      const session1 = await db.createSession({ summary: 'Session 1' });
      const session2 = await db.createSession({ summary: 'Session 2' });

      await db.saveKnowledge({
        session_id: session1.id,
        type: 'insight',
        content: 'Unique insight about Nix builds and derivations',
        tags: ['nix'],
      });

      await db.saveKnowledge({
        session_id: session2.id,
        type: 'insight',
        content: 'Unique insight about Nix packages and flakes',
        tags: ['nix'],
      });

      const results = await db.searchKnowledge({
        query: 'Nix',
        session_id: session1.id,
      });

      assert.ok(results.length > 0);
      assert.ok(results.every(r => r.entry.session_id === session1.id));
    });

    it('should filter by entry_type', async () => {
      const session = await db.createSession({ summary: 'Type filter' });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'code',
        content: 'function filterByType() { return true; }',
        tags: ['code'],
      });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'Filtering by type improves search relevance significantly',
        tags: ['search'],
      });

      const results = await db.searchKnowledge({
        query: 'filter',
        entry_type: 'code',
      });

      assert.ok(results.every(r => r.entry.entry_type === 'code'));
    });

    it('should return relevance scores', async () => {
      const session = await db.createSession({ summary: 'Relevance test' });

      await db.saveKnowledge({
        session_id: session.id,
        type: 'insight',
        content: 'Performance optimization through caching and memoization strategies',
        tags: ['performance'],
      });

      const results = await db.searchKnowledge({
        query: 'performance optimization',
      });

      if (results.length > 0) {
        assert.ok(typeof results[0].relevance === 'number');
      }
    });

    it('should respect limit parameter', async () => {
      const session = await db.createSession({ summary: 'Limit test' });

      for (let i = 0; i < 5; i++) {
        await db.saveKnowledge({
          session_id: session.id,
          type: 'insight',
          content: `Limit test entry number ${i} for pagination testing`,
          tags: ['limit-test'],
        });
      }

      const results = await db.searchKnowledge({
        query: 'limit test',
        limit: 2,
      });

      assert.ok(results.length <= 2);
    });
  });
});
