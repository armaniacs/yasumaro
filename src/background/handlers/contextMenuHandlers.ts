/**
 * Context Menu Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles manual recording context menu registration and click events.
 */
import { isSecureUrl } from '../../utils/urlUtils.js';
import { logWarn, logError, ErrorCode } from '../../utils/logger.js';
import type { ManualRecordMessage } from '../messageTypes.js';

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
            title: chrome.i18n.getMessage('contextMenuRecord') || 'Record page with Yasumaro',
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
    let contextMenuRecordInProgress: Promise<void> | null = null;

    return async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> => {
        if (info.menuItemId !== 'yasumaro-manual-record' || !tab?.id || !tab.url) return;

        if (!isSecureUrl(tab.url)) {
            await logWarn('Context menu ignored for insecure URL', { url: tab.url }, undefined, 'service-worker');
            return;
        }

        if (contextMenuRecordInProgress) return;

        const targetTabId = tab.id;
        const targetTabUrl = tab.url;
        if (!targetTabId || !targetTabUrl) return;

        contextMenuRecordInProgress = (async () => {
            try {
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    func: () => ({
                        url: window.location.href,
                        title: document.title,
                        content: document.body?.innerText?.slice(0, 5000) || '',
                    }),
                });

                const raw = result?.result;
                if (!raw || typeof raw !== 'object' || !('url' in raw)) {
                    await logWarn('Context menu received invalid page data', { url: targetTabUrl }, undefined, 'service-worker');
                    return;
                }

                const payload = raw as { url: string; title: string; content: string };
                const sender: chrome.runtime.MessageSender = {
                    tab: { id: targetTabId, url: payload.url } as chrome.tabs.Tab,
                    id: chrome.runtime.id,
                    url: chrome.runtime.getURL(''),
                };

                await deps.handleManualRecord(
                    {
                        type: 'MANUAL_RECORD',
                        payload: {
                            url: payload.url,
                            title: payload.title,
                            content: payload.content,
                            force: true,
                            skipAi: false,
                        },
                    },
                    sender,
                    () => {}
                );
            } catch (error) {
                logError('Context menu manual record failed', { cause: error }, ErrorCode.INTERNAL_ERROR, 'service-worker');
            }
        })();

        try {
            await contextMenuRecordInProgress;
        } finally {
            contextMenuRecordInProgress = null;
        }
    };
}
