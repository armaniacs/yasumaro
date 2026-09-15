// @vitest-environment jsdom
/**
 * privacyConsent-version.test.ts
 * Tests for PBI-23: Privacy Consent Version Migration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local
const storageMock: Record<string, unknown> = {};
const sessionMock: Record<string, unknown> = {};

vi.mock('../../utils/logger.js', () => ({
    logInfo: vi.fn(async () => {}),
    logWarn: vi.fn(async () => {}),
    logError: vi.fn(async () => {}),
    ErrorCode: { STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE', STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.stubGlobal('chrome', {
    runtime: {
        sendMessage: vi.fn(async (message: unknown) => message),
    },
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
        session: {
            get: vi.fn(async (key: string | string[]) => {
                if (Array.isArray(key)) {
                    const result: Record<string, unknown> = {};
                    for (const k of key) {
                        result[k] = sessionMock[k];
                    }
                    return result;
                }
                return { [key]: sessionMock[key] };
            }),
            set: vi.fn(async (items: Record<string, unknown>) => {
                Object.assign(sessionMock, items);
            }),
        },
    },
});

import {
    getPrivacyConsent,
    savePrivacyConsent,
    recordPolicyVersionAcknowledgment,
    isPolicyVersionChanged,
    acceptConsent,
    declineConsent,
    CONSENT_STATE_CHANGED_EVENT,
    PRIVACY_POLICY_VERSION,
} from '../../utils/storage/privacyConsent.js';

describe('PBI-23: Privacy Consent Version Migration', () => {
    beforeEach(() => {
        // Clear storage mock
        for (const key of Object.keys(storageMock)) {
            delete storageMock[key];
        }
        for (const key of Object.keys(sessionMock)) {
            delete sessionMock[key];
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

        it('should return needsReconsent: true for legacy boolean consent (gap closed)', async () => {
            storageMock['privacy_consent'] = true;

            const result = await getPrivacyConsent();
            // WHY: Legacy boolean now forces re-consent (no version) — gap closed in privacyConsent.ts
            expect(result.hasConsented).toBe(false);
            expect(result.needsReconsent).toBe(true);
        });

        it('should return needsReconsent for legacy boolean consent when policy version changes', async () => {
            storageMock['privacy_consent'] = true;
            storageMock['privacy_consent_version'] = 'old-version';

            const result = await getPrivacyConsent();
            // WHY: Legacy boolean always needs re-consent regardless of stored version
            expect(result.hasConsented).toBe(false);
            expect(result.needsReconsent).toBe(true);
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

    // PBI 2026-09-15-08: the accept/decline transitions own the dual-channel
    // notify (same-document event + runtime message). These pins moved here
    // from the controller suite, where the transitions are now mocked.
    describe('consent transitions - dual-channel notify', () => {
        it('accept sends the runtime broadcast and fires the same-document event', async () => {
            const events: Event[] = [];
            const listener = (event: Event): void => { events.push(event); };
            document.addEventListener(CONSENT_STATE_CHANGED_EVENT, listener);

            try {
                await acceptConsent({ contentStorageEnabled: false });

                expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'CONSENT_STATE_CHANGED' })
                );
                expect(events.length).toBeGreaterThanOrEqual(1);
            } finally {
                document.removeEventListener(CONSENT_STATE_CHANGED_EVENT, listener);
            }
        });

        it('decline sends the same bare envelope as accept (INTENTIONAL: value lives in storage)', async () => {
            const sendMessage = vi.mocked(chrome.runtime.sendMessage);
            sendMessage.mockClear();

            await acceptConsent({ contentStorageEnabled: false });
            const acceptEnvelope = sendMessage.mock.calls
                .map((call) => call[0] as Record<string, unknown>)
                .find((arg) => arg?.type === 'CONSENT_STATE_CHANGED');

            document.addEventListener(CONSENT_STATE_CHANGED_EVENT, () => {});
            await declineConsent();
            document.removeEventListener(CONSENT_STATE_CHANGED_EVENT, () => {});

            const declineEnvelope = sendMessage.mock.calls
                .map((call) => call[0] as Record<string, unknown>)
                .filter((arg) => arg?.type === 'CONSENT_STATE_CHANGED')
                .at(-1);
            expect(acceptEnvelope).toBeDefined();
            expect(declineEnvelope).toBeDefined();

            // Contract: both paths send the same shape with the same values —
            // no accept/decline distinction is carried on the message.
            expect(declineEnvelope).toEqual(acceptEnvelope);
            // Bare envelope: no payload and no consent value field.
            expect(declineEnvelope).not.toHaveProperty('payload');
            expect(declineEnvelope).not.toHaveProperty('consented');
        });
    });
});
