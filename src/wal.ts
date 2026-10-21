/**
 * Immutable Write-Ahead Logging (WAL) System
 * Inspired by MemPalace and AEMA forensic audit standards
 */

import { WALEntry, WALEventType } from './types.js';

class WriteAheadLog {
  private entries: WALEntry[] = [];
  private maxEntries: number = 200;

  public log(entry: Omit<WALEntry, 'id' | 'timestamp'>): WALEntry {
    const fullEntry: WALEntry = {
      id: `wal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.entries.unshift(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }

    return fullEntry;
  }

  public getRecent(limit: number = 20): WALEntry[] {
    return this.entries.slice(0, limit);
  }

  public getAll(): WALEntry[] {
    return [...this.entries];
  }
}

export const wal = new WriteAheadLog();
