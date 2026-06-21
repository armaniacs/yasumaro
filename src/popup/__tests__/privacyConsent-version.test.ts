// @vitest-environment jsdom
/**
 * privacyConsent-version.test.ts
 * Tests for PBI-23: Privacy Consent Version Migration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local
const storageMock: Record<string, unknown> = {};

vi.mock('../../utils/logger.js', () => ({
    logInfo: vi.fn(async () => {}),
    logWarn: vi.fn(async () => {}),
    logError: vi.fn(async () => {}),
    ErrorCode: { STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE', STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.stubGlobal('chrome', {
    storage: {
        local: {
            get: vi.fn(async (key: string | string[]) => {
                if (Array.isArray(key)) {
                    const result: Record<string, unknown> = {};
                    for (const k of key) {
                        result[k] = storageMock[k];
                    }
                    return result;
                }
                return { [key]: storageMock[key] };
            }),
            set: vi.fn(async (items: Record<string, unknown>) => {
                Object.assign(storageMock, items);
            }),
            remove: vi.fn(async (key: string | string[]) => {
                const keys = Array.isArray(key) ? key : [key];
                for (const k of keys) {
                    delete storageMock[k];
                }
            }),
        },
    },
});

import {
    getPrivacyConsent,
    savePrivacyConsent,
    recordPolicyVersionAcknowledgment,
    isPolicyVersionChanged,
    PRIVACY_POLICY_VERSION,
} from '../privacyConsent.js';

describe('PBI-23: Privacy Consent Version Migration', () => {
    beforeEach(() => {
        // Clear storage mock
        for (const key of Object.keys(storageMock)) {
            delete storageMock[key];
        }
    });

    describe('getPrivacyConsent - version check', () => {
        it('should return needsReconsent: true when consent version is outdated', async () => {
            storageMock['privacy_consent'] = {
                hasConsented: true,
                consentDate: '2026-01-01T00:00:00.000Z',
                consentVersion: '2026-01-01',
            };

            const result = await getPrivacyConsent();
            expect(result.hasConsented).toBe(false);
            expect(result.needsReconsent).toBe(true);
        });

        it('should return needsReconsent: false when version matches', async () => {
            storageMock['privacy_consent'] = {
                hasConsented: true,
                consentDate: '2026-01-01T00:00:00.000Z',
                consentVersion: PRIVACY_POLICY_VERSION,
            };

            const result = await getPrivacyConsent();
            expect(result.hasConsented).toBe(true);
            expect(result.needsReconsent).toBe(false);
        });

        it('should return needsReconsent: undefined for legacy boolean consent', async () => {
            storageMock['privacy_consent'] = true;

            const result = await getPrivacyConsent();
            expect(result.hasConsented).toBe(true);
            // Legacy boolean consent doesn't set needsReconsent
            expect(result.needsReconsent).toBeUndefined();
        });

        it('should return needsReconsent: false for unconsented user', async () => {
            storageMock['privacy_consent'] = {
                hasConsented: false,
                consentDate: '2026-01-01T00:00:00.000Z',
                consentVersion: '2026-01-01',
            };

            const result = await getPrivacyConsent();
            expect(result.hasConsented).toBe(false);
            expect(result.needsReconsent).toBe(false);
        });
    });

    describe('recordPolicyVersionAcknowledgment', () => {
        it('should save current policy version to storage', async () => {
            await recordPolicyVersionAcknowledgment();

            expect(storageMock['privacy_consent_version']).toBe(PRIVACY_POLICY_VERSION);
        });
    });

    describe('isPolicyVersionChanged', () => {
        it('should return true when no version is stored', async () => {
            const result = await isPolicyVersionChanged();
            expect(result).toBe(true);
        });

        it('should return true when stored version differs', async () => {
            storageMock['privacy_consent_version'] = '2026-01-01';
            const result = await isPolicyVersionChanged();
            expect(result).toBe(true);
        });

        it('should return false when stored version matches', async () => {
            storageMock['privacy_consent_version'] = PRIVACY_POLICY_VERSION;
            const result = await isPolicyVersionChanged();
            expect(result).toBe(false);
        });
    });

    describe('savePrivacyConsent - version tracking', () => {
        it('should save consent with current version', async () => {
            await savePrivacyConsent();

            const consent = storageMock['privacy_consent'] as {
                hasConsented: boolean;
                consentVersion: string;
            };
            expect(consent.hasConsented).toBe(true);
            expect(consent.consentVersion).toBe(PRIVACY_POLICY_VERSION);
        });
    });
});
