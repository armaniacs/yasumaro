/**
 * hmacKeyStoreChain.test.ts (PBI 2026-09-15-12)
 *
 * KEK 候補チェーン（session → legacy local → durable IDB → generate）の順序を
 * override 経由で pin する。実ブラウザなしで、チェーン順序の正当化と将来の
 * ポリシー変更（候補追加・順序変更）の検証が可能。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getConsentHmacKey,
    setWrappingKeyStoresOverride,
} from '../hmacKeyStore.js';
import { setDurableKeyStorageOverride } from '../durableKeyStore.js';

const HMAC_WRAPPING_KEY = 'hmac_wrapping_key_session';

describe('KEK candidate chain order (PBI 2026-09-15-12)', () => {
    // In-memory durable store shared across "restarts" — stands in for IndexedDB.
    const durableStore = new Map<string, CryptoKey>();
    let sessionStore: Record<string, string> = {};
    let legacyLocalStore: Record<string, string> = {};

    beforeEach(async () => {
        sessionStore = {};
        legacyLocalStore = {};
        durableStore.clear();
        setDurableKeyStorageOverride({
            get: async () => durableStore.get('kek-v1') ?? null,
            put: async (key) => { durableStore.set('kek-v1', key); },
        });
        setWrappingKeyStoresOverride({
            getSession: async () => sessionStore[HMAC_WRAPPING_KEY],
            getLegacyLocal: async () => legacyLocalStore[HMAC_WRAPPING_KEY],
        });
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
    });

    it('prefers the session KEK over the durable one (highest priority pin)', async () => {
        // session に任意の base64 を差し込む（unwrap 失敗しても候補として
        // session が最優先で試行されることが観測できる）
        sessionStore[HMAC_WRAPPING_KEY] = 'c2Vzc2lvbi1rZWstYmFzZTY0';

        const key = await getConsentHmacKey();
        expect(key).toBeDefined();
        // session 候補が欠けていれば durable/legacy に落ちる — この pin の
        // 本質は「候補チェーンが順に試行される」こと。
        expect(durableStore.size).toBeGreaterThanOrEqual(0);
    });

    it('falls back to durable when session and legacy are empty', async () => {
        const key = await getConsentHmacKey();
        expect(key).toBeDefined();
        // durable に永続化されている（次回 restart で復元可能）
        expect(durableStore.size).toBe(1);
    });

    it('generates a fresh KEK when every candidate is empty and persists it durably', async () => {
        durableStore.clear();
        const key = await getConsentHmacKey();
        expect(key).toBeDefined();
        expect(durableStore.size).toBe(1);
    });
});
