/**
 * hmacKeyStoreRestart.test.ts
 *
 * Regression pin for the Firefox QA finding: the privacy-consent signature
 * reset on every browser restart because the HMAC wrapping key (KEK) was
 * session-only (M3) — after a restart the consent key could not be unwrapped,
 * a fresh key was generated, and the consent signature failed verification,
 * re-prompting the user. The durable IndexedDB key store restores the intent
 * of fix 678f879d (consent persists across restarts) without storing key
 * material as bytes (M3/VULN-010 posture preserved).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getConsentHmacKey } from '../hmacKeyStore.js';
import { hmacSignerForKey } from '../hmacSigner.js';
import { setDurableKeyStorageOverride } from '../durableKeyStore.js';

// In-memory durable store shared across "restarts" — stands in for IndexedDB.
const durableStore = new Map<string, CryptoKey>();

describe('hmacKeyStore restart persistence (durable KEK)', () => {
  beforeEach(async () => {
    durableStore.clear();
    setDurableKeyStorageOverride({
      get: async () => durableStore.get('kek-v1') ?? null,
      put: async (key) => { durableStore.set('kek-v1', key); },
    });
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('consent signature survives a simulated browser restart', async () => {
    // Session 1: user consents — the record is signed with the session KEK.
    const key1 = await getConsentHmacKey();
    const signature = await hmacSignerForKey(async () => key1, 'base64url').sign('consent-payload');

    // Simulated browser restart: the session store is wiped; chrome.storage.local
    // (the wrapped envelope) and the durable IndexedDB key store survive.
    await chrome.storage.session.clear();
    const key2 = await getConsentHmacKey();
    expect(await hmacSignerForKey(async () => key2, 'base64url').verify('consent-payload', signature)).toBe(true);
  });

  it('falls back to a fresh key when the durable store is unavailable', async () => {
    const key1 = await getConsentHmacKey();
    const signature = await hmacSignerForKey(async () => key1, 'base64url').sign('consent-payload');

    // Restart with a wiped session AND a lost durable store (e.g. profile
    // corruption): the old envelope cannot be unwrapped — the fail-open path
    // generates a fresh key instead of throwing.
    await chrome.storage.session.clear();
    durableStore.clear();

    const key2 = await getConsentHmacKey();
    expect(await hmacSignerForKey(async () => key2, 'base64url').verify('consent-payload', signature)).toBe(false);
    // The new key still works for signing (self-healed).
    const sig2 = await hmacSignerForKey(async () => key2, 'base64url').sign('consent-payload');
    expect(await hmacSignerForKey(async () => key2, 'base64url').verify('consent-payload', sig2)).toBe(true);
  });
});
