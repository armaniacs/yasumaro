/**
 * privacyConsent.test.ts
 * テスト: プライバシーポリシー同意管理
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    getPrivacyConsent,
    savePrivacyConsent,
    hasPrivacyConsent,
    requireConsent,
    migrateLegacyPrivacyConsent,
    withdrawPrivacyConsent,
    getConsentWithdrawalHistory
} from '../privacyConsent.js';

// Mock global.crypto for Web Crypto API polyfill
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: () => new Uint32Array(10),
    },
});

// logger モック
jest.mock('../../utils/logger.js', () => ({
    logInfo: jest.fn(async () => {}),
    logWarn: jest.fn(async () => {}),
    logError: jest.fn(async () => {}),
    ErrorCode: {
        STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE',
        STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE'
    }
}));

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

describe('getPrivacyConsent', () => {
    it('未設定の場合は hasConsented: false', async () => {
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('レガシー boolean true を処理する', async () => {
        storageMock['privacy_consent'] = true;
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
    });

    it('レガシー boolean false を処理する', async () => {
        storageMock['privacy_consent'] = false;
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('オブジェクト形式の同意を読み取る', async () => {
        storageMock['privacy_consent'] = {
            hasConsented: true,
            consentDate: '2026-01-01T00:00:00.000Z',
            consentVersion: '1.0'
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
        expect(state.consentDate).toBe('2026-01-01T00:00:00.000Z');
        expect(state.consentVersion).toBe('1.0');
    });

    it('オブジェクト形式で hasConsented: false を処理する', async () => {
        storageMock['privacy_consent'] = { hasConsented: false };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('ストレージエラー時は false を返す', async () => {
        (global as any).chrome.storage.local.get = jest.fn(async () => {
            throw new Error('Storage error');
        });
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
        // 元に戻す
        (global as any).chrome.storage.local.get = jest.fn(async (keys: string | string[]) => {
            const ks = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(ks.map(k => [k, storageMock[k]]));
        });
    });
});

describe('savePrivacyConsent', () => {
    it('同意を保存する', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.hasConsented).toBe(true);
        expect(saved.consentDate).toBeDefined();
        expect(saved.consentVersion).toBeDefined();
    });

    it('カスタムバージョンで保存する', async () => {
        await savePrivacyConsent('2026-03-01');
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.consentVersion).toBe('2026-03-01');
    });

    it('consentDate が ISO 8601 形式', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.consentDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('ストレージ書き込みエラー時にthrowする', async () => {
        const originalSet = (global as any).chrome.storage.local.set;
        (global as any).chrome.storage.local.set = jest.fn(async () => {
            throw new Error('Storage write error');
        });

        await expect(savePrivacyConsent()).rejects.toThrow('Storage write error');

        (global as any).chrome.storage.local.set = originalSet;
    });
});

describe('hasPrivacyConsent', () => {
    it('同意済みの場合は true', async () => {
        storageMock['privacy_consent'] = { hasConsented: true };
        const result = await hasPrivacyConsent();
        expect(result).toBe(true);
    });

    it('未同意の場合は false', async () => {
        const result = await hasPrivacyConsent();
        expect(result).toBe(false);
    });

    it('レガシー true で true を返す', async () => {
        storageMock['privacy_consent'] = true;
        const result = await hasPrivacyConsent();
        expect(result).toBe(true);
    });
});

describe('requireConsent', () => {
    it('同意済みの場合はエラーを投げない', async () => {
        storageMock['privacy_consent'] = { hasConsented: true };
        await expect(requireConsent()).resolves.not.toThrow();
    });

    it('未同意の場合はエラーを投げる', async () => {
        await expect(requireConsent()).rejects.toThrow('Privacy consent required');
    });
});

describe('migrateLegacyPrivacyConsent', () => {
    it('既に同意済みの場合は false を返す', async () => {
        storageMock['privacy_consent'] = { hasConsented: true };
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('レガシー boolean true の場合は false を返す', async () => {
        storageMock['privacy_consent'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('プライバシー機能使用済みの場合は移行して true を返す', async () => {
        storageMock['privacy_mode'] = 'mask';
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
        // savePrivacyConsent が呼ばれたことを確認
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.hasConsented).toBe(true);
    });

    it('マスターパスワード有効の場合は移行する', async () => {
        storageMock['master_password_enabled'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
    });

    it('プライバシー機能未使用の場合は false を返す', async () => {
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('PII確認UIが設定済みの場合は移行する', async () => {
        storageMock['pii_confirmation_ui'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
    });

    it('ストレージエラー時にfalseを返す', async () => {
        const originalGet = (global as any).chrome.storage.local.get;
        (global as any).chrome.storage.local.get = jest.fn(async () => {
            throw new Error('Storage read error');
        });

        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);

        (global as any).chrome.storage.local.get = originalGet;
    });
});

describe('withdrawPrivacyConsent', () => {
    it('同意を撤回する', async () => {
        await savePrivacyConsent('2026-02-23');
        const withdrawal = await withdrawPrivacyConsent();

        expect(withdrawal.withdrawalDate).toBeTruthy();
        expect(withdrawal.previousConsentVersion).toBe('2026-02-23');

        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('撤回履歴を保存する', async () => {
        await savePrivacyConsent();
        await withdrawPrivacyConsent();

        const history = await getConsentWithdrawalHistory();
        expect(history).not.toBeNull();
        expect(history?.withdrawalDate).toBeTruthy();
    });

    it('previousConsentDate を保持する', async () => {
        await savePrivacyConsent();
        const stateBefore = await getPrivacyConsent();
        const withdrawal = await withdrawPrivacyConsent();

        expect(withdrawal.previousConsentDate).toBe(stateBefore.consentDate);
    });

    it('ストレージ書き込みエラー時にthrowする', async () => {
        await savePrivacyConsent();

        const originalSet = (global as any).chrome.storage.local.set;
        (global as any).chrome.storage.local.set = jest.fn(async () => {
            throw new Error('Storage write error');
        });

        await expect(withdrawPrivacyConsent()).rejects.toThrow('Storage write error');

        (global as any).chrome.storage.local.set = originalSet;
    });
});

describe('getConsentWithdrawalHistory', () => {
    it('撤回履歴がない場合は null を返す', async () => {
        const history = await getConsentWithdrawalHistory();
        expect(history).toBeNull();
    });

    it('撤回履歴がある場合は返す', async () => {
        await savePrivacyConsent();
        await withdrawPrivacyConsent();

        const history = await getConsentWithdrawalHistory();
        expect(history).not.toBeNull();
        expect(history?.withdrawalDate).toBeDefined();
    });
});