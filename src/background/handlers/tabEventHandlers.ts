/**
 * Tab Event Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles tab removal, activation, and navigation badge updates.
 */
import { isDomainAllowed } from '../../utils/domainUtils.js';
import { HeaderDetector } from '../headerDetector.js';
import { setBadge } from '../badgePolicy.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import { TabCache } from '../tabCache.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface TabHandlerContext {
    tabCache: TabCache;
    autoSavedBadgeTabs: {
        has: (tabId: number) => boolean;
        delete: (tabId: number) => void;
        restore: () => Promise<void>;
    };
    getPrivacyCache?: () => Map<string, PrivacyInfo> | null;
    /** 記録ゲート（同意状態）。未指定の場合は「記録中」バッジを表示しない。 */
    isRecordingAllowed?: () => Promise<boolean>;
}

/**
 * Domain filter の除外判定。storage 未設定など失敗時は「除外ではない」に倒す
 * （バッジ表示は補助情報であり、判定不能を「記録されない」と誤表示しない）。
 */
async function isDomainExcluded(url: string): Promise<boolean> {
    try {
        return !(await isDomainAllowed(url));
    } catch {
        return false;
    }
}

export function createTabEventHandlers(ctx: TabHandlerContext) {
    async function handleTabRemoved(tabId: number): Promise<void> {
        await ctx.autoSavedBadgeTabs.restore();
        ctx.tabCache.remove(tabId);
        ctx.autoSavedBadgeTabs.delete(tabId);
    }

    async function handleTabActivated(activeInfo: { tabId: number }): Promise<void> {
        await ctx.autoSavedBadgeTabs.restore();
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            const tabId = activeInfo.tabId;
            // 自動保存バッジ表示中のタブは ◎ を維持
            if (ctx.autoSavedBadgeTabs.has(tabId)) {
                // PBI 2026-09-12-07: badge display lives in the shared BadgePolicy seam.
                await setBadge({ kind: 'recorded' }, tabId);
                return;
            }
            if (!tab.url) {
                await setBadge({ kind: 'clear' }, tabId);
                return;
            }
            const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
            let privacyInfo: PrivacyInfo | undefined;
            const cache = ctx.getPrivacyCache ? ctx.getPrivacyCache() : null;
            privacyInfo = cache?.get(normalizedUrl);
            // Tab-derived states are written PER-TAB (PBI 2026-09-12-07). The
            // old global writes made this tab's state the fallback for every
            // tab without its own override — one tab's "!" bled into others.
            if (privacyInfo?.isPrivate) {
                await setBadge({ kind: 'private' }, tabId);
            } else if (await isDomainExcluded(tab.url)) {
                await setBadge({ kind: 'excluded' }, tabId);
            } else {
                // 記録が有効なタブでは「記録中」を常時可視化する（PBI 2026-09-05-10）。
                // ゲート（同意）が無い場合は無表示を維持する。
                if (ctx.isRecordingAllowed ? await ctx.isRecordingAllowed() : false) {
                    await setBadge({ kind: 'recording' }, tabId);
                } else {
                    await setBadge({ kind: 'clear' }, tabId);
                }
            }
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
        if (changeInfo.status !== 'complete' || !tab.url) return;
        // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
        ctx.autoSavedBadgeTabs.delete(tabId);
        const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
        let privacyInfo: PrivacyInfo | undefined;
        const cache = ctx.getPrivacyCache ? ctx.getPrivacyCache() : null;
        privacyInfo = cache?.get(normalizedUrl);
        if (privacyInfo?.isPrivate) {
            await setBadge({ kind: 'private' }, tabId);
        } else if (await isDomainExcluded(tab.url)) {
            await setBadge({ kind: 'excluded' }, tabId);
        } else {
            // Navigation also clears the per-tab cleansed badge (C{n}) — the
            // state transition replaces the old SW setTimeout (PBI 2026-09-12-07).
            await setBadge({ kind: 'clear' }, tabId);
        }
    }

    return { handleTabRemoved, handleTabActivated, handleTabUpdated };
}
