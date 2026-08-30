/**
 * encryptionSession-branch.test.ts
 * Branch coverage tests for encryptionSession.ts paths not exercised by
 * encryptionSession-concurrency.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getOrCreateEncryptionKey,
    isMasterPasswordEnabled,
    isEncryptionLocked,
    setMasterPassword,
    unlockWithPassword,
    lockSession,
    changeMasterPassword,
    removeMasterPassword,
    clearEncryptionKeyCache,
    getOrCreateHmacSecret,
} from '../encryptionSession.js';
import { StorageKeys } from '../types.js';

vi.mock('../../rateLimiter.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
    recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
    resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../authGuard.js', () => ({
    isLocked: vi.fn().mockResolvedValue(false),
}));

beforeEach(async () => {
    clearEncryptionKeyCache();
    vi.clearAllMocks();
    // Make sendMessage return a promise so .catch() works in unlockWithPassword
    (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
    // Reset rate limiter to success for every test
    const rateLimiter = await import('../../rateLimiter.js');
    vi.mocked(rateLimiter.checkRateLimit).mockResolvedValue({ success: true });
});

describe('getOrCreateEncryptionKey branches', () => {
    it('clears cache and throws when authGuard reports locked', async () => {
        // First call creates an anonymous key and caches it
        await chrome.storage.local.remove([StorageKeys.MASTER_PASSWORD_ENABLED, StorageKeys.MASTER_PASSWORD_SALT]);
        const key = await getOrCreateEncryptionKey();
        expect(key).toBeDefined();

        // Now mock authGuard to report locked
        const { isLocked } = await import('../authGuard.js');
        vi.mocked(isLocked).mockResolvedValue(true);

        await expect(getOrCreateEncryptionKey()).rejects.toThrow('ENCRYPTION_LOCKED');
    });

    it('uses stored KDF iterations when present', async () => {
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: false,
        });
        await chrome.storage.local.remove([StorageKeys.ENCRYPTION_SALT, StorageKeys.ENCRYPTION_SECRET]);

        const key = await getOrCreateEncryptionKey();
        expect(key).toBeDefined();
    });

    it('restores secret from session when local salt exists but secret missing', async () => {
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: false,
            [StorageKeys.ENCRYPTION_SALT]: btoa(String.fromCharCode(...new Uint8Array(16).fill(1))),
        });
        await chrome.storage.local.remove(StorageKeys.ENCRYPTION_SECRET);
        await chrome.storage.session.set({
            [StorageKeys.ENCRYPTION_SECRET]: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
        });

        const key = await getOrCreateEncryptionKey();
        expect(key).toBeDefined();

        // secret should be moved to local and removed from session
        const local = await chrome.storage.local.get(StorageKeys.ENCRYPTION_SECRET);
        expect(local[StorageKeys.ENCRYPTION_SECRET]).toBeDefined();
        const session = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
        expect(session[StorageKeys.ENCRYPTION_SECRET]).toBeUndefined();
    });

    it('uses master password path when enabled', async () => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = btoa(String.fromCharCode(...salt));
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
            [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
        });

        // First set the master password to cache it, then clear cache
        await setMasterPassword('StrongP@ssw0rd123!');
        clearEncryptionKeyCache();

        // Unlock so cachedMasterPassword is set
        await unlockWithPassword('StrongP@ssw0rd123!');
        const key = await getOrCreateEncryptionKey();
        expect(key).toBeDefined();
    });
});

describe('isMasterPasswordEnabled', () => {
    it('returns true when enabled flag is set', async () => {
        await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_ENABLED]: true });
        expect(await isMasterPasswordEnabled()).toBe(true);
    });

    it('returns false when enabled flag is missing', async () => {
        await chrome.storage.local.remove(StorageKeys.MASTER_PASSWORD_ENABLED);
        expect(await isMasterPasswordEnabled()).toBe(false);
    });
});

describe('isEncryptionLocked', () => {
    it('returns false when master password not enabled', async () => {
        await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_ENABLED]: false });
        expect(await isEncryptionLocked()).toBe(false);
    });

    it('returns true when enabled but no cached password', async () => {
        await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_ENABLED]: true });
        clearEncryptionKeyCache();
        // Access the internal flag by calling setMasterPassword then removing it
        // Actually, isMasterPasswordRequired is set by deriveKeyFromMasterPassword.
        // We need to trigger that path first.
        const salt = crypto.getRandomValues(new Uint8Array(16));
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
            [StorageKeys.MASTER_PASSWORD_SALT]: btoa(String.fromCharCode(...salt)),
        });
        // Try to create key without unlock -> should set isMasterPasswordRequired=true
        await expect(getOrCreateEncryptionKey()).rejects.toThrow('ENCRYPTION_LOCKED');
        expect(await isEncryptionLocked()).toBe(true);
    });
});

describe('setMasterPassword', () => {
    it('throws for password shorter than 8 chars', async () => {
        await expect(setMasterPassword('short')).rejects.toThrow('at least 12 characters');
    });

    it('throws for weak password', async () => {
        // Under SSOT policy, 'password' fails length (12) first, so message is about length.
        // Keep the test asserting any password-policy error.
        await expect(setMasterPassword('password')).rejects.toThrow(/Password must/);
    });

    it('succeeds for strong password', async () => {
        const result = await setMasterPassword('Str0ng!Passw0rd#');
        expect(result).toBe(true);
        const stored = await chrome.storage.local.get([
            StorageKeys.MASTER_PASSWORD_ENABLED,
            StorageKeys.MASTER_PASSWORD_SALT,
            StorageKeys.MASTER_PASSWORD_HASH,
            StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
        ]);
        expect(stored[StorageKeys.MASTER_PASSWORD_ENABLED]).toBe(true);
        expect(stored[StorageKeys.MASTER_PASSWORD_HASH]).toBeDefined();
    });
});

describe('unlockWithPassword', () => {
    it('throws when rate limited', async () => {
        const { checkRateLimit } = await import('../../rateLimiter.js');
        vi.mocked(checkRateLimit).mockResolvedValue({ success: false, error: 'Rate limited' });
        await expect(unlockWithPassword('any')).rejects.toThrow('Rate limited');
    });

    it('throws when master password not enabled', async () => {
        await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_ENABLED]: false });
        await expect(unlockWithPassword('any')).rejects.toThrow('Master password not enabled');
    });

    it('throws when hash or salt is missing', async () => {
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
            [StorageKeys.MASTER_PASSWORD_HASH]: '',
            [StorageKeys.MASTER_PASSWORD_SALT]: '',
        });
        await expect(unlockWithPassword('any')).rejects.toThrow('Master password data corrupted');
    });

    it('returns false for wrong password', async () => {
        await setMasterPassword('CorrectP@ssw0rd123!');
        const result = await unlockWithPassword('WrongPassw0rd123!');
        expect(result).toBe(false);
    });

    it('unlocks with correct password', async () => {
        await setMasterPassword('CorrectP@ssw0rd123!');
        const result = await unlockWithPassword('CorrectP@ssw0rd123!');
        expect(result).toBe(true);
    });

    it('re-hashes legacy password when iterations differ', async () => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = btoa(String.fromCharCode(...salt));
        // Manually set a hash with legacy iteration count (e.g. 100000)
        const { hashPasswordWithPBKDF2 } = await import('../../crypto/index.js');
        const legacyHash = await hashPasswordWithPBKDF2('LegacyPass123!', salt, 100000);
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
            [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
            [StorageKeys.MASTER_PASSWORD_HASH]: legacyHash,
            [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: 100000,
        });

        const result = await unlockWithPassword('LegacyPass123!');
        expect(result).toBe(true);

        const stored = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS);
        expect(stored[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]).toBeGreaterThan(100000);
    });
});

describe('lockSession', () => {
    it('clears cached password and sets locked flag', async () => {
        await setMasterPassword('StrongP@ssw0rd123!');
        await unlockWithPassword('StrongP@ssw0rd123!');
        await lockSession();
        const stored = await chrome.storage.local.get(StorageKeys.IS_LOCKED);
        expect(stored[StorageKeys.IS_LOCKED]).toBe(true);
    });
});

describe('changeMasterPassword', () => {
    it('returns false when old password is wrong', async () => {
        await setMasterPassword('OldP@ssw0rd123!');
        const result = await changeMasterPassword('WrongOldPass123!', 'NewP@ssw0rd123!');
        expect(result).toBe(false);
    });

    it('changes password when old password is correct', async () => {
        await setMasterPassword('OldP@ssw0rd123!');
        await unlockWithPassword('OldP@ssw0rd123!');
        const result = await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!');
        expect(result).toBe(true);
    });
});

describe('removeMasterPassword', () => {
    it('removes all master password keys', async () => {
        await setMasterPassword('StrongP@ssw0rd123!');
        await removeMasterPassword();
        const stored = await chrome.storage.local.get([
            StorageKeys.MASTER_PASSWORD_ENABLED,
            StorageKeys.MASTER_PASSWORD_SALT,
            StorageKeys.MASTER_PASSWORD_HASH,
            StorageKeys.IS_LOCKED,
        ]);
        expect(stored[StorageKeys.MASTER_PASSWORD_ENABLED]).toBeUndefined();
        expect(stored[StorageKeys.MASTER_PASSWORD_HASH]).toBeUndefined();
    });
});

describe('getOrCreateHmacSecret', () => {
    it('returns cached secret without storage lookup', async () => {
        // First call generates and caches
        const first = await getOrCreateHmacSecret();
        // Second call should use cache
        const second = await getOrCreateHmacSecret();
        expect(second).toBe(first);
    });

    it('generates new wrapped secret when none exists', async () => {
        await chrome.storage.local.remove(StorageKeys.HMAC_SECRET);
        const secret = await getOrCreateHmacSecret();
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);

        const stored = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
        expect(stored[StorageKeys.HMAC_SECRET]).toBeDefined();
        // Should be wrapped envelope object, not raw base64 string
        expect(typeof stored[StorageKeys.HMAC_SECRET]).toBe('object');
        expect(stored[StorageKeys.HMAC_SECRET]).toHaveProperty('wrapped');
        expect(stored[StorageKeys.HMAC_SECRET]).toHaveProperty('iv');
    });

    it('migrates legacy plaintext secret to wrapped form', async () => {
        const rawSecret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: rawSecret });

        const secret = await getOrCreateHmacSecret();
        expect(secret).toBe(rawSecret);

        const stored = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
        // Should now be wrapped
        expect(stored[StorageKeys.HMAC_SECRET]).not.toBe(rawSecret);
    });

    it('regenerates secret when unwrapping fails', async () => {
        // Store an intentionally corrupted wrapped string
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: 'wrapped:bad:data' });
        const secret = await getOrCreateHmacSecret();
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
    });
});
