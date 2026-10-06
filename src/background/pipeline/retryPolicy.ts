// @layer 1 — Pipeline retry policy (deep seam for structured failure kinds)
import { LEGACY_TRANSPORT_MARKERS_FULL, allowsOfflineRecoveryFor, resolveFailure } from '../../utils/failureTaxonomy.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * Compatibility markers for inputs that predate structured failure metadata.
 * Compatibility only: the list itself is the SSOT
 * (`LEGACY_TRANSPORT_MARKERS_FULL` in `src/utils/failureTaxonomy.ts`); this
 * alias is the pipeline's filtered view for offline-enqueue breadth
 * (ADR 2026-08-27 enumeration: network/fetch/timeout/offline/econnrefused/
 * enotfound + connection/unavailable, plus the unified transport errnos).
 * Substring heuristics like `ai ` were removed — they matched unrelated
 * failures (e.g. "Failed for ai pipeline").
 *
 * This table is NOT the contract. A carrier that carries a `failure` is decided
 * by its kind alone (see `src/utils/failureTaxonomy.ts`, the SSOT for the seven
 * kinds and their retry eligibility); this list is only reached when there is
 * no structured kind to read. No current boundary may produce one of these
 * strings on purpose.
 */
const LEGACY_NETWORK_MARKERS: readonly string[] = LEGACY_TRANSPORT_MARKERS_FULL;

/**
 * RetryPolicy — owns offline-enqueue eligibility.
 *
 * The eligible set is now the kind table's `offlineRecovery` flag: `network`
 * and `timeout` only. `auth`, `rate_limit`, `configuration` and `csp` are
 * operator-side problems, and `http` is a server response whose method-specific
 * delayed recovery is a separate decision (PBI 2026-09-25-12).
 *
 * Accepts both failure carriers — a thrown Error and a result summary carrying
 * `failure` — because `resolveFailure` normalizes them the same way.
 *
 * One adapter = hypothetical seam, two = real. Currently one policy, but the
 * seam is real because tests inject different policies (e.g. always-network-error).
 */
export class RetryPolicy {
  // NOTE (PBI 2026-09-28-29): network-fetch failures live here, transport
  // failures (dead port, torn-down context) live in messageTransport's
  // isRetryableError. Different error universes — deliberately not merged.
  isNetworkError(error: unknown): boolean {
    if (!error) return false;
    const failure = resolveFailure(error);
    if (failure) {
      return allowsOfflineRecoveryFor(failure);
    }
    return this.matchesLegacyNetworkMarker(error);
  }

  shouldEnqueueForOffline(error: unknown): boolean {
    return this.isNetworkError(error);
  }

  private matchesLegacyNetworkMarker(error: unknown): boolean {
    const lower = errorMessage(error).toLowerCase();
    if (LEGACY_NETWORK_MARKERS.some((marker) => lower.includes(marker))) {
      return true;
    }
    if (error instanceof Error && error.cause) {
      return this.matchesLegacyNetworkMarker(error.cause);
    }
    return false;
  }
}

export const defaultRetryPolicy = new RetryPolicy();
