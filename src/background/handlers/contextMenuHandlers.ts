/**
 * Context Menu Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles manual recording context menu registration and click events.
 *
 * PBI 2026-10-23-07: the page extraction + record call delegates to the
 * shared recordTabContent core (activeTabRecorder.ts) — the omnibox and the
 * keyboard command ride the same mechanics. The insecure-URL gate, the
 * per-tab in-flight guard and the error log stay entry-point-local so the
 * log origin and the skip policy stay readable.
 */
import { isSecureUrl } from '../../utils/urlUtils.js';
import { getMessageOr } from '../../utils/i18n.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logWarn, logError } from '../../utils/logger/api.js';
import { SingleFlight } from '../../utils/singleFlight.js';
import type { ManualRecordMessage } from '../messageTypes.js';
import { recordTabContent } from './activeTabRecorder.js';

export interface ContextMenuHandlerDeps {
    handleManualRecord: (
        message: ManualRecordMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) => Promise<void>;
}

export function registerManualRecordContextMenu(): void {
    chrome.contextMenus.create(
        {
            id: 'yasumaro-manual-record',
            title: getMessageOr('contextMenuRecord', 'Record page with Yasumaro'),
            contexts: ['page', 'link'],
        },
        () => {
            const error = chrome.runtime.lastError;
            if (!error) return;
            const message = error.message || '';
            if (!message.includes('duplicate id')) {
                logError('Failed to register context menu', { cause: message }, ErrorCode.INTERNAL_ERROR, 'service-worker');
            }
        }
    );
}

export function createContextClickHandler(deps: ContextMenuHandlerDeps) {
    // PBI 2026-09-12-30: keyed by tab with the 'drop' policy in the shared
    // SingleFlight seam (was a hand-rolled Map; before that a single global
    // slot that dropped a concurrent click even for a different URL).
    const inFlightByTabId = new SingleFlight<number>();

    return async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> => {
        if (info.menuItemId !== 'yasumaro-manual-record' || !tab?.id || !tab.url) return;

        if (!isSecureUrl(tab.url)) {
            await logWarn('Context menu ignored for insecure URL', { url: tab.url }, undefined, 'service-worker');
            return;
        }

        const targetTabId = tab.id;
        const targetTabUrl = tab.url;
        if (!targetTabId || !targetTabUrl) return;

        await inFlightByTabId.run(targetTabId, async () => {
            try {
                await recordTabContent(deps, 'Context menu', targetTabId, targetTabUrl);
            } catch (error) {
                logError('Context menu manual record failed', { cause: error }, ErrorCode.INTERNAL_ERROR, 'service-worker');
            }
        }, 'drop');
    };
}
