import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateEncryptionKey, clearEncryptionKeyCache } from '../encryptionSession.js';
import { StorageKeys } from '../types.js';

/**
 * Creates a promise together with externally-callable resolve/reject
 * functions. Used below to pause call B's session.get in the middle of its
 * own execution until call A has fully finished migrating the secret,
 * without relying on setTimeout-based timing (which would be flaky given
 * that both calls otherwise resolve on the microtask queue).
 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('getOrCreateEncryptionKey concurrency', () => {
    beforeEach(() => {
        // モジュールスコープのキャッシュ変数をテスト間でリセットする。
        // これをしないと、前のテストで生成された cachedEncryptionKey が
        // 残ったままになり、このテストが意味をなさなくなる。
        clearEncryptionKeyCache();
        vi.restoreAllMocks();
    });

    it('does not regenerate a new secret when two calls race during session-to-local migration', async () => {
        // 前提条件を作る: saltはlocalにあるがsecretはまだ無く（＝復元前の状態）、
        // session側に旧バージョンから引き継がれたsecretが残っている状態を再現する。
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: false,
            [StorageKeys.ENCRYPTION_SALT]: 'ZmFrZS1zYWx0LWJhc2U2NA==',
        });
        await chrome.storage.session.set({
            [StorageKeys.ENCRYPTION_SECRET]: 'ZmFrZS1zZWNyZXQtYmFzZTY0',
        });

        // 再現したいレース（TOCTOU）はこうである:
        //   1. Bが最初のlocal.get（救済マイグレーション判定より前）を実行し、
        //      その時点ではsecretがまだlocalに無いことを確認する。
        //   2. その直後、Aが自分の移行処理をすべて完了させる
        //      （session.get → local.set → session.remove）。
        //   3. Bはステップ1の判定結果に基づいて救済マイグレーション分岐に
        //      進み、session.getを呼ぶが、その時点ではAが既にsessionを
        //      クリアした後なので、Bはsecretを見つけられず、
        //      「初回」ロジック（新規salt/secret生成）に入ってしまう。
        // これを確実に再現するため、Bのsession.get呼び出しをdeferredで
        // ブロックしておき、Aの呼び出しが完全に完了してから解放する。
        const aFinished = createDeferred<void>();

        const originalLocalGetImpl = chrome.storage.local.get.getMockImplementation()!;
        const localGetSpy = vi.spyOn(chrome.storage.local, 'get');
        let hasSpawnedB = false;
        let callBPromise: Promise<CryptoKey> | null = null;
        localGetSpy.mockImplementation(async (keys: string | string[] | null | undefined) => {
            const result = await originalLocalGetImpl(keys);

            if (!hasSpawnedB) {
                hasSpawnedB = true;
                // Bを起動する。Bはこの直後に自分自身のlocal.getを実行して
                // secretなしの状態を観測し、救済マイグレーション分岐へ進もうと
                // する。Bのsession.get（下のモックでブロックする）まで到達した
                // 時点で待機させ、Aが完全に完了してから解放する。
                callBPromise = getOrCreateEncryptionKey();
            }

            return result;
        });

        const originalSessionGetImpl = chrome.storage.session.get.getMockImplementation()!;
        const sessionGetSpy = vi.spyOn(chrome.storage.session, 'get');
        let sessionGetCallCount = 0;
        sessionGetSpy.mockImplementation(async (keys: string | string[] | null | undefined) => {
            sessionGetCallCount += 1;
            if (sessionGetCallCount === 2) {
                // 2回目のsession.get呼び出しはBからのものである
                // （1回目はAからの呼び出し）。Aが完全に完了するまで
                // ここでBをブロックする。
                await aFinished.promise;
            }
            return originalSessionGetImpl(keys);
        });

        const keyA = await getOrCreateEncryptionKey();
        aFinished.resolve();
        expect(callBPromise).not.toBeNull();
        const keyB = await callBPromise!;

        // 両方の呼び出しが同一のsecretから導出されたキーを返すはず。
        // secretそのものは比較できない（CryptoKeyはopaqueなオブジェクトの
        // ため）ので、localに保存されたENCRYPTION_SECRETが1回しか
        // 書き換えられていないこと（＝新規生成が2回発生していないこと）を、
        // 導出されたキー同士が同じ内容で暗号化・復号できることで間接的に
        // 確認する。
        const encoder = new TextEncoder();
        const plaintext = encoder.encode('race-condition-check');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipherFromA = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyA, plaintext);
        const decryptedWithB = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyB, cipherFromA);
        expect(new TextDecoder().decode(decryptedWithB)).toBe('race-condition-check');
    });
});
