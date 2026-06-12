import { decodeUrlFromNotificationId } from './urlNotificationHandlers.js';
import { PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from '../notificationHelper.js';
import { getPendingPages, removePendingPages } from '../../utils/pendingStorage.js';
import { logWarn, logError, ErrorCode } from '../../utils/logger.js';
import type { RecordingLogic } from '../recordingLogic.js';

const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'chrome-extension:', 'moz-extension:', 'edge:'];
const BLOCKED_URL_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'about:'];
const MAX_URL_LENGTH = 2000;

export function isValidNotificationUrl(url: string): boolean {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (url.length > MAX_URL_LENGTH) return false;
    try {
        const parsedUrl = new URL(url);
        for (const blocked of BLOCKED_URL_SCHEMES) {
            if (parsedUrl.protocol === blocked && url.startsWith(blocked)) return false;
        }
        for (const allowed of ALLOWED_URL_SCHEMES) {
            if (parsedUrl.protocol === allowed) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function createNotificationHandlers(recordingLogic: RecordingLogic) {
    async function onButtonClicked(notificationId: string, buttonIndex: number): Promise<void> {
        try {
            if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) return;

            chrome.notifications.clear(notificationId).catch(e => {
                logWarn(
                    'Failed to clear notification',
                    { notificationId, error: e instanceof Error ? e.message : String(e) },
                    ErrorCode.UNKNOWN_ERROR,
                    'service-worker'
                );
            });

            let url: string;
            try {
                url = await decodeUrlFromNotificationId(notificationId);
            } catch {
                return;
            }

            if (!isValidNotificationUrl(url)) {
                await logWarn(
                    'Invalid URL decoded from notification ID',
                    { urlHash: url.substring(0, 10) + '...' },
                    ErrorCode.INVALID_INPUT,
                    'service-worker'
                );
                return;
            }

            if (buttonIndex === 0) {
                const pages = await getPendingPages();
                const page = pages.find(p => p.url === url);
                if (page) {
                    await recordingLogic.record({
                        title: page.title,
                        url: page.url,
                        content: '',
                        force: true,
                        skipDuplicateCheck: true,
                        recordType: 'auto'
                    });
                }
            }
            await removePendingPages([url]);
        } catch (error) {
            await logError(
                'Notification button click handler failed',
                {
                    notificationId: notificationId.substring(0, 20) + '...',
                    buttonIndex,
                    error: error instanceof Error ? error.message : String(error)
                },
                ErrorCode.INTERNAL_ERROR,
                'service-worker'
            );
        }
    }

    function onClicked(notificationId: string): void {
        if (notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) {
            chrome.notifications.clear(notificationId);
        }
    }

    return { onButtonClicked, onClicked };
}
