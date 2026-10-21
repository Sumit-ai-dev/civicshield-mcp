/**
 * Community Memory Bank & Immune Store
 * Implements reliable retrieval, A-EMA trust updates, and Theorem 1 Quarantine
 */

import { CommunityMemory, RetrievalResult, FeedbackResult, SystemAuditReport, MemoryCategory } from './types.js';
import { updateTrustScore, isQuarantineTriggered, DEFAULT_QUARANTINE_THRESHOLD } from './trust.js';
import { wal } from './wal.js';
import { SEED_COMMUNITY_MEMORIES } from './data/seedProtocols.js';

export class CommunityMemoryStore {
  private memories: Map<string, CommunityMemory> = new Map();

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.memories.clear();
    for (const mem of SEED_COMMUNITY_MEMORIES) {
      this.memories.set(mem.id, { ...mem });
    }
    wal.log({
      eventType: 'STORE',
      memoryId: 'system_init',
      reason: 'Initialized CivicShield Community Memory Bank with verified protocols',
      quarantined: false,
    });
  }

  public getAll(): CommunityMemory[] {
    return Array.from(this.memories.values());
  }

  public getById(id: string): CommunityMemory | undefined {
    return this.memories.get(id);
  }

  /**
   * Safe Retrieval: Filters out quarantined memories and low-trust scores
   */
  public retrieve(
    query: string,
    minTrust: number = DEFAULT_QUARANTINE_THRESHOLD,
    category?: MemoryCategory
  ): RetrievalResult[] {
    const q = query.toLowerCase();
    const queryTokens = q.split(/\s+/).filter(t => t.length > 2);

    const candidates: RetrievalResult[] = [];

    for (const mem of this.memories.values()) {
      // 1. STRIKE 1 FILTER: Theorem 1 Quarantine Enforcement
      if (mem.isQuarantined) {
        continue; // Strictly omitted to prevent negative transfer!
      }

      // 2. STRIKE 2 FILTER: Trust Cutoff
      if (mem.trustScore < minTrust) {
        continue;
      }

      // Category match
      if (category && mem.category !== category) {
        continue;
      }

      // Semantic / token overlap scoring
      const taskTokens = (mem.task + ' ' + mem.solution + ' ' + mem.location).toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (taskTokens.includes(token)) {
          matchCount++;
        }
      }

      // If at least one matching concept or general relevance
      if (matchCount > 0 || queryTokens.length === 0) {
        const relevance = queryTokens.length > 0 ? matchCount / queryTokens.length : 0.5;
        // Effective score combines semantic relevance with historical trust
        const effectiveScore = parseFloat((0.4 * relevance + 0.6 * mem.trustScore).toFixed(4));

        candidates.push({
          memory: mem,
          effectiveScore,
          isReliable: mem.trustScore >= 0.70,
        });
      }
    }

    // Sort by effective rank descending
    candidates.sort((a, b) => b.effectiveScore - a.effectiveScore);

    wal.log({
      eventType: 'RETRIEVE',
      memoryId: candidates.length > 0 ? candidates[0].memory.id : 'none',
      reason: `Query "${query}" matched ${candidates.length} reliable memories (quarantined records excluded)`,
      quarantined: false,
    });

    return candidates;
  }

  /**
   * Store new community experience with initial trust and WAL log
   */
  public store(
    task: string,
    solution: string,
    category: MemoryCategory = 'civic',
    location: string = 'Bengaluru',
    authority: string = 'Community Contributor',
    initialTrust: number = 0.85
  ): CommunityMemory {
    const id = `exp_${category}_${Date.now().toString().slice(-5)}`;
    const newMemory: CommunityMemory = {
      id,
      category,
      task,
      solution,
      trustScore: initialTrust,
      isQuarantined: false,
      failureCount: 0,
      successCount: 1,
      location,
      authority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.memories.set(id, newMemory);

    wal.log({
      eventType: 'STORE',
      memoryId: id,
      newTrust: initialTrust,
      reason: `Registered new community memory for: "${task}"`,
      quarantined: false,
    });

    return newMemory;
  }

  /**
   * Record outcome feedback: Asymmetric EMA Trust Update & Theorem 1 Quarantine
   */
  public recordFeedback(
    memoryId: string,
    outcome: 'success' | 'failure',
    reason?: string
  ): FeedbackResult {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      throw new Error(`Memory with ID "${memoryId}" does not exist.`);
    }

    const previousScore = memory.trustScore;
    const newScore = updateTrustScore(previousScore, outcome);
    memory.trustScore = newScore;
    memory.updatedAt = new Date().toISOString();

    if (outcome === 'success') {
      memory.successCount++;
    } else {
      memory.failureCount++;
    }

    // Check Theorem 1 Quarantine Bound
    const triggered = isQuarantineTriggered(newScore);
    let message = '';

    if (triggered) {
      memory.isQuarantined = true;
      message = `🚨 [THEOREM 1 QUARANTINE TRIGGERED] Trust dropped to ${(newScore * 100).toFixed(1)}% (below ${DEFAULT_QUARANTINE_THRESHOLD * 100}% threshold). Memory is permanently quarantined to prevent negative transfer to community members.`;
      
      wal.log({
        eventType: 'QUARANTINE_TRIGGERED',
        memoryId,
        previousTrust: previousScore,
        newTrust: newScore,
        outcome,
        reason: reason || 'Trust score decayed below Theorem 1 safety threshold',
        quarantined: true,
      });
    } else {
      message = `Updated trust score for [${memoryId}]: ${(previousScore * 100).toFixed(1)}% -> ${(newScore * 100).toFixed(1)}%. Status: ACTIVE.`;

      wal.log({
        eventType: outcome === 'success' ? 'FEEDBACK_SUCCESS' : 'FEEDBACK_FAILURE',
        memoryId,
        previousTrust: previousScore,
        newTrust: newScore,
        outcome,
        reason: reason || `Execution outcome: ${outcome}`,
        quarantined: false,
      });
    }

    return {
      memoryId,
      previousScore,
      newScore,
      isQuarantined: memory.isQuarantined,
      message,
    };
  }

  /**
   * Diagnostic Audit of Community Memory Bank
   */
  public audit(): SystemAuditReport {
    const all = Array.from(this.memories.values());
    const totalMemories = all.length;
    const quarantinedCount = all.filter(m => m.isQuarantined).length;
    const activeCount = totalMemories - quarantinedCount;
    const quarantineRatio = totalMemories > 0 ? quarantinedCount / totalMemories : 0;

    const avgTrust = totalMemories > 0
      ? all.reduce((acc, m) => acc + m.trustScore, 0) / totalMemories
      : 0;

    // Negative Transfer Risk Score:
    // Measures unquarantined memories that have low trust (< 0.50)
    const vulnerableUnquarantined = all.filter(m => !m.isQuarantined && m.trustScore < 0.50).length;
    const negativeTransferRiskScore = totalMemories > 0 ? vulnerableUnquarantined / totalMemories : 0;

    let healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
    if (negativeTransferRiskScore > 0.3) {
      healthStatus = 'CRITICAL';
    } else if (negativeTransferRiskScore > 0.05) {
      healthStatus = 'DEGRADED';
    }

    const recommendations: string[] = [];
    if (quarantinedCount > 0) {
      recommendations.push(`${quarantinedCount} toxic or failed memory traces isolated under Theorem 1 bounds.`);
    }
    if (vulnerableUnquarantined > 0) {
      recommendations.push(`Monitor ${vulnerableUnquarantined} borderline memories approaching the 35% quarantine cutoff.`);
    } else {
      recommendations.push('Zero vulnerable memories active. Community AI immune system is fully shielded.');
    }

    return {
      healthStatus,
      totalMemories,
      activeCount,
      quarantinedCount,
      quarantineRatio: parseFloat(quarantineRatio.toFixed(3)),
      averageTrustScore: parseFloat(avgTrust.toFixed(3)),
      negativeTransferRiskScore: parseFloat(negativeTransferRiskScore.toFixed(3)),
      recommendations,
    };
  }
}

export const memoryStore = new CommunityMemoryStore();
