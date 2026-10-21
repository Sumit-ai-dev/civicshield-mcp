/**
 * Durable Write-Ahead Logging (WAL) System
 *
 * Implements append-only audit tracking backed by SQLite persistence.
 *
 * NOTE ON AUDIT INTEGRITY:
 * This logger records append-only operational audit events at the application level.
 * It is backed by local ACID storage, not cryptographic signatures or immutable ledgers.
 */

import { WALEntry } from './types.js';
import { storage } from './storage.js';

class WriteAheadLog {
  public log(entry: Omit<WALEntry, 'id' | 'timestamp'>): WALEntry {
    const fullEntry: WALEntry = {
      id: `wal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    storage.logWAL(fullEntry);
    return fullEntry;
  }

  public getRecent(limit: number = 20): WALEntry[] {
    return storage.getRecentWAL(limit);
  }

  public getAll(): WALEntry[] {
    return storage.getRecentWAL(1000);
  }
}

export const wal = new WriteAheadLog();
