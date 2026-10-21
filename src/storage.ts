/**
 * CivicShield Durable Persistence Layer
 *
 * Implements ACID persistence using Node.js native SQLite (DatabaseSync).
 * Provides process-restart durability and idempotent feedback tracking.
 *
 * NOTE ON DURABILITY:
 * This database provides standard single-instance SQLite durability (ACID)
 * with Write-Ahead Logging on the host filesystem. It is NOT cryptographically
 * immutable or distributed.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { CommunityMemory, WALEntry } from './types.js';

export class StorageEngine {
  private db: DatabaseSync;
  public readonly isDurable: boolean;
  public readonly dbPath: string;

  constructor(customPath?: string) {
    const targetPath = customPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'civicshield.sqlite');
    this.dbPath = targetPath;

    if (targetPath === ':memory:') {
      this.db = new DatabaseSync(':memory:');
      this.isDurable = false;
    } else {
      try {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new DatabaseSync(targetPath);
        this.isDurable = true;
        // Enable WAL mode for high concurrency & reliability
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
      } catch (err) {
        console.warn(`[WARN] Failed to open SQLite at "${targetPath}", falling back to in-memory:`, err);
        this.db = new DatabaseSync(':memory:');
        this.isDurable = false;
      }
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        task TEXT NOT NULL,
        solution TEXT NOT NULL,
        trust_score REAL NOT NULL,
        is_quarantined INTEGER NOT NULL,
        verification_status TEXT NOT NULL,
        failure_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        location TEXT NOT NULL,
        claimed_authority TEXT NOT NULL,
        verified_authority TEXT,
        authority TEXT NOT NULL,
        is_test_fixture INTEGER NOT NULL DEFAULT 0,
        quarantined_at TEXT,
        quarantine_reason TEXT,
        last_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wal_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        event_id TEXT,
        previous_trust REAL,
        new_trust REAL,
        outcome TEXT,
        reason TEXT,
        quarantined INTEGER NOT NULL,
        provenance TEXT
      );

      CREATE TABLE IF NOT EXISTS applied_feedback_events (
        event_id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        previous_score REAL NOT NULL,
        new_score REAL NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_quarantined ON memories(is_quarantined);
      CREATE INDEX IF NOT EXISTS idx_wal_timestamp ON wal_events(timestamp DESC);
    `);
  }

  public hasMemories(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as { cnt: number } | undefined;
    return (row?.cnt ?? 0) > 0;
  }

  public saveMemory(mem: CommunityMemory): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (
        id, category, task, solution, trust_score, is_quarantined, verification_status,
        failure_count, success_count, location, claimed_authority, verified_authority,
        authority, is_test_fixture, quarantined_at, quarantine_reason, last_verified_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      mem.id,
      mem.category,
      mem.task,
      mem.solution,
      mem.trustScore,
      mem.isQuarantined ? 1 : 0,
      mem.verificationStatus,
      mem.failureCount,
      mem.successCount,
      mem.location,
      mem.claimedAuthority,
      mem.verifiedAuthority || null,
      mem.authority,
      mem.isTestFixture ? 1 : 0,
      mem.quarantinedAt || null,
      mem.quarantineReason || null,
      mem.lastVerifiedAt || null,
      mem.createdAt,
      mem.updatedAt
    );
  }

  public getMemory(id: string): CommunityMemory | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapMemoryRow(row);
  }

  public getAllMemories(): CommunityMemory[] {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.mapMemoryRow(r));
  }

  private mapMemoryRow(row: any): CommunityMemory {
    return {
      id: row.id,
      category: row.category,
      task: row.task,
      solution: row.solution,
      trustScore: row.trust_score,
      isQuarantined: Boolean(row.is_quarantined),
      verificationStatus: row.verification_status,
      failureCount: row.failure_count,
      successCount: row.success_count,
      location: row.location,
      claimedAuthority: row.claimed_authority,
      verifiedAuthority: row.verified_authority || undefined,
      authority: row.authority,
      isTestFixture: Boolean(row.is_test_fixture),
      quarantinedAt: row.quarantined_at || undefined,
      quarantineReason: row.quarantine_reason || undefined,
      lastVerifiedAt: row.last_verified_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public isFeedbackEventApplied(eventId: string): any {
    return this.db.prepare('SELECT * FROM applied_feedback_events WHERE event_id = ?').get(eventId);
  }

  public recordFeedbackTransaction(
    eventId: string,
    memory: CommunityMemory,
    walEntry: WALEntry,
    feedbackRecord: {
      eventId: string;
      memoryId: string;
      outcome: string;
      previousScore: number;
      newScore: number;
      appliedAt: string;
    }
  ): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.saveMemory(memory);

      const walStmt = this.db.prepare(`
        INSERT INTO wal_events (
          id, timestamp, event_type, memory_id, event_id,
          previous_trust, new_trust, outcome, reason, quarantined, provenance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      walStmt.run(
        walEntry.id,
        walEntry.timestamp,
        walEntry.eventType,
        walEntry.memoryId,
        walEntry.eventId || null,
        walEntry.previousTrust !== undefined ? walEntry.previousTrust : null,
        walEntry.newTrust !== undefined ? walEntry.newTrust : null,
        walEntry.outcome || null,
        walEntry.reason || null,
        walEntry.quarantined ? 1 : 0,
        walEntry.provenance ? JSON.stringify(walEntry.provenance) : null
      );

      const fbStmt = this.db.prepare(`
        INSERT INTO applied_feedback_events (
          event_id, memory_id, outcome, previous_score, new_score, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      fbStmt.run(
        feedbackRecord.eventId,
        feedbackRecord.memoryId,
        feedbackRecord.outcome,
        feedbackRecord.previousScore,
        feedbackRecord.newScore,
        feedbackRecord.appliedAt
      );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public logWAL(entry: WALEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO wal_events (
        id, timestamp, event_type, memory_id, event_id,
        previous_trust, new_trust, outcome, reason, quarantined, provenance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.eventType,
      entry.memoryId,
      entry.eventId || null,
      entry.previousTrust !== undefined ? entry.previousTrust : null,
      entry.newTrust !== undefined ? entry.newTrust : null,
      entry.outcome || null,
      entry.reason || null,
      entry.quarantined ? 1 : 0,
      entry.provenance ? JSON.stringify(entry.provenance) : null
    );
  }

  public getRecentWAL(limit: number = 20): WALEntry[] {
    const rows = this.db.prepare('SELECT * FROM wal_events ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      eventType: r.event_type,
      memoryId: r.memory_id,
      eventId: r.event_id || undefined,
      previousTrust: r.previous_trust !== null ? r.previous_trust : undefined,
      newTrust: r.new_trust !== null ? r.new_trust : undefined,
      outcome: r.outcome || undefined,
      reason: r.reason || undefined,
      quarantined: Boolean(r.quarantined),
      provenance: r.provenance ? JSON.parse(r.provenance) : undefined,
    }));
  }

  public clearAll(): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.db.exec('DELETE FROM memories');
      this.db.exec('DELETE FROM wal_events');
      this.db.exec('DELETE FROM applied_feedback_events');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public close(): void {
    try {
      this.db.close();
    } catch {}
  }
}

export const storage = new StorageEngine();
