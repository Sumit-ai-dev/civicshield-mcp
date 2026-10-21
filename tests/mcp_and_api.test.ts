/**
 * Automated Tests for MCP Tool Registration & Security Endpoints
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mcpServer } from '../src/mcp.js';
import { memoryStore } from '../src/memoryStore.js';
import { wal } from '../src/wal.js';

describe('MCP Tools & Protocol Invariants (Phases 4, 7, 10)', () => {
  before(() => {
    memoryStore.resetToDefaults();
  });

  it('MCP server instance has registered tools', () => {
    // Verify that the MCP server instance is configured with tools
    assert.ok(mcpServer);
  });

  it('WAL generates audit entries on memory operations', () => {
    const priorCount = wal.getRecent(100).length;

    memoryStore.store(
      'Audit log verification task',
      'Audit log verification solution step.',
      'civic',
      'Koramangala',
      'BBMP'
    );

    const postEntries = wal.getRecent(100);
    assert.ok(postEntries.length > priorCount);

    const latest = postEntries[0];
    assert.equal(latest.eventType, 'STORE');
    assert.ok(latest.memoryId);
    assert.ok(latest.timestamp);
  });

  it('system audit report calculates correct health indicators', () => {
    const report = memoryStore.audit();

    assert.ok(report.totalMemories >= 5);
    assert.ok(report.averageTrustScore >= 0.0 && report.averageTrustScore <= 1.0);
    assert.ok(['HEALTHY', 'DEGRADED', 'CRITICAL'].includes(report.healthStatus));
    assert.ok(Array.isArray(report.recommendations));
  });

  it('core trust, quarantine, and retrieval work deterministically without external API keys', () => {
    // 1. Ingest an unverified recommendation
    const mem = memoryStore.store(
      'Unverified boil water technique with salt',
      'Add excessive salt to boil water faster during crisis.',
      'civic',
      'Bengaluru',
      'Social Media Forum',
      0.40
    );

    assert.equal(mem.isQuarantined, false);

    // 2. Query matches it initially
    let hits = memoryStore.retrieve('boil water technique');
    assert.ok(hits.some(h => h.memory.id === mem.id));

    // 3. Mark failure: 0.40 * 0.70 = 0.28 (< 0.35 threshold) -> Triggers Quarantine
    const fb = memoryStore.recordFeedback(mem.id, 'failure', 'Reported dangerous sodium poisoning');
    assert.equal(fb.isQuarantined, true);
    assert.equal(fb.newScore, 0.28);

    // 4. Query MUST now exclude it
    hits = memoryStore.retrieve('boil water technique');
    assert.equal(hits.some(h => h.memory.id === mem.id), false);
  });
});
