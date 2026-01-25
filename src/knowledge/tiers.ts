// Tier Classification and Management for Knowledge Database

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type { Tier, TierClassification, TierDistribution } from '../types/compaction.js';

export interface TierThresholds {
  hot_threshold: number;    // Days (default: 7)
  warm_threshold: number;   // Days (default: 30)
  cold_threshold: number;   // Days (default: 90)
}

export class TierManager {
  constructor(
    private db: Database.Database,
    private thresholds: TierThresholds = {
      hot_threshold: 7,
      warm_threshold: 30,
      cold_threshold: 90,
    }
  ) {}

  /**
   * Classify all sessions into tiers based on age and activity
   */
  async classifyAllSessions(): Promise<TierClassification[]> {
    const sessions = this.db.prepare(`
      SELECT
        s.id,
        s.created_at,
        s.last_active,
        s.entry_count,
        s.pinned,
        s.tier as current_tier,
        COALESCE(s.compaction_exempt, 0) as compaction_exempt,
        (julianday('now') - julianday(s.last_active)) as age_days,
        CASE WHEN EXISTS (
          SELECT 1 FROM knowledge_entries ke
          WHERE ke.session_id = s.id AND ke.priority = 'high'
        ) THEN 1 ELSE 0 END as has_high_priority
      FROM sessions s
    `).all() as any[];

    const classifications: TierClassification[] = [];

    for (const session of sessions) {
      const classification = this.classifySession(session);
      classifications.push(classification);
    }

    return classifications;
  }

  /**
   * Classify a single session
   */
  private classifySession(session: any): TierClassification {
    const ageDays = session.age_days;
    const isPinned = Boolean(session.pinned);
    const hasHighPriority = Boolean(session.has_high_priority);
    const isExempt = Boolean(session.compaction_exempt);

    // Determine recommended tier
    let recommendedTier: Tier;
    let reason: string;

    // Exemptions (always hot)
    if (isPinned) {
      recommendedTier = 'hot';
      reason = 'Pinned session - exempt from compaction';
    } else if (hasHighPriority) {
      recommendedTier = 'hot';
      reason = 'Contains high-priority entries';
    } else if (isExempt) {
      recommendedTier = 'hot';
      reason = 'Marked as compaction exempt';
    } else if (ageDays <= this.thresholds.hot_threshold) {
      recommendedTier = 'hot';
      reason = `Recent activity (${ageDays.toFixed(1)} days old)`;
    } else if (ageDays <= this.thresholds.warm_threshold) {
      recommendedTier = 'warm';
      reason = `Moderate age (${ageDays.toFixed(1)} days old) - candidate for summarization`;
    } else if (ageDays <= this.thresholds.cold_threshold) {
      recommendedTier = 'cold';
      reason = `Old session (${ageDays.toFixed(1)} days old) - candidate for archival`;
    } else {
      recommendedTier = 'frozen';
      reason = `Very old session (${ageDays.toFixed(1)} days old) - candidate for deletion`;
    }

    return {
      session_id: session.id,
      current_tier: session.current_tier || 'hot',
      recommended_tier: recommendedTier,
      reason,
      age_days: ageDays,
      entry_count: session.entry_count,
      last_active: session.last_active,
      is_pinned: isPinned,
      has_high_priority: hasHighPriority,
    };
  }

  /**
   * Update session tier
   */
  async updateSessionTier(sessionId: string, tier: Tier): Promise<void> {
    this.db.prepare(`
      UPDATE sessions
      SET tier = ?
      WHERE id = ?
    `).run(tier, sessionId);

    logger.debug({ sessionId, tier }, 'Updated session tier');
  }

  /**
   * Update entry tiers based on session tier
   */
  async updateEntryTiers(sessionId: string, tier: Tier): Promise<void> {
    this.db.prepare(`
      UPDATE knowledge_entries
      SET tier = ?
      WHERE session_id = ?
    `).run(tier, sessionId);

    logger.debug({ sessionId, tier }, 'Updated entry tiers');
  }

  /**
   * Get tier distribution statistics
   */
  getTierDistribution(): TierDistribution {
    const sessionDist = this.db.prepare(`
      SELECT
        tier,
        COUNT(*) as count
      FROM sessions
      WHERE tier IS NOT NULL
      GROUP BY tier
    `).all() as any[];

    const distribution: TierDistribution = {
      hot: 0,
      warm: 0,
      cold: 0,
      frozen: 0,
    };

    for (const row of sessionDist) {
      if (row.tier in distribution) {
        distribution[row.tier as Tier] = row.count;
      }
    }

    return distribution;
  }

  /**
   * Get sessions by tier
   */
  getSessionsByTier(tier: Tier): string[] {
    const sessions = this.db.prepare(`
      SELECT id FROM sessions WHERE tier = ?
    `).all(tier) as any[];

    return sessions.map(s => s.id);
  }

  /**
   * Get sessions eligible for tier transition
   */
  getEligibleForTransition(fromTier: Tier, toTier: Tier): TierClassification[] {
    const classifications = this.db.prepare(`
      SELECT
        s.id,
        s.created_at,
        s.last_active,
        s.entry_count,
        s.pinned,
        s.tier as current_tier,
        COALESCE(s.compaction_exempt, 0) as compaction_exempt,
        (julianday('now') - julianday(s.last_active)) as age_days,
        CASE WHEN EXISTS (
          SELECT 1 FROM knowledge_entries ke
          WHERE ke.session_id = s.id AND ke.priority = 'high'
        ) THEN 1 ELSE 0 END as has_high_priority
      FROM sessions s
      WHERE s.tier = ?
    `).all(fromTier) as any[];

    return classifications
      .map(session => this.classifySession(session))
      .filter(c => c.recommended_tier === toTier);
  }

  /**
   * Pin a session (exempt from compaction)
   */
  async pinSession(sessionId: string): Promise<void> {
    this.db.prepare(`
      UPDATE sessions
      SET pinned = 1, tier = 'hot'
      WHERE id = ?
    `).run(sessionId);

    logger.info({ sessionId }, 'Session pinned');
  }

  /**
   * Unpin a session
   */
  async unpinSession(sessionId: string): Promise<void> {
    this.db.prepare(`
      UPDATE sessions
      SET pinned = 0
      WHERE id = ?
    `).run(sessionId);

    logger.info({ sessionId }, 'Session unpinned');
  }

  /**
   * Mark session as compaction exempt
   */
  async setCompactionExempt(sessionId: string, exempt: boolean): Promise<void> {
    this.db.prepare(`
      UPDATE sessions
      SET compaction_exempt = ?
      WHERE id = ?
    `).run(exempt ? 1 : 0, sessionId);

    logger.info({ sessionId, exempt }, 'Session compaction exemption updated');
  }
}

/**
 * Factory function
 */
export function createTierManager(
  db: Database.Database,
  thresholds?: TierThresholds
): TierManager {
  return new TierManager(db, thresholds);
}
