/**
 * CivicShield & AEMA Type Definitions
 * Inspired by AEMA, MemPalace, and REA architectures
 */

export type MemoryCategory = 'civic' | 'health' | 'disaster' | 'welfare';

export interface CommunityMemory {
  id: string;
  category: MemoryCategory;
  task: string;
  solution: string;
  trustScore: number;
  isQuarantined: boolean;
  failureCount: number;
  successCount: number;
  location: string;
  authority: string;
  createdAt: string;
  updatedAt: string;
}

export type WALEventType = 
  | 'STORE'
  | 'RETRIEVE'
  | 'FEEDBACK_SUCCESS'
  | 'FEEDBACK_FAILURE'
  | 'QUARANTINE_TRIGGERED'
  | 'DEDUPLICATION';

export interface WALEntry {
  id: string;
  timestamp: string;
  eventType: WALEventType;
  memoryId: string;
  previousTrust?: number;
  newTrust?: number;
  outcome?: 'success' | 'failure';
  reason?: string;
  quarantined: boolean;
}

export interface RetrievalResult {
  memory: CommunityMemory;
  effectiveScore: number;
  isReliable: boolean;
}

export interface FeedbackResult {
  memoryId: string;
  previousScore: number;
  newScore: number;
  isQuarantined: boolean;
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
