/**
 * recoveryClaimStore.ts — durable mutual exclusion for recording recovery.
 *
 * A failed recording has exactly one recovery owner at a time — either the
 * offline-queue job (5-minute automatic retries) or a pending-page manual
 * re-run. The claim lives in chrome.storage.local so it survives Service Worker
 * restarts; an in-process mutex cannot back a durable exclusion.
 *
 * All three user entry points (popup pendingPages, dashboard sqliteHistory
 * panel, notification button) and the offline queue processor route through
 * claimRecoveryOwner() before starting a recovery run. The claim TTL resolves
 * claims orphaned by a SW death mid-run — the recording itself then still
 * has the pending page as its recovery surface.
 *
 * Claims share one storage key, so taking a claim prunes the entries the TTL
 * has already expired in the same CAS. Without that, an entry survives until
 * its own URL is claimed again and the map only ever grows.
 */

import { withOptimisticLock, type CasRetryOptions } from './storage/storageTransaction.js';
import type { SleepFn } from './retryPredicate.js';

const CLAIMS_KEY = 'recording_recovery_claims';

/** A claim older than this is stale (SW died mid-run) and may be re-claimed. */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Who holds the claim: the offline queue processor or a manual surface. */
export type RecoveryOwner = 'offline-queue' | 'manual';

export interface RecoveryClaim {
  url: string;
  owner: RecoveryOwner;
  claimedAt: number;
  /** Unique per claim issuance; the success signal for the issuing call. */
  token: string;
}

interface ClaimMap {
  [url: string]: RecoveryClaim | undefined;
}

export interface RecoveryClaimStore {
  claimRecoveryOwner(url: string, owner: RecoveryOwner): Promise<boolean>;
  releaseRecoveryOwner(url: string, owner: RecoveryOwner): Promise<void>;
}

export interface RecoveryClaimStoreOptions {
  /**
   * Time source the TTL is measured against. Defaults to the wall clock; a test
   * injects a controllable one instead of waiting out the TTL.
   */
  now?: () => number;
  /**
   * Retry wait handed to the shared CAS. Defaults to the production backoff; a
   * test injects a no-op so a forced conflict retry never spends wall time.
   */
  sleep?: SleepFn;
}

/**
 * Unique per issuance, not secrecy — unlike confirmTokenManager there is no
 * fail-closed throw because a claim is a mutual-exclusion hint, not an
 * authorization gate.
 */
function newClaimToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A claim is fresh while its age is strictly below the TTL. */
function isFresh(claim: RecoveryClaim | undefined, now: number): boolean {
  return claim !== undefined && now - claim.claimedAt < CLAIM_TTL_MS;
}

function asClaimMap(value: unknown): ClaimMap {
  return value !== null && typeof value === 'object' ? (value as ClaimMap) : {};
}

function withoutExpiredClaims(claims: ClaimMap, now: number): ClaimMap {
  const kept: ClaimMap = {};
  for (const [claimedUrl, claim] of Object.entries(claims)) {
    if (isFresh(claim, now)) kept[claimedUrl] = claim;
  }
  return kept;
}

export function createRecoveryClaimStore(options: RecoveryClaimStoreOptions = {}): RecoveryClaimStore {
  // Resolved per call rather than captured by reference: a captured Date.now
  // would keep the real clock even while a fake one is installed.
  const now = options.now ?? (() => Date.now());

  /**
   * Try to become the recovery owner for `url`. Returns false when a fresh
   * claim already exists (the caller must not start a second run); an expired
   * claim is taken over. Atomic via the shared optimistic-lock CAS, which also
   * carries the sweep of every other expired claim.
   */
  async function claimRecoveryOwner(url: string, owner: RecoveryOwner): Promise<boolean> {
    const at = now();
    // Issued per call like `at` and stable across CAS retries (captured, not
    // generated inside the updater): a token check, not `claimedAt === at`,
    // is what keeps a same-owner same-millisecond re-claim from reporting
    // ownership of a claim its updater never wrote — two recovery runs would
    // otherwise start.
    const token = newClaimToken();
    // The updater must stay pure: withLock re-runs it after a conflict, so a
    // side effect set on the first attempt would survive a retry that finds
    // the winner's fresh claim and write nothing — the caller would then be
    // told it owns a claim it does not. Decide from the value the lock returns.
    const updater = (current: ClaimMap): ClaimMap => {
      const claims = asClaimMap(current);
      if (isFresh(claims[url], at)) {
        return claims;
      }
      return { ...withoutExpiredClaims(claims, at), [url]: { url, owner, claimedAt: at, token } };
    };
    const casOptions: CasRetryOptions = options.sleep === undefined ? {} : { sleep: options.sleep };
    const written = await withOptimisticLock<ClaimMap>(CLAIMS_KEY, updater, casOptions);
    const mine = asClaimMap(written)[url];
    return mine?.owner === owner && mine.token === token;
  }

  /**
   * Release the caller's own claim. A claim held by another owner (or already
   * expired and re-taken) is left untouched.
   */
  async function releaseRecoveryOwner(url: string, owner: RecoveryOwner): Promise<void> {
    await withOptimisticLock<ClaimMap>(CLAIMS_KEY, (current) => {
      const claims = asClaimMap(current);
      const existing = claims[url];
      if (existing === undefined || existing.owner !== owner) {
        return claims;
      }
      const next = { ...claims };
      delete next[url];
      return next;
    });
  }

  return { claimRecoveryOwner, releaseRecoveryOwner };
}

const defaultStore = createRecoveryClaimStore();

export const { claimRecoveryOwner, releaseRecoveryOwner } = defaultStore;
