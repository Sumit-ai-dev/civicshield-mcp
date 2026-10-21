/**
 * Community Memory Bank & Immune Store
 *
 * Implements:
 * - Durable SQLite recovery & atomic state transactions
 * - Safe memory ingestion (provisional unverified status & capped initial trust)
 * - Deterministic, idempotent feedback updates with audit trail
 * - Strict dual-condition quarantine filtering for zero negative transfer
 */

import {
  CommunityMemory,
  RetrievalResult,
  FeedbackResult,
  SystemAuditReport,
  MemoryCategory,
  VerificationStatus,
} from './types.js';
import {
  updateTrustScore,
  isQuarantineTriggered,
  validateTrustScore,
  DEFAULT_QUARANTINE_THRESHOLD,
} from './trust.js';
import { wal } from './wal.js';
import { storage } from './storage.js';
import { SEED_COMMUNITY_MEMORIES } from './data/seedProtocols.js';

const MAX_TASK_LENGTH = 500;
const MAX_SOLUTION_LENGTH = 1500;
const MAX_UNVERIFIED_INITIAL_TRUST = 0.60;
const DEFAULT_UNVERIFIED_INITIAL_TRUST = 0.50;

export class CommunityMemoryStore {
  private memories: Map<string, CommunityMemory> = new Map();

  constructor() {
    this.init();
  }

  private init(): void {
    if (storage.hasMemories()) {
      // Recover existing persisted state
      const loaded = storage.getAllMemories();
      for (const mem of loaded) {
        // Enforce policy consistency on load: if trust is below cutoff, ensure quarantine flag is set
        if (isQuarantineTriggered(mem.trustScore)) {
          mem.isQuarantined = true;
          mem.verificationStatus = 'quarantined';
        }
        this.memories.set(mem.id, mem);
      }
      console.log(`[INFO] Restored ${this.memories.size} memories from durable storage.`);
    } else {
      // First boot: populate seed protocols
      this.resetToDefaults();
    }
  }

