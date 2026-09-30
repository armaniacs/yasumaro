/**
 * privacyConsentSignatureReset.test.ts (PBI 2026-09-30-05)
 *
 * A consent whose signature no longer verifies (HMAC key regenerated) must be
 * surfaced through the existing re-consent path instead of a bare "unconsented".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPrivacyConsent, savePrivacyConsent, shouldPromptForConsent } from '../privacyConsent.js';
import { StorageKeys } from '../types.js';

describe('privacy consent with invalid signature', () => {
    beforeEach(async () => {
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
    });

    it('reports needsReconsent and signatureInvalid when verification fails', async () => {
        await savePrivacyConsent();
        const stored = (await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT))[StorageKeys.PRIVACY_CONSENT] as Record<string, unknown>;
        await chrome.storage.local.set({ [StorageKeys.PRIVACY_CONSENT]: { ...stored, signature: 'invalid-signature' } });

        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
        expect(state.needsReconsent).toBe(true);
        expect(state.signatureInvalid).toBe(true);
        expect(await shouldPromptForConsent()).toBe(true);
    });

    it('does not flag a valid signature', async () => {
        await savePrivacyConsent();
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
        expect(state.signatureInvalid).toBeUndefined();
    });

    it('recovers after re-consent', async () => {
        await savePrivacyConsent();
        const stored = (await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT))[StorageKeys.PRIVACY_CONSENT] as Record<string, unknown>;
        await chrome.storage.local.set({ [StorageKeys.PRIVACY_CONSENT]: { ...stored, signature: 'bad' } });
        await savePrivacyConsent();
        expect((await getPrivacyConsent()).hasConsented).toBe(true);
    });
});
