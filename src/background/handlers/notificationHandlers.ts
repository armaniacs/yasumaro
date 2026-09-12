import { decodeUrlFromNotificationId } from './urlNotificationHandlers.js';
import { PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from '../notificationHelper.js';
import { getPendingPages, removePendingPages } from '../../utils/pendingStorage.js';
import { logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { buildRecordRequest } from '../recordRequestBuilder.js';
import { SingleFlight } from '../../utils/singleFlight.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';

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

export interface NotificationHandlersDeps {
  record: (data: RecordingData) => Promise<RecordingResult>;
}

export function createNotificationHandlers(deps: NotificationHandlersDeps) {
    // VULN-009 (CWE-362): a fast double-click delivers two onButtonClicked
    // events for the same notification before the first finishes its
    // getPendingPages -> record -> removePendingPages sequence. Both read the
    // page as still pending and both call record(), double-recording it.
    // PBI 2026-09-12-30: the join policy lives in the shared SingleFlight
    // seam (was a hand-rolled map + finally-cleanup).
    const inFlightByUrl = new SingleFlight<string>();

    async function onButtonClicked(notificationId: string, buttonIndex: number): Promise<void> {
        try {
            if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) return;

            chrome.notifications.clear(notificationId).catch(e => {
                logWarn(
                    'Failed to clear notification',
                    { notificationId, error: errorMessage(e) },
                    ErrorCode.UNKNOWN_ERROR,
                    'service-worker',
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
                    'service-worker',
                );
                return;
            }

            await inFlightByUrl.run(url, async () => {
                if (buttonIndex === 0) {
                    const pages = await getPendingPages();
                    const page = pages.find(p => p.url === url);
                    if (page) {
                        // PBI 2026-09-12-04: source policy (force, duplicate
                        // check, record type) lives in the shared builder.
                        await deps.record(buildRecordRequest('notification-confirm', {
                            title: page.title,
                            url: page.url,
                            content: '',
                        }));
                    }
                }
                await removePendingPages([url]);
            }, 'join');
        } catch (error) {
            await logError(
                'Notification button click handler failed',
                {
                    notificationId: notificationId.substring(0, 20) + '...',
                    buttonIndex,
                    error: errorMessage(error),
                },
                ErrorCode.INTERNAL_ERROR,
                'service-worker',
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