  public resetToDefaults(): void {
    this.memories.clear();
    storage.clearAll();

    for (const mem of SEED_COMMUNITY_MEMORIES) {
      const copy = { ...mem };
      this.memories.set(copy.id, copy);
      storage.saveMemory(copy);
    }

    wal.log({
      eventType: 'RESET',
      memoryId: 'system_init',
      reason: 'Initialized CivicShield Community Memory Bank with verified seed protocols',
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
   * Safe Retrieval:
   * Guarantees that quarantined and low-trust memories are strictly excluded.
   * Both `isQuarantined` flag and `trustScore < minTrust` are enforced.
   */
  public retrieve(
    query: string,
    minTrust: number = DEFAULT_QUARANTINE_THRESHOLD,
    category?: MemoryCategory,
    locationFilter?: string
  ): RetrievalResult[] {
    validateTrustScore(minTrust);

    const safeQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const queryTokens = safeQuery
      .split(/[^a-z0-9]+/i)
      .filter(t => t.length > 2);

    const candidates: RetrievalResult[] = [];

    for (const mem of this.memories.values()) {
      // 1. MANDATORY SAFETY FILTER: Quarantine Exclusion
      if (mem.isQuarantined || isQuarantineTriggered(mem.trustScore, DEFAULT_QUARANTINE_THRESHOLD)) {
        continue;
      }

      // 2. MINIMUM TRUST THRESHOLD FILTER
      if (mem.trustScore < minTrust) {
        continue;
      }

      // 3. CATEGORY FILTER (if requested)
      if (category && mem.category !== category) {
        continue;
      }

      // 4. LOCATION FILTER (if requested)
      if (locationFilter && locationFilter.trim()) {
        const locNeedle = locationFilter.trim().toLowerCase();
        if (!mem.location.toLowerCase().includes(locNeedle)) {
          continue;
        }
      }

      // 5. LEXICAL OVERLAP MATCHING
      const searchableText = `${mem.task} ${mem.solution} ${mem.location} ${mem.claimedAuthority}`.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (searchableText.includes(token)) {
          matchCount++;
        }
      }

      // Include if there are matching tokens or if query is open/empty
      if (matchCount > 0 || queryTokens.length === 0) {
        const lexicalRelevance = queryTokens.length > 0 ? matchCount / queryTokens.length : 0.5;
        // Deterministic composite rank: 40% lexical relevance, 60% historical trust score
        const effectiveScore = parseFloat((0.4 * lexicalRelevance + 0.6 * mem.trustScore).toFixed(4));

        candidates.push({
          memory: mem,
          effectiveScore,
          isReliable: mem.trustScore >= 0.70 && mem.verificationStatus === 'verified',
        });
      }
    }

    // Sort descending by effective score
    candidates.sort((a, b) => b.effectiveScore - a.effectiveScore);

    wal.log({
      eventType: 'RETRIEVE',
      memoryId: candidates.length > 0 ? candidates[0].memory.id : 'none',
      reason: `Query "${safeQuery.slice(0, 50)}" returned ${candidates.length} candidate memories (quarantined records strictly excluded)`,
      quarantined: false,
    });

    return candidates;
  }

  /**
   * Secure Memory Ingestion Policy:
   * Newly submitted memories from clients are always treated as unverified/provisional.
   * Client-supplied initial trust is capped to MAX_UNVERIFIED_INITIAL_TRUST (0.60).
   */
  public store(
    task: string,
    solution: string,
    category: MemoryCategory = 'civic',
    location: string = 'Bengaluru',
    claimedAuthority: string = 'Community Contributor',
    initialTrust?: number
  ): CommunityMemory {
    if (typeof task !== 'string' || task.trim().length < 5) {
      throw new Error(`Task must be a string with at least 5 characters.`);
    }
    if (typeof solution !== 'string' || solution.trim().length < 5) {
      throw new Error(`Solution must be a string with at least 5 characters.`);
    }
    if (task.length > MAX_TASK_LENGTH) {
      throw new Error(`Task exceeds maximum length of ${MAX_TASK_LENGTH} characters.`);
    }
    if (solution.length > MAX_SOLUTION_LENGTH) {
      throw new Error(`Solution exceeds maximum length of ${MAX_SOLUTION_LENGTH} characters.`);
    }

    const validCategories: MemoryCategory[] = ['civic', 'health', 'disaster', 'welfare'];
    if (!validCategories.includes(category)) {
      throw new Error(`Invalid category "${category}". Must be one of: ${validCategories.join(', ')}`);
    }

    // Enforce unverified provisional status and capped initial trust
    let trust = initialTrust !== undefined ? initialTrust : DEFAULT_UNVERIFIED_INITIAL_TRUST;
    validateTrustScore(trust);
    // Never allow an unverified client submission to start above the provisional cap
    if (trust > MAX_UNVERIFIED_INITIAL_TRUST) {
      trust = MAX_UNVERIFIED_INITIAL_TRUST;
    }

    const cleanTask = task.trim();
    const cleanSolution = solution.trim();
    const cleanLocation = (location || 'Bengaluru').trim().slice(0, 150);
    const cleanAuthority = (claimedAuthority || 'Unverified Community Contributor').trim().slice(0, 150);

    const id = `exp_${category}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const newMemory: CommunityMemory = {
      id,
      category,
      task: cleanTask,
      solution: cleanSolution,
      trustScore: trust,
      isQuarantined: isQuarantineTriggered(trust),
      verificationStatus: isQuarantineTriggered(trust) ? 'quarantined' : 'unverified',
      failureCount: 0,
      successCount: 1,
      location: cleanLocation,
      claimedAuthority: cleanAuthority,
      authority: cleanAuthority,
      isTestFixture: false,
      createdAt: now,
      updatedAt: now,
    };

    this.memories.set(id, newMemory);
    storage.saveMemory(newMemory);

    wal.log({
      eventType: 'STORE',
      memoryId: id,
      newTrust: trust,
      reason: `Ingested provisional community memory for: "${cleanTask.slice(0, 40)}"`,
      quarantined: newMemory.isQuarantined,
      provenance: { authority: cleanAuthority, source: cleanLocation },
    });

    return newMemory;
  }

  /**
   * Record Feedback with Idempotency & Theorem 1 Quarantine Enforcement.
   * If the same eventId is retried, the previously recorded state is returned without double-penalizing.
   */
  public recordFeedback(
    memoryId: string,
    outcome: 'success' | 'failure',
    reason?: string,
    eventId?: string
  ): FeedbackResult {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      throw new Error(`Memory with ID "${memoryId}" does not exist.`);
    }

    const safeEventId = eventId || `fb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Check idempotency in storage
    const prior = storage.isFeedbackEventApplied(safeEventId);
    if (prior) {
      wal.log({
        eventType: 'FEEDBACK_DUPLICATE_IGNORED',
        memoryId,
        eventId: safeEventId,
        reason: `Duplicate feedback event ID "${safeEventId}" ignored for idempotency`,
        quarantined: memory.isQuarantined,
      });

      return {
        eventId: safeEventId,
        memoryId,
        previousScore: prior.previous_score,
        newScore: prior.new_score,
        isQuarantined: memory.isQuarantined,
        isDuplicate: true,
        message: `Duplicate feedback event "${safeEventId}" was already processed. No re-application performed.`,
      };
    }

    const previousScore = memory.trustScore;
    const newScore = updateTrustScore(previousScore, outcome);
    const now = new Date().toISOString();

    memory.trustScore = newScore;
    memory.updatedAt = now;

    if (outcome === 'success') {
      memory.successCount++;
    } else {
      memory.failureCount++;
    }

    // Check Theorem 1 Quarantine Bound (strictly < 0.35)
    const triggered = isQuarantineTriggered(newScore, DEFAULT_QUARANTINE_THRESHOLD);
    let message = '';

    if (triggered) {
      memory.isQuarantined = true;
      memory.verificationStatus = 'quarantined';
      memory.quarantinedAt = now;
      memory.quarantineReason = reason || 'Trust score decayed strictly below Theorem 1 quarantine threshold (0.35)';

      message = `[THEOREM 1 QUARANTINE ACTIVATED] Trust score dropped to ${(newScore * 100).toFixed(1)}% (below ${DEFAULT_QUARANTINE_THRESHOLD * 100}% threshold). Memory is isolated and omitted from standard retrieval.`;
    } else {
      message = `Updated trust score for [${memoryId}]: ${(previousScore * 100).toFixed(1)}% -> ${(newScore * 100).toFixed(1)}%. Status: ${memory.verificationStatus.toUpperCase()}.`;
    }

    const walEntry = {
      id: `wal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      eventType: triggered
        ? ('QUARANTINE_TRIGGERED' as const)
        : outcome === 'success'
        ? ('FEEDBACK_SUCCESS' as const)
        : ('FEEDBACK_FAILURE' as const),
      memoryId,
      eventId: safeEventId,
      previousTrust: previousScore,
      newTrust: newScore,
      outcome,
      reason: reason || (triggered ? memory.quarantineReason : `Execution outcome: ${outcome}`),
      quarantined: memory.isQuarantined,
      provenance: {
        authority: memory.authority,
        source: memory.location,
      },
    };

    // Atomic transaction across memory table, WAL table, and idempotency table
    storage.recordFeedbackTransaction(safeEventId, memory, walEntry, {
      eventId: safeEventId,
      memoryId,
      outcome,
      previousScore,
      newScore,
      appliedAt: now,
    });

    return {
      eventId: safeEventId,
      memoryId,
      previousScore,
      newScore,
      isQuarantined: memory.isQuarantined,
      isDuplicate: false,
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

    // Vulnerable memories: active memories approaching cutoff (< 0.50)
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
      recommendations.push(`${quarantinedCount} memory record(s) isolated under Theorem 1 bounds.`);
    }
    if (vulnerableUnquarantined > 0) {
      recommendations.push(`Monitor ${vulnerableUnquarantined} borderline memory record(s) with trust below 50%.`);
    } else {
      recommendations.push('Zero active vulnerable memories below 50% trust.');
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
