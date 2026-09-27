/**
 * recoveryClaimStore.ts — durable mutual exclusion for recording recovery.
 *
 * PBI 2026-09-25-12: a failed recording has exactly one recovery owner at a
 * time — either the offline-queue job (5-minute automatic retries) or a
 * pending-page manual re-run. The claim lives in chrome.storage.local so it
 * survives Service Worker restarts; PerUrlMutex serializes within one SW
 * process only and cannot back a durable exclusion.
 *
 * All three user entry points (popup pendingPages, dashboard sqliteHistory
 * panel, notification button) and the offline queue processor route through
 * claimRecoveryOwner() before starting a recovery run. The claim TTL resolves
 * claims orphaned by a SW death mid-run — the recording itself then still
 * has the pending page as its recovery surface.
 */

import { withOptimisticLock } from './storage/storageTransaction.js';

const CLAIMS_KEY = 'recording_recovery_claims';

/** A claim older than this is stale (SW died mid-run) and may be re-claimed. */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Who holds the claim: the offline queue processor or a manual surface. */
export type RecoveryOwner = 'offline-queue' | 'manual';

export interface RecoveryClaim {
  url: string;
  owner: RecoveryOwner;
  claimedAt: number;
}

interface ClaimMap {
  [url: string]: RecoveryClaim | undefined;
}

function isFresh(claim: RecoveryClaim | undefined, now: number): boolean {
  return claim !== undefined && now - claim.claimedAt < CLAIM_TTL_MS;
}

function asClaimMap(value: unknown): ClaimMap {
  return value !== null && typeof value === 'object' ? (value as ClaimMap) : {};
}

/**
 * Try to become the recovery owner for `url`. Returns false when a fresh
 * claim already exists (the caller must not start a second run); an expired
 * claim is taken over. Atomic via the shared optimistic-lock CAS.
 */
export async function claimRecoveryOwner(url: string, owner: RecoveryOwner): Promise<boolean> {
  const now = Date.now();
  let claimed = false;
  await withOptimisticLock<ClaimMap>(CLAIMS_KEY, (current) => {
    const claims = asClaimMap(current);
    if (isFresh(claims[url], now)) {
      return claims;
    }
    claimed = true;
    return { ...claims, [url]: { url, owner, claimedAt: now } };
  });
  return claimed;
}

/**
 * Release the caller's own claim. A claim held by another owner (or already
 * expired and re-taken) is left untouched.
 */
export async function releaseRecoveryOwner(url: string, owner: RecoveryOwner): Promise<void> {
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

/** Read the current claim, if any. Expired claims read as null. */
export async function getRecoveryOwner(url: string): Promise<RecoveryClaim | null> {
  const result = await chrome.storage.local.get(CLAIMS_KEY);
  const claim = asClaimMap(result[CLAIMS_KEY])[url];
  return isFresh(claim, Date.now()) ? (claim as RecoveryClaim) : null;
}
