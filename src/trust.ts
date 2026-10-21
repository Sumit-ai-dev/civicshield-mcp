/**
 * Asymmetric Exponential Moving Average (A-EMA) & Theorem 1 Quarantine Engine
 *
 * NOTE ON TRUST SCORES:
 * A trust score in CivicShield is an operational reliability heuristic based on
 * observed outcomes. It is NOT a calibrated statistical probability that an item
 * is factually true.
 */

export const DEFAULT_ALPHA = 0.85; // Cautious reinforcement on verified success
export const DEFAULT_BETA = 0.70;  // Rapid penalty decay on failure/hazard
export const DEFAULT_QUARANTINE_THRESHOLD = 0.35; // Strict cutoff bound

/**
 * Validate that a trust score is a valid finite real number within [0.0, 1.0].
 */
export function validateTrustScore(score: number): void {
  if (
    typeof score !== 'number' ||
    Number.isNaN(score) ||
    !Number.isFinite(score) ||
    score < 0.0 ||
    score > 1.0
  ) {
    throw new TypeError(
      `Invalid trust score: ${score}. Trust scores must be finite numbers between 0.0 and 1.0.`
    );
  }
}

/**
 * Validate smoothing / decay parameters within (0.0, 1.0).
 */
export function validateParameter(param: number, name: string): void {
  if (
    typeof param !== 'number' ||
    Number.isNaN(param) ||
    !Number.isFinite(param) ||
    param <= 0.0 ||
    param >= 1.0
  ) {
    throw new TypeError(
      `Invalid parameter "${name}": ${param}. Parameter must be a finite number strictly between 0.0 and 1.0.`
    );
  }
}

/**
 * Update trust score using Asymmetric Exponential Moving Average (A-EMA).
 *
 * Success (outcome === 'success'):
 *   S_t = alpha * S_{t-1} + (1 - alpha) * 1.0
 *
 * Failure (outcome === 'failure'):
 *   S_t = beta * S_{t-1}
 *
 * All results are deterministically rounded to 4 decimal places and clamped to [0.0, 1.0].
 */
export function updateTrustScore(
  currentScore: number,
  outcome: 'success' | 'failure',
  alpha: number = DEFAULT_ALPHA,
  beta: number = DEFAULT_BETA
): number {
  validateTrustScore(currentScore);
  validateParameter(alpha, 'alpha');
  validateParameter(beta, 'beta');

  if (outcome !== 'success' && outcome !== 'failure') {
    throw new TypeError(`Invalid outcome: "${outcome}". Must be "success" or "failure".`);
  }

  let updated: number;
  if (outcome === 'success') {
    updated = alpha * currentScore + (1.0 - alpha) * 1.0;
  } else {
    updated = beta * currentScore;
  }

  const rounded = parseFloat(updated.toFixed(4));
  return Math.min(1.0, Math.max(0.0, rounded));
}

/**
 * Check whether a memory has crossed into quarantine.
 * Quarantine occurs strictly when trustScore < threshold.
 * If trustScore === threshold, it is NOT quarantined.
 */
export function isQuarantineTriggered(
  trustScore: number,
  threshold: number = DEFAULT_QUARANTINE_THRESHOLD
): boolean {
  validateTrustScore(trustScore);
  validateParameter(threshold, 'threshold');
  return trustScore < threshold;
}

/**
 * Compute the exact number of consecutive failures required for a score to fall
 * strictly below the quarantine threshold, directly simulating repeated application
 * of updateTrustScore. This guarantees complete agreement with the runtime update
 * behavior and exact boundary conditions.
 */
export function computeQuarantineSteps(
  initialScore: number = 1.0,
  threshold: number = DEFAULT_QUARANTINE_THRESHOLD,
  beta: number = DEFAULT_BETA
): number {
  validateTrustScore(initialScore);
  validateParameter(threshold, 'threshold');
  validateParameter(beta, 'beta');

  if (isQuarantineTriggered(initialScore, threshold)) {
    return 0;
  }

  let score = initialScore;
  let steps = 0;
  const MAX_STEPS = 1000;

  while (!isQuarantineTriggered(score, threshold) && steps < MAX_STEPS) {
    score = updateTrustScore(score, 'failure', DEFAULT_ALPHA, beta);
    steps++;
  }

  return steps;
}
