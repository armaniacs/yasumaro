/**
 * withAtomicKeys.test.ts
 * Unit tests for the multi-key optimistic lock (PBI 2026-08-27-27).
 */

import { withAtomicKeys, ConflictError, enablePostWriteVerification } from '../storage/storageTransaction.js';

describe('withAtomicKeys', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
    });

    describe('二重key原子性', () => {
        it('両キーが単一トランザクションで更新される', async () => {
            await chrome.storage.local.set({
                savedUrls: ['https://a.com'],
                savedUrlsWithTimestamps: [{ url: 'https://a.com', timestamp: 1 }],
            });

            const [nextUrls, nextEntries] = await withAtomicKeys(
                ['savedUrls', 'savedUrlsWithTimestamps'],
                ([urls, entries]) => {
                    const newUrls = [...(urls as string[]), 'https://b.com'];
                    const newEntries = [...(entries as { url: string; timestamp: number }[]), { url: 'https://b.com', timestamp: 2 }];
                    return [newUrls, newEntries];
                }
            );

            expect(nextUrls).toEqual(['https://a.com', 'https://b.com']);
            expect(nextEntries).toHaveLength(2);

            const stored = await chrome.storage.local.get(['savedUrls', 'savedUrlsWithTimestamps']);
            expect(stored.savedUrls).toEqual(['https://a.com', 'https://b.com']);
            expect(stored.savedUrlsWithTimestamps).toHaveLength(2);
        });

        it('中間状態が観測されない（片方だけ書かれることがない）', async () => {
            await chrome.storage.local.set({ keyA: ['a'], keyB: ['b'] });

            const setSpy = vi.spyOn(chrome.storage.local, 'set');

            await withAtomicKeys(['keyA', 'keyB'], ([a, b]) => [
                [...(a as string[]), 'a2'],
                [...(b as string[]), 'b2'],
            ]);

            // Every set() call that touches either key must contain both keys
            // together — there must be no call writing only one of them,
            // which would let a concurrent reader observe a partial update.
            const dataWriteCalls = setSpy.mock.calls.filter(
                ([payload]) => 'keyA' in (payload as object) || 'keyB' in (payload as object)
            );
            expect(dataWriteCalls.length).toBeGreaterThan(0);
            for (const [payload] of dataWriteCalls) {
                expect(payload).toHaveProperty('keyA');
                expect(payload).toHaveProperty('keyB');
            }

            setSpy.mockRestore();
        });
    });

    describe('行順序脆弱性の再現', () => {
        it('post-write verification がキー順序に依存せず一致判定する', async () => {
            enablePostWriteVerification();
            await chrome.storage.local.set({ objKey: { b: 2, a: 1 } });

            // updater returns a logically-identical object but with keys in a
            // different insertion order than what ends up read back from
            // storage — this used to trip naive JSON.stringify comparisons.
            const result = await withAtomicKeys(['objKey'], ([current]) => {
                const c = current as { a: number; b: number };
                return [{ a: c.a, b: c.b }];
            });

            expect(result[0]).toEqual({ a: 1, b: 2 });
        });

        it('キー順序が異なっても同一内容なら競合と判定しない', async () => {
            enablePostWriteVerification();

            const original = chrome.storage.local.get;
            const original_set = chrome.storage.local.set;
            let store: Record<string, unknown> = { objKey: { x: 1, y: 2 }, objKey_version: 0 };

            chrome.storage.local.get = vi.fn(async (keys: string | string[] | null) => {
                const arr = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
                const out: Record<string, unknown> = {};
                arr.forEach((k) => { out[k] = store[k]; });
                return out;
            });
            chrome.storage.local.set = vi.fn(async (data: Record<string, unknown>) => {
                // Simulate storage round-trip re-ordering object keys (e.g. structured
                // clone through IPC), which is the scenario JSON.stringify breaks on.
                Object.entries(data).forEach(([k, v]) => {
                    if (k === 'objKey' && v !== null && typeof v === 'object') {
                        const reordered: Record<string, unknown> = {};
                        Object.keys(v as object).sort().reverse().forEach((kk) => {
                            reordered[kk] = (v as Record<string, unknown>)[kk];
                        });
                        store[k] = reordered;
                    } else {
                        store[k] = v;
                    }
                });
            });

            await expect(
                withAtomicKeys(['objKey'], ([current]) => [{ ...(current as object), z: 3 }])
            ).resolves.toBeDefined();

            chrome.storage.local.get = original;
            chrome.storage.local.set = original_set;
        });
    });

    describe('並行更新の競合検出', () => {
        it('バージョン競合時にConflictErrorをスローする（リトライ0回）', async () => {
            await chrome.storage.local.set({ keyA: ['a'], keyB: ['b'] });

            const originalGet = chrome.storage.local.get;
            let callCount = 0;
            chrome.storage.local.get = vi.fn(async () => {
                callCount++;
                if (callCount === 1) return { keyA: ['a'], keyA_version: 0, keyB: ['b'], keyB_version: 0 };
                return { keyA: ['a'], keyA_version: 5, keyB: ['b'], keyB_version: 0 };
            });

            await expect(
                withAtomicKeys(['keyA', 'keyB'], ([a, b]) => [[...(a as string[]), 'x'], b], { maxRetries: 0 })
            ).rejects.toThrow(ConflictError);

            chrome.storage.local.get = originalGet;
        });

        it('並行更新はリトライの上で最終的に整合する', async () => {
            await chrome.storage.local.set({ keyA: [], keyB: [] });

            const p1 = withAtomicKeys(['keyA', 'keyB'], ([a, b]) => [
                [...(a as string[]), 'from1'],
                [...(b as string[]), 'from1'],
            ]);
            const p2 = withAtomicKeys(['keyA', 'keyB'], ([a, b]) => [
                [...(a as string[]), 'from2'],
                [...(b as string[]), 'from2'],
            ]);

            await Promise.all([p1, p2]);

            const stored = await chrome.storage.local.get(['keyA', 'keyB']);
            // Both updates must be reflected identically across both keys —
            // the core guarantee that replaces the ad-hoc dual-lock dance.
            expect((stored.keyA as string[]).sort()).toEqual((stored.keyB as string[]).sort());
            expect(stored.keyA).toContain('from1');
            expect(stored.keyA).toContain('from2');
        });
    });
});
