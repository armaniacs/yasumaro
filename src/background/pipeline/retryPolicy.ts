// @layer 1 — Pipeline retry policy (deep seam for network error detection)

/**
 * RetryPolicy — owns network-error detection and offline enqueue decision.
 * Enum matches ADR 2026-08-27 (network/fetch/timeout/offline/econnrefused/enotfound)
 * plus connection/unavailable. Substring heuristics like `ai ` were removed — they
 * matched unrelated failures (e.g. "Failed for ai pipeline") and broadened offline
 * eligibility beyond the ADR enumeration. Extracting it makes the policy unit-testable without network
 * and hides the heuristic from the executor's interface.
 *
 * One adapter = hypothetical seam, two = real. Currently one policy, but the
 * seam is real because tests inject different policies (e.g. always-network-error).
 */
export class RetryPolicy {
  isNetworkError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (
      lower.includes('network') ||
      lower.includes('fetch') ||
      lower.includes('timeout') ||
      lower.includes('offline') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('refused') ||
      lower.includes('connection') ||
      lower.includes('unavailable')
    ) {
      return true;
    }
    if (error instanceof Error && error.cause) {
      return this.isNetworkError(error.cause);
    }
    return false;
  }

  shouldEnqueueForOffline(error: unknown): boolean {
    return this.isNetworkError(error);
  }
}

export const defaultRetryPolicy = new RetryPolicy();
