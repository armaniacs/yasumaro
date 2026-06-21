/**
 * Tab Event Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles tab removal, activation, and navigation badge updates.
 */
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { HeaderDetector } from '../headerDetector.js';
import { RecordingLogic } from '../recordingLogic.js';
import { TabCache } from '../tabCache.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface TabHandlerContext {
    tabCache: TabCache;
    autoSavedBadgeTabs: Set<number>;
}

export function createTabEventHandlers(ctx: TabHandlerContext) {
    function handleTabRemoved(tabId: number): void {
        ctx.tabCache.remove(tabId);
        ctx.autoSavedBadgeTabs.delete(tabId);
    }

    async function handleTabActivated(activeInfo: { tabId: number }): Promise<void> {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            // 自動保存バッジ表示中のタブは ◎ を維持
            if (ctx.autoSavedBadgeTabs.has(activeInfo.tabId)) {
                chrome.action.setBadgeText({ text: '◎', tabId: activeInfo.tabId });
                chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.BLUE as string, tabId: activeInfo.tabId });
                return;
            }
            if (!tab.url) {
                chrome.action.setBadgeText({ text: '' });
                return;
            }
            const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
            const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
            if (privacyInfo?.isPrivate) {
                chrome.action.setBadgeText({ text: '!' });
                chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string });
            } else {
                chrome.action.setBadgeText({ text: '' });
            }
        } catch (error) {
            await logError('Failed to update badge on tab activation', {
                tabId: activeInfo.tabId,
                error: errorMessage(error)
            }, ErrorCode.BADGE_UPDATE_FAILED, 'service-worker.ts');
            chrome.action.setBadgeText({ text: '' });
        }
    }

    /**
     * Handle tab navigation - update badge after page load completes.
     */
    function handleTabUpdated(tabId: number, changeInfo: { status?: string }, tab: { url?: string }): void {
        if (changeInfo.status !== 'complete' || !tab.url) return;
        // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
        ctx.autoSavedBadgeTabs.delete(tabId);
        const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
        const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
        if (privacyInfo?.isPrivate) {
            chrome.action.setBadgeText({ text: '!', tabId });
            chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string, tabId });
        } else {
            chrome.action.setBadgeText({ text: '', tabId });
        }
    }

    return { handleTabRemoved, handleTabActivated, handleTabUpdated };
}
