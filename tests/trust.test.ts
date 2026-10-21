/**
 * Automated Unit Tests for A-EMA Trust Engine & Theorem 1 Quarantine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  updateTrustScore,
  isQuarantineTriggered,
  computeQuarantineSteps,
  validateTrustScore,
  validateParameter,
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  DEFAULT_QUARANTINE_THRESHOLD,
} from '../src/trust.js';

describe('Trust Engine & Quarantine Rules (Phase 2 & Phase 10)', () => {
  it('updates trust correctly on success (reinforcement rule)', () => {
    // 0.85 * 0.80 + 0.15 * 1.0 = 0.68 + 0.15 = 0.83
    const updated = updateTrustScore(0.80, 'success');
    assert.equal(updated, 0.83);
  });

  it('updates trust correctly on failure (decay penalty rule)', () => {
    // 0.70 * 0.45 = 0.315
    const updated = updateTrustScore(0.45, 'failure');
    assert.equal(updated, 0.315);
  });

  it('quarantines exactly when trust is strictly below threshold', () => {
    assert.equal(isQuarantineTriggered(0.315, 0.35), true);
    assert.equal(isQuarantineTriggered(0.3499, 0.35), true);
    assert.equal(isQuarantineTriggered(0.36, 0.35), false);
  });

  it('does NOT quarantine on exact threshold equality (boundary condition)', () => {
    // Exact threshold boundary: 0.35 < 0.35 is FALSE
    assert.equal(isQuarantineTriggered(0.35, 0.35), false);
  });

  it('tracks consecutive failures down to quarantine deterministically', () => {
    let score = 1.0;
    // Step 1: 1.0 * 0.7 = 0.70
    score = updateTrustScore(score, 'failure');
    assert.equal(score, 0.70);
    assert.equal(isQuarantineTriggered(score), false);

    // Step 2: 0.70 * 0.7 = 0.49
    score = updateTrustScore(score, 'failure');
    assert.equal(score, 0.49);
    assert.equal(isQuarantineTriggered(score), false);

    // Step 3: 0.49 * 0.7 = 0.343 (< 0.35 -> Quarantine!)
    score = updateTrustScore(score, 'failure');
    assert.equal(score, 0.343);
    assert.equal(isQuarantineTriggered(score), true);
  });

  it('computeQuarantineSteps agrees with simulation across boundary conditions', () => {
    assert.equal(computeQuarantineSteps(1.0, 0.35, 0.70), 3);
    assert.equal(computeQuarantineSteps(0.45, 0.35, 0.70), 1);
    assert.equal(computeQuarantineSteps(0.35, 0.35, 0.70), 1);
    assert.equal(computeQuarantineSteps(0.34, 0.35, 0.70), 0);
  });

  it('rejects invalid scores (NaN, Infinity, negatives, above 1)', () => {
    assert.throws(() => validateTrustScore(NaN), TypeError);
    assert.throws(() => validateTrustScore(Infinity), TypeError);
    assert.throws(() => validateTrustScore(-0.1), TypeError);
    assert.throws(() => validateTrustScore(1.05), TypeError);
    assert.throws(() => updateTrustScore(NaN, 'success'), TypeError);
    assert.throws(() => updateTrustScore(0.5, 'invalid' as any), TypeError);
  });

  it('rejects invalid alpha and beta parameters', () => {
    assert.throws(() => validateParameter(0.0, 'alpha'), TypeError);
    assert.throws(() => validateParameter(1.0, 'beta'), TypeError);
    assert.throws(() => validateParameter(-0.5, 'alpha'), TypeError);
  });
});
