/**
 * cleansingOffscreenDelegate.ts — Content Script 側の Offscreen委譲 PoC
 *
 * html 文字列のクレンジングを Offscreen Document に委譲する試み。
 * feature flag `cleansing_offscreen_enabled` が true の時のみ委譲し、
 * 失敗・未対応環境では同期的にフォールバックする。
 */

import { cleanseHtmlOffscreen } from '../offscreen/cleansingOffscreen.js';
import { StorageKeys } from '../utils/storage/types.js';

// PBI 2026-09-11-05 (round 7): module-level cache — the flag is read once,
// invalidated by chrome.storage.onChanged. The old code hit storage on every
// cleanse call.
let cachedFlag: boolean | null = null;
let storageListenerWired = false;

/** Test seam — resets the module-level flag cache (PBI 2026-09-11-05). */
export function __resetCleansingFlagCacheForTesting(): void {
    cachedFlag = null;
    storageListenerWired = false;
}

async function isCleansingOffscreenEnabled(): Promise<boolean> {
    if (cachedFlag !== null) return cachedFlag;
    try {
        const g = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
        if (g?.storage?.local?.get) {
            const result = await g.storage.local.get(StorageKeys.CLEANSING_OFFSCREEN_ENABLED);
            const v = (result as Record<string, unknown>)[StorageKeys.CLEANSING_OFFSCREEN_ENABLED];
            cachedFlag = v === true;
            if (g.storage.onChanged?.addListener && !storageListenerWired) {
                storageListenerWired = true;
                g.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
                    if (area === 'local' && changes[StorageKeys.CLEANSING_OFFSCREEN_ENABLED]) {
                        cachedFlag = null;
                    }
                });
            }
            return cachedFlag;
        }
    } catch {
        // fall through
    }
    return false;
}

/**
 * 同期フォールバック: 現在のコンテキストで直接クレンジングを実行する。
 * Offscreen と同一の `cleanseHtmlOffscreen` 純粋関数を呼び出すので結果は一致する。
 */
export function cleanseHtmlSync(html: string): string {
    try {
        const { html: cleansed } = cleanseHtmlOffscreen(html);
        return cleansed;
    } catch {
        return html;
    }
}

/**
 * Offscreen へのクレンジング委譲を試み、失敗時は同期フォールバックする。
 *
 * @param html クレンジング対象の HTML 文字列（outerHTML / innerHTML）
 * @returns cleansed HTML 文字列
 */
export async function cleanseViaOffscreen(html: string): Promise<string> {
    const enabled = await isCleansingOffscreenEnabled();
    if (!enabled) {
        return cleanseHtmlSync(html);
    }

    try {
        const g = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
        if (!g?.runtime?.sendMessage) {
            return cleanseHtmlSync(html);
        }

        const response = (await g.runtime.sendMessage({
            target: 'offscreen',
            type: 'CLEANSING_OFFSCREEN',
            payload: { html },
        } as unknown as never)) as unknown as
            | { success: true; html: string }
            | { success: false; error: string }
            | undefined;

        if (response && (response as { success: boolean }).success === true && typeof (response as { html: string }).html === 'string') {
            return (response as { html: string }).html;
        }
        return cleanseHtmlSync(html);
    } catch {
        return cleanseHtmlSync(html);
    }
}

/** テストや計測用途で feature flag を確認する必要がある場合に公開 */
export { isCleansingOffscreenEnabled };
