/**
 * crypto/kdfNegotiator.ts (PBI 2026-09-15-13)
 *
 * KDF iteration 交渉を単一の深い module に集約する。
 *
 * WHY: 「stored → SSOT 現行 → legacy」の候補ループが settingsExportImport と
 * settingsMigration に手書きされており、iteration 変更時に3箇所の同期編集が
 * 必要。1箇所の修正漏れが「復号不能＝APIキー喪失」に直結する。
 *
 * 交渉順序: stored iterations（自己記述がある場合）→ SSOT 現行 → legacy 100k。
 * envelope 形式（iterations 自己記述あり）と legacy 形式（iteration 不在）の
 * 両方に対応する。
 */

import { CRYPTO_PARAMS } from './cryptoParams.js';
// Barrel import: the crypto tests mock '../crypto/index.js', so importing
// through the barrel ensures the mock covers kdfNegotiator's dependencies too.
import { deriveKey, decryptData, base64ToBytes } from './index.js';
import { StorageKeys } from '../storage/types.js';

/** 交渉結果。legacy 形式は iteration を自己記述しないため usedIterations は null。 */
export interface KdfNegotiationResult {
    text: string;
    usedIterations: number | null;
    /** legacy iteration で復号成功 → 再暗号化（SSOT iteration への移行）推奨。 */
    needsRehash: boolean;
}

/**
 * パスワード + salt + iteration から AES-GCM 鍵を導出する。
 * PBKDF2 パラメータの知識を1関数に集約する共通ヘルパー。
 */
export async function deriveKeyWithIterations(
    password: string,
    saltB64: string,
    iterations: number
): Promise<CryptoKey> {
    const salt = base64ToBytes(saltB64);
    return deriveKey(password, salt, iterations);
}

/**
 * stored iterations → SSOT 現行 → legacy 100k の順で鍵導出を試行し、
 * ciphertext を復号する交渉ループ。
 *
 * legacy で復号成功した場合は needsRehash=true を返し、呼び出し側が
 * SSOT iteration での再暗号化を判断できるようにする。
 */
export async function decryptWithIterationCandidates(
    password: string,
    saltB64: string,
    ciphertext: string,
    iv: string,
    storedIterations?: number
): Promise<KdfNegotiationResult> {
    const candidates: number[] = [];
    if (typeof storedIterations === 'number' && storedIterations > 0) {
        candidates.push(storedIterations);
    }
    candidates.push(CRYPTO_PARAMS.PBKDF2_ITERATIONS, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const unique = [...new Set(candidates)];

    let lastError: unknown;
    for (const iterations of unique) {
        try {
            const key = await deriveKeyWithIterations(password, saltB64, iterations);
            const text = await decryptData({ ciphertext, iv }, key);
            const isLegacy = iterations === CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
            return {
                text,
                usedIterations: iterations,
                needsRehash: isLegacy,
            };
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError ?? new Error('Decryption failed');
}

/**
 * Firefox/anonymous モード用: storage に保存された salt/secret から
 * legacy iteration（100k）の AES-GCM 鍵を導出する。
 * settingsMigration の手書き PBKDF2 を置換する共通ヘルパー。
 */
export async function deriveLegacyKeyFromStoredSecret(): Promise<CryptoKey | null> {
    try {
        const stored = await chrome.storage.local.get([
            StorageKeys.ENCRYPTION_SALT,
            StorageKeys.ENCRYPTION_SECRET,
        ]);
        const saltB64 = stored[StorageKeys.ENCRYPTION_SALT] as string | undefined;
        const secretB64 = stored[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
        if (!saltB64 || !secretB64) return null;

        const salt = base64ToBytes(saltB64);
        // Deliberately NOT base64ToBytes: this reproduces how the legacy key
        // material was derived, which UTF-8-encoded atob's latin-1 output. Any
        // byte ≥ 0x80 becomes two bytes that way, so the two spellings produce
        // different key material — swapping them here would make existing
        // encrypted API keys undecryptable (PBI 2026-09-15-16).
        const secretBytes = new TextEncoder().encode(atob(secretB64));
        const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: salt as BufferSource, iterations: CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS, hash: 'SHA-256' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    } catch {
        return null;
    }
}
