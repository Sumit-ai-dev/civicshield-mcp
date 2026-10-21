/**
 * Automated Tests for Memory Store, Safe Ingestion, Quarantine & Persistence
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CommunityMemoryStore } from '../src/memoryStore.js';
import { storage } from '../src/storage.js';

describe('Memory Store & Safe Ingestion (Phases 3, 5, 6, 10)', () => {
  let store: CommunityMemoryStore;

  before(() => {
    store = new CommunityMemoryStore();
    store.resetToDefaults();
  });

  it('rejects feedback on unknown memory ID', () => {
    assert.throws(
      () => store.recordFeedback('nonexistent_id_9999', 'failure'),
      /does not exist/
    );
  });

  it('feedback on one memory does NOT modify another memory', () => {
    const memWater = store.getById('exp_water_01');
    const memElectric = store.getById('exp_electric_02');
    assert.ok(memWater && memElectric);

    const waterInitialScore = memWater.trustScore;
    const electricInitialScore = memElectric.trustScore;

    store.recordFeedback('exp_water_01', 'failure', 'Water test incident');

    const updatedWater = store.getById('exp_water_01');
    const updatedElectric = store.getById('exp_electric_02');

    assert.notEqual(updatedWater?.trustScore, waterInitialScore);
    assert.equal(updatedElectric?.trustScore, electricInitialScore);
  });

  it('enforces idempotency: duplicate feedback event ID does not double-apply penalty', () => {
    // Reset to known state
    store.resetToDefaults();
    const eventId = 'idempotent_test_event_001';

    // First feedback call: 0.45 * 0.70 = 0.315
    const res1 = store.recordFeedback('exp_rumor_kerosene', 'failure', 'First attempt', eventId);
    assert.equal(res1.isDuplicate, false);
    assert.equal(res1.newScore, 0.315);
    assert.equal(res1.isQuarantined, true);

    // Second feedback call with SAME eventId: must return prior state without decaying again
    const res2 = store.recordFeedback('exp_rumor_kerosene', 'failure', 'Retried attempt', eventId);
    assert.equal(res2.isDuplicate, true);
    assert.equal(res2.newScore, 0.315);

    // Verify in store
    const mem = store.getById('exp_rumor_kerosene');
    assert.equal(mem?.trustScore, 0.315);
    assert.equal(mem?.failureCount, 2); // original was 1 + 1 from first attempt; duplicate did not increment
  });

  it('safe ingestion policy: caps initial trust at 0.60 and marks as unverified', () => {
    // Attempting to set initialTrust to 1.0
    const ingested = store.store(
      'Community chlorine purification guideline for borewells',
      'Add official chlorine tablets according to volume specifications.',
      'health',
      'Bengaluru East',
      'Self-Proclaimed Health Specialist',
      1.0 // Client attempts to claim 100% trust
    );

    assert.equal(ingested.verificationStatus, 'unverified');
    assert.equal(ingested.trustScore, 0.60); // Capped to 0.60
    assert.equal(ingested.claimedAuthority, 'Self-Proclaimed Health Specialist');
    assert.equal(ingested.isQuarantined, false);
  });

  it('rejects empty or malformed task and solution', () => {
    assert.throws(() => store.store('', 'Valid solution description', 'civic'), /Task must be a string/);
    assert.throws(() => store.store('Valid task description', '', 'civic'), /Solution must be a string/);
    assert.throws(() => store.store('Valid task description', 'Valid solution', 'invalid_cat' as any), /Invalid category/);
  });

  it('retrieval strictly excludes quarantined memories', () => {
    // exp_rumor_kerosene is quarantined in earlier test (score 0.315 < 0.35)
    const results = store.retrieve('kerosene mosquito larvae water');
    const matchedKerosene = results.find(r => r.memory.id === 'exp_rumor_kerosene');

    assert.equal(matchedKerosene, undefined);
  });

  it('retrieval filters out memories below minTrust threshold', () => {
    // Water has trust 0.96; flood has trust 0.92.
    // Querying with minTrust = 0.95 must exclude flood (0.92 < 0.95)
    const highTrustOnly = store.retrieve('urban flash flood', 0.95);
    const matchedFlood = highTrustOnly.find(r => r.memory.id === 'exp_flood_03');
    assert.equal(matchedFlood, undefined);

    // Querying with minTrust = 0.90 must include flood (0.92 >= 0.90)
    const lowerCutoff = store.retrieve('urban flash flood', 0.90);
    const matchedLower = lowerCutoff.find(r => r.memory.id === 'exp_flood_03');
    assert.ok(matchedLower);
  });

  it('recovers state from durable storage across store re-instantiation', () => {
    // Retrieve current state of water
    const originalWater = store.getById('exp_water_01');
    assert.ok(originalWater);

    // Create a new independent store instance pointing to same storage
    const newStoreInstance = new CommunityMemoryStore();
    const restoredWater = newStoreInstance.getById('exp_water_01');

    assert.ok(restoredWater);
    assert.equal(restoredWater.trustScore, originalWater.trustScore);
    assert.equal(restoredWater.isQuarantined, originalWater.isQuarantined);
    assert.equal(restoredWater.failureCount, originalWater.failureCount);
  });
});
