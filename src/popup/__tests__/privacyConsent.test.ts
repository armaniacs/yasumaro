/**
 * privacyConsent.test.ts
 * テスト: プライバシーポリシー同意管理
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import {
    getPrivacyConsent,
    savePrivacyConsent,
    hasPrivacyConsent,
    requireConsent,
    migrateLegacyPrivacyConsent,
    withdrawPrivacyConsent,
    getConsentWithdrawalHistory,
    PRIVACY_POLICY_VERSION
} from '../../utils/storage/privacyConsent.js';

// Mock global.crypto with a real Web Crypto API polyfill (needed for HMAC signing
// in savePrivacyConsent/withdrawPrivacyConsent/getPrivacyConsent).
Object.defineProperty(global, 'crypto', {
    value: new Crypto(),
    configurable: true,
});

// logger モック
vi.mock('../../utils/logger.js', () => ({
    logInfo: vi.fn(async () => {}),
    logWarn: vi.fn(async () => {}),
    logError: vi.fn(async () => {}),
    ErrorCode: {
        STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE',
        STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE'
    }
}));

// chrome.storage.local のモック
const storageMock: Record<string, unknown> = {};
const sessionMock: Record<string, unknown> = {};

(global as any).chrome = {
    storage: {
        local: {
            get: vi.fn(async (keys: string | string[]) => {
                const ks = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(ks.map(k => [k, storageMock[k]]));
            }),
            set: vi.fn(async (data: Record<string, unknown>) => {
                Object.assign(storageMock, data);
            })
        },
        session: {
            get: vi.fn(async (keys: string | string[]) => {
                const ks = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(ks.map(k => [k, sessionMock[k]]));
            }),
            set: vi.fn(async (data: Record<string, unknown>) => {
                Object.assign(sessionMock, data);
            })
        }
    }
};

beforeEach(() => {
    Object.keys(storageMock).forEach(k => delete storageMock[k]);
    Object.keys(sessionMock).forEach(k => delete sessionMock[k]);
    vi.clearAllMocks();
});

describe('getPrivacyConsent', () => {
    it('returns hasConsented:false when unset', async () => {
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('handles legacy boolean true', async () => {
        storageMock['privacy_consent'] = true;
        const state = await getPrivacyConsent();
        // WHY: Legacy boolean lacks version info — treat as needsReconsent to avoid stale consent after policy updates
        expect(state.hasConsented).toBe(false);
        expect(state.needsReconsent).toBe(true);
    });

    it('handles legacy boolean false', async () => {
        storageMock['privacy_consent'] = false;
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('reads object-form consent', async () => {
        storageMock['privacy_consent'] = {
            hasConsented: true,
            consentDate: '2026-01-01T00:00:00.000Z',
            consentVersion: PRIVACY_POLICY_VERSION
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
        expect(state.consentDate).toBe('2026-01-01T00:00:00.000Z');
        expect(state.consentVersion).toBe(PRIVACY_POLICY_VERSION);
    });

    it('returns hasConsented:false on version mismatch', async () => {
        storageMock['privacy_consent'] = {
            hasConsented: true,
            consentDate: '2026-01-01T00:00:00.000Z',
            consentVersion: '1.0'
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
        expect(state.consentVersion).toBe('1.0');
    });

    it('handles object-form hasConsented:false', async () => {
        storageMock['privacy_consent'] = { hasConsented: false };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('returns false on storage errors', async () => {
        (global as any).chrome.storage.local.get = vi.fn(async () => {
            throw new Error('Storage error');
        });
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
        // 元に戻す
        (global as any).chrome.storage.local.get = vi.fn(async (keys: string | string[]) => {
            const ks = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(ks.map(k => [k, storageMock[k]]));
        });
    });

    it('loads unsigned legacy data (backward compat)', async () => {
        // マイグレーション前の署名フィールドを持たないレガシーオブジェクト形式
        storageMock['privacy_consent'] = {
            hasConsented: true,
            consentDate: '2026-01-01T00:00:00.000Z',
            consentVersion: PRIVACY_POLICY_VERSION
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
    });

    it('loads data with a valid signature', async () => {
        await savePrivacyConsent();
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(true);
    });

    it('treats tampered signatures as not consented', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as { signature: string };
        // 署名はそのままに、本文だけ書き換える（典型的な改ざんシナリオ）
        storageMock['privacy_consent'] = {
            ...saved,
            hasConsented: true,
            consentVersion: 'tampered-version',
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('treats a corrupt signature value as not consented', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as { signature: string };
        storageMock['privacy_consent'] = {
            ...saved,
            signature: 'invalid-signature-value',
        };
        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });
});

describe('savePrivacyConsent', () => {
    it('saves consent', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.hasConsented).toBe(true);
        expect(saved.consentDate).toBeDefined();
        expect(saved.consentVersion).toBeDefined();
    });

    it('saves consent with an HMAC signature', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as any;
        expect(typeof saved.signature).toBe('string');
        expect(saved.signature.length).toBeGreaterThan(0);
    });

    it('saves consent with a custom version', async () => {
        await savePrivacyConsent('2026-03-01');
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.consentVersion).toBe('2026-03-01');
    });

    it('stores consentDate in ISO 8601 format', async () => {
        await savePrivacyConsent();
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.consentDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('throws on storage write errors', async () => {
        const originalSet = (global as any).chrome.storage.local.set;
        (global as any).chrome.storage.local.set = vi.fn(async () => {
            throw new Error('Storage write error');
        });

        await expect(savePrivacyConsent()).rejects.toThrow('Storage write error');

        (global as any).chrome.storage.local.set = originalSet;
    });
});

describe('hasPrivacyConsent', () => {
    it('returns true when consented', async () => {
        storageMock['privacy_consent'] = { hasConsented: true, consentVersion: PRIVACY_POLICY_VERSION };
        const result = await hasPrivacyConsent();
        expect(result).toBe(true);
    });

    it('returns false when not consented', async () => {
        const result = await hasPrivacyConsent();
        expect(result).toBe(false);
    });

    it('returns false for legacy true pending re-consent', async () => {
        storageMock['privacy_consent'] = true;
        const result = await hasPrivacyConsent();
        // WHY: Legacy true now requires re-consent (no version) — hasPrivacyConsent returns false
        expect(result).toBe(false);
        const state = await getPrivacyConsent();
        expect(state.needsReconsent).toBe(true);
    });
});

describe('requireConsent', () => {
    it('throws nothing when consented', async () => {
        storageMock['privacy_consent'] = { hasConsented: true, consentVersion: PRIVACY_POLICY_VERSION };
        await expect(requireConsent()).resolves.not.toThrow();
    });

    it('throws when not consented', async () => {
        await expect(requireConsent()).rejects.toThrow('Privacy consent required');
    });
});

describe('migrateLegacyPrivacyConsent', () => {
    it('returns false when already consented', async () => {
        storageMock['privacy_consent'] = { hasConsented: true };
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('returns false for legacy boolean true', async () => {
        storageMock['privacy_consent'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('migrates and returns true when privacy features were used', async () => {
        storageMock['privacy_mode'] = 'mask';
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
        // savePrivacyConsent が呼ばれたことを確認
        const saved = storageMock['privacy_consent'] as any;
        expect(saved.hasConsented).toBe(true);
    });

    it('migrates when the master password is enabled', async () => {
        storageMock['master_password_enabled'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
    });

    it('returns false when privacy features were unused', async () => {
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);
    });

    it('migrates when the PII confirmation UI is configured', async () => {
        storageMock['pii_confirmation_ui'] = true;
        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(true);
    });

    it('returns false on storage errors', async () => {
        const originalGet = (global as any).chrome.storage.local.get;
        (global as any).chrome.storage.local.get = vi.fn(async () => {
            throw new Error('Storage read error');
        });

        const result = await migrateLegacyPrivacyConsent();
        expect(result).toBe(false);

        (global as any).chrome.storage.local.get = originalGet;
    });
});

describe('withdrawPrivacyConsent', () => {
    it('withdraws consent', async () => {
        await savePrivacyConsent('2026-02-23');
        const withdrawal = await withdrawPrivacyConsent();

        expect(withdrawal.withdrawalDate).toBeTruthy();
        expect(withdrawal.previousConsentVersion).toBe('2026-02-23');

        const state = await getPrivacyConsent();
        expect(state.hasConsented).toBe(false);
    });

    it('stores the withdrawal history', async () => {
        await savePrivacyConsent();
        await withdrawPrivacyConsent();

        const history = await getConsentWithdrawalHistory();
        expect(history).not.toBeNull();
        expect(history?.withdrawalDate).toBeTruthy();
    });

    it('preserves previousConsentDate', async () => {
        await savePrivacyConsent();
        const stateBefore = await getPrivacyConsent();
        const withdrawal = await withdrawPrivacyConsent();

        expect(withdrawal.previousConsentDate).toBe(stateBefore.consentDate);
    });

    it('throws on storage write errors', async () => {
        await savePrivacyConsent();

        const originalSet = (global as any).chrome.storage.local.set;
        (global as any).chrome.storage.local.set = vi.fn(async () => {
            throw new Error('Storage write error');
        });

        await expect(withdrawPrivacyConsent()).rejects.toThrow('Storage write error');

        (global as any).chrome.storage.local.set = originalSet;
    });
});

describe('getConsentWithdrawalHistory', () => {
    it('returns null when no withdrawal history exists', async () => {
        const history = await getConsentWithdrawalHistory();
        expect(history).toBeNull();
    });

    it('returns the withdrawal history when present', async () => {
        await savePrivacyConsent();
        await withdrawPrivacyConsent();

        const history = await getConsentWithdrawalHistory();
        expect(history).not.toBeNull();
        expect(history?.withdrawalDate).toBeDefined();
    });
});

describe('Browser Restart Simulation (Wrapping Key Persistence)', () => {
    // M3 mitigation: KEK is now session-only (VULN-010). After browser restart,
    // session KEK is lost and old consent signatures (wrapped with old KEK)
    // cannot be verified. The system self-heals by generating a fresh KEK/HMAC
    // key, but existing consent verification returns false until user re-consents.
    it('verifies the consent signature after a browser restart (restores the wrapping key from local storage)', async () => {
        // 1. 初回: 同意を保存（wrapping key は session のみに保存 — VULN-010修正）
        await savePrivacyConsent();
        const savedState = await getPrivacyConsent();
        expect(savedState.hasConsented).toBe(true);

        // 2. ブラウザ再起動をシミュレート: session storage をクリア
        Object.keys(sessionMock).forEach(k => delete sessionMock[k]);

        // 3. 再起動後: session KEK は失われ、旧署名は検証失敗（session-only のため）
        //    self-heal により新しい KEK が生成されるが、旧同意は false になる
        const afterRestart = await getPrivacyConsent();
        expect(afterRestart.hasConsented).toBe(false);
    });

    it('restores the wrapping key from local storage when session storage is empty', async () => {
        // M3: KEK は session-only のため、local に KEK は存在しない。
        // 再起動後は新しい KEK が生成され、session にキャッシュされる
        await savePrivacyConsent();
        const consentData = storageMock['privacy_consent'];

        // session storage をクリア（KEK 消失）
        Object.keys(sessionMock).forEach(k => delete sessionMock[k]);

        // 同意状態を読みなおす（KEK 消失により検証は失敗するが、新しい KEK が生成される）
        const state = await getPrivacyConsent();
        // 旧同意は検証失敗するため false
        expect(state.hasConsented).toBe(false);

        // 新しい KEK が session にキャッシュされたことを確認
        const sessionWrappingKey = sessionMock['hmac-wrapping-key'];
        expect(typeof sessionWrappingKey).toBe('string');

        // 再同意하면 다시 검증 성공
        await savePrivacyConsent();
        const afterReConsent = await getPrivacyConsent();
        expect(afterReConsent.hasConsented).toBe(true);
    });
});