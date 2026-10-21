/**
 * CivicShield & AEMA Type Definitions
 *
 * Distinguishes:
 * - Unverified (provisional submissions from clients or untrusted sources)
 * - Verified (officially reviewed or verified community records)
 * - Quarantined (isolated records whose trust fell strictly below quarantine cutoff)
 */

export type MemoryCategory = 'civic' | 'health' | 'disaster' | 'welfare';

export type VerificationStatus = 'unverified' | 'verified' | 'quarantined';

export interface CommunityMemory {
  id: string;
  category: MemoryCategory;
  task: string;
  solution: string;
  trustScore: number;
  isQuarantined: boolean;
  verificationStatus: VerificationStatus;
  failureCount: number;
  successCount: number;
  location: string;
  claimedAuthority: string;
  verifiedAuthority?: string;
  authority: string; // for backward compatibility in UI / MCP
  isTestFixture?: boolean; // explicitly marks intentionally fabricated test fixtures
  quarantinedAt?: string;
  quarantineReason?: string;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type WALEventType = 
  | 'STORE'
  | 'RETRIEVE'
  | 'FEEDBACK_SUCCESS'
  | 'FEEDBACK_FAILURE'
  | 'QUARANTINE_TRIGGERED'
  | 'FEEDBACK_DUPLICATE_IGNORED'
  | 'RESET';

export interface WALEntry {
  id: string;
  timestamp: string;
  eventType: WALEventType;
  memoryId: string;
  eventId?: string; // Client idempotency key
  previousTrust?: number;
  newTrust?: number;
  outcome?: 'success' | 'failure';
  reason?: string;
  quarantined: boolean;
  provenance?: {
    source?: string;
    authority?: string;
  };
}

export interface RetrievalResult {
  memory: CommunityMemory;
  effectiveScore: number;
  isReliable: boolean;
}

export interface FeedbackResult {
  eventId: string;
  memoryId: string;
  previousScore: number;
  newScore: number;
  isQuarantined: boolean;
  isDuplicate: boolean;
  message: string;
}

export interface SystemAuditReport {
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  totalMemories: number;
  activeCount: number;
  quarantinedCount: number;
  quarantineRatio: number;
  averageTrustScore: number;
  negativeTransferRiskScore: number;
  recommendations: string[];
}
