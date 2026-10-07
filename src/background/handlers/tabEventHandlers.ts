/**
 * Tab Event Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles tab removal, activation, and navigation badge updates.
 */
import { HeaderDetector } from '../headerDetector.js';
import { setBadge } from '../badgePolicy.js';
import { resolveTabBadge } from './tabBadgeResolver.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import { TabCache } from '../tabCache.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface TabHandlerContext {
    tabCache: TabCache;
    autoSavedBadgeTabs: {
        has: (tabId: number) => boolean;
        delete: (tabId: number) => void;
        restore: () => Promise<void>;
        resetRestoreOnce?: () => void;
    };
    getPrivacyCache?: () => Map<string, PrivacyInfo> | null;
    /** 記録ゲート（同意状態）。未指定の場合は「記録中」バッジを表示しない。 */
    isRecordingAllowed?: () => Promise<boolean>;
}

export function createTabEventHandlers(ctx: TabHandlerContext) {
    async function handleTabRemoved(tabId: number): Promise<void> {
        // PBI 2026-09-12-25: re-arm restore so the next restore (e.g. badge
        // determination) re-prunes against the post-removal tab set.
        ctx.autoSavedBadgeTabs.resetRestoreOnce?.();
        await ctx.autoSavedBadgeTabs.restore();
        ctx.tabCache.removeAndFlush ? await ctx.tabCache.removeAndFlush(tabId) : ctx.tabCache.remove(tabId);
        ctx.autoSavedBadgeTabs.delete(tabId);
    }

    async function handleTabActivated(activeInfo: { tabId: number }): Promise<void> {
        await ctx.autoSavedBadgeTabs.restore();
        try {
            // ADR 2026-10-07: manifest に `tabs` 権限がなく host_permissions も
            // localhost/AI provider のみのため、通常サイトでは `tab.url` が黙って
            // `undefined` になる（Chrome はエラーを返さない）。URL 由来の badge 状態
            // （private / excluded / recording）は通常サイトで表示されないことが
            // 裁定済み。recorded は isRecorded（URL 非依存）で維持される。
            const tab = await chrome.tabs.get(activeInfo.tabId);
            const tabId = activeInfo.tabId;
            const normalizedUrl = tab.url ? HeaderDetector.normalizeUrl(tab.url) : undefined;
            const cache = ctx.getPrivacyCache ? ctx.getPrivacyCache() : null;
            const privacyInfo = normalizedUrl ? cache?.get(normalizedUrl) : undefined;
            // Decision lives in TabBadgeResolver (PBI 2026-09-12-09); this
            // handler keeps only I/O. Tab-derived states are written PER-TAB
            // (PBI 2026-09-12-07).
            const state = await resolveTabBadge({
                privacyInfo,
                url: tab.url,
                isRecorded: ctx.autoSavedBadgeTabs.has(tabId),
                forActivation: true,
                isRecordingAllowed: ctx.isRecordingAllowed,
            });
            await setBadge(state, tabId);
        } catch (error) {
            await logError('Failed to update badge on tab activation', {
                tabId: activeInfo.tabId,
                error: errorMessage(error)
            }, ErrorCode.BADGE_UPDATE_FAILED, 'service-worker.ts');
            await setBadge({ kind: 'clear' }, activeInfo.tabId);
        }
    }

    /**
     * Handle tab navigation - update badge after page load completes.
     */
    async function handleTabUpdated(tabId: number, changeInfo: { status?: string }, tab: { url?: string }): Promise<void> {
        await ctx.autoSavedBadgeTabs.restore();
        // ADR 2026-10-07: `tabs` 権限なしでは通常サイトの `tab.url` が黙って
        // undefined になり、この経路は遷移時に構造的に no-op になる（privacy /
        // excluded / C{n} クリアも `autoSavedBadgeTabs.delete` も走らない）。
        // 裁定は manifest 変更なしでこの欠落を受容するもの。ユーザー起因の表面
        // （popup / context menu = activeTab 発火時）では URL が読める。
        if (changeInfo.status !== 'complete' || !tab.url) return;
        // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
        ctx.autoSavedBadgeTabs.delete(tabId);
        const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
        const cache = ctx.getPrivacyCache ? ctx.getPrivacyCache() : null;
        const privacyInfo = cache?.get(normalizedUrl);
        const state = await resolveTabBadge({
            privacyInfo,
            url: tab.url,
            isRecorded: false,
            forActivation: false,
        });
        await setBadge(state, tabId);
    }

    return { handleTabRemoved, handleTabActivated, handleTabUpdated };
}
