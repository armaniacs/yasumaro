/**
 * confirmTokenManager-sw-termination.test.ts
 *
 * Pins where confirm tokens do NOT survive: `chrome.storage.session` is
 * cleared when the MV3 service worker is torn down, so a token issued before
 * a teardown is gone when the dashboard sends it back — the caller sees
 * "Confirmation token mismatch" even though the token was well-formed, within
 * its 60s TTL, and never used.
 *
 * This is the suspected cause of the intermittent archive e2e failures
 * (PBI 2026-09-16-01): those specs wait between issuing and verifying, which
 * is exactly the window an idle service worker is allowed to shut down in.
 *
 * These tests document current behavior. They are expected to change if the
 * storage backing ever moves off session storage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createConfirmToken,
  verifyConfirmToken,
  computeScopeHash,
  __resetConfirmTokensForTesting,
} from '../../../confirmTokenManager.js';

/**
 * Stands in for an MV3 service worker teardown: chrome.storage.session is
 * session-scoped, so everything the previous worker generation wrote is gone.
 * Nothing else about the extension state changes.
 */
async function simulateServiceWorkerTermination(): Promise<void> {
  await chrome.storage.session.clear();
}

describe('confirmTokenManager across a service worker termination', () => {
  beforeEach(async () => {
    await __resetConfirmTokensForTesting();
  });

  afterEach(async () => {
    await __resetConfirmTokensForTesting();
  });

  it('loses a valid unused token when the service worker is torn down', async () => {
    const token = await createConfirmToken('archive_create', 1234);

    // Sanity: the token is good right now, before any teardown.
    // (verify consumes, so re-issue for the actual assertion below.)
    expect(await verifyConfirmToken(token, 'archive_create', 1234)).toBe(true);

    const survivingToken = await createConfirmToken('archive_create', 1234);
    await simulateServiceWorkerTermination();

    // Same token, same binding, well within the 60s TTL, never consumed —
    // yet it no longer verifies, because the record died with the worker.
    expect(await verifyConfirmToken(survivingToken, 'archive_create', 1234)).toBe(false);
  });

  it('loses a scope-bound token the same way', async () => {
    const scopeHash = await computeScopeHash([1_700_000_000_000, false]);
    const token = await createConfirmToken('archive_create', undefined, scopeHash);

    await simulateServiceWorkerTermination();

    expect(await verifyConfirmToken(token, 'archive_create', undefined, scopeHash)).toBe(false);
  });

  it('issues a working token again once the worker is back', async () => {
    const lost = await createConfirmToken('import');
    await simulateServiceWorkerTermination();
    expect(await verifyConfirmToken(lost, 'import')).toBe(false);

    // The failure is not sticky: the next issuance works normally, which is
    // why a retry of the whole issue-then-verify pair usually succeeds and
    // the e2e failures look flaky rather than deterministic.
    const reissued = await createConfirmToken('import');
    expect(await verifyConfirmToken(reissued, 'import')).toBe(true);
  });
});
