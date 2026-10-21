/**
 * Asymmetric Exponential Moving Average (A-EMA) & Theorem 1 Quarantine Engine
 * Directly derived from the AEMA research architecture
 */

export const DEFAULT_ALPHA = 0.85; // Cautious reinforcement on success
export const DEFAULT_BETA = 0.70;  // Fast penalty decay on failure
export const DEFAULT_QUARANTINE_THRESHOLD = 0.35; // Theta cutoff bound

/**
 * Update trust score using Asymmetric Exponential Moving Average (A-EMA)
 * Success: S_t = alpha * S_{t-1} + (1 - alpha) * 1.0
 * Failure: S_t = beta * S_{t-1} + (1 - beta) * 0.0 = beta * S_{t-1}
 */
export function updateTrustScore(
  currentScore: number,
  outcome: 'success' | 'failure',
  alpha: number = DEFAULT_ALPHA,
  beta: number = DEFAULT_BETA
): number {
  let updated: number;
  if (outcome === 'success') {
    updated = alpha * currentScore + (1 - alpha) * 1.0;
  } else {
    // Sharp exponential penalty on failure to protect community
    updated = beta * currentScore;
  }
  // Clamp between 0.0 and 1.0
  return Math.min(1.0, Math.max(0.0, parseFloat(updated.toFixed(4))));
}

/**
 * Check whether a memory has crossed Theorem 1 Quarantine Threshold
 */
export function isQuarantineTriggered(
  trustScore: number,
  threshold: number = DEFAULT_QUARANTINE_THRESHOLD
): boolean {
  return trustScore < threshold;
}

/**
 * Compute maximum consecutive failures before quarantine under Theorem 1:
 * k = ceil( ln(theta / S_0) / ln(beta) )
 */
export function computeQuarantineSteps(
  initialScore: number = 1.0,
  threshold: number = DEFAULT_QUARANTINE_THRESHOLD,
  beta: number = DEFAULT_BETA
): number {
  if (initialScore <= threshold) return 0;
  return Math.ceil(Math.log(threshold / initialScore) / Math.log(beta));
}
