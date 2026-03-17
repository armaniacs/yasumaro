/**
 * privacyConsent.test.ts
 * テスト: プライバシーポリシー同意管理
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    getPrivacyConsent,
    savePrivacyConsent,
    withdrawPrivacyConsent,
    getConsentWithdrawalHistory
} from '../privacyConsent.js';

// Mock global.crypto for Web Crypto API polyfill
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: () => new Uint32Array(10),
    },
});

// chrome.storage.local のモック
const storageMock: Record<string, unknown> = {};

(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn(async (keys: string | string[]) => {
                const ks = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(ks.map(k => [k, storageMock[k]]));
            }),
            set: jest.fn(async (data: Record<string, unknown>) => {
                Object.assign(storageMock, data);
            })
        }
    }
};

beforeEach(() => {
    Object.keys(storageMock).forEach(k => delete storageMock[k]);
    jest.clearAllMocks();
});

describe('withdrawPrivacyConsent', () => {
    it('should set hasConsented to false and record withdrawal', async () => {
        await savePrivacyConsent('2026-02-23');
        const withdrawal = await withdrawPrivacyConsent();

        expect(withdrawal.withdrawalDate).toBeTruthy();
        expect(withdrawal.previousConsentVersion).toBe('2026-02-23');

        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('should preserve withdrawal history', async () => {
        await savePrivacyConsent();
        await withdrawPrivacyConsent();

        const history = await getConsentWithdrawalHistory();
        expect(history).not.toBeNull();
        expect(history?.withdrawalDate).toBeTruthy();
    });

    it('getConsentWithdrawalHistory returns null when no withdrawal', async () => {
        const history = await getConsentWithdrawalHistory();
        expect(history).toBeNull();
    });
});