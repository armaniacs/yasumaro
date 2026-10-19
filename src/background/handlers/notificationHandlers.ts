import { decodeUrlFromNotificationId } from './urlNotificationHandlers.js';
import { PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from '../notificationHelper.js';
import { getPendingPages, removePendingPages } from '../../utils/pendingStorage.js';
import { claimRecoveryOwner, releaseRecoveryOwner } from '../../utils/recoveryClaimStore.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logWarn, logError } from '../../utils/logger/api.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { buildRecordRequest } from '../recordRequestBuilder.js';
import { SingleFlight } from '../../utils/singleFlight.js';
import type { AdmissionOutcome, RecordAdmissionKind } from '../recordingAdmission.js';
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
  /**
   * PBI 2026-10-18-04: the common RecordingAdmission pre-stage shared with the
   * registry routes (VALID_VISIT / MANUAL_RECORD / SAVE_RECORD / REGENERATE),
   * resolved from the composition's `recordingAdmission` singleton — never a
   * locally built admission. The notification click carries no sender, so the
   * composition root binds an empty one; kind 'save' is not counter-limited
   * (`KIND_RATE_BUCKET.save === null`), so the sender is never read.
   * Supersedes the bare consent re-read of PBI 2026-10-19-10: the admission
   * gate reads the same `hasPrivacyConsent()` at execution time, so a
   * withdrawn profile is still refused, now through the same gate every other
   * recording path is refused by (`privacy_consent_required`).
   */
  admit: (kind: RecordAdmissionKind) => Promise<AdmissionOutcome>;
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

            void chrome.notifications.clear(notificationId).catch(e => {
                void logWarn(
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
                    // PBI 2026-10-18-04: the common admission pre-stage runs
                    // before any pending lookup or recovery claim, exactly where
                    // the PBI 2026-10-19-10 consent re-read used to sit. A
                    // withdrawn profile is refused with the same
                    // `privacy_consent_required` rejection every registry route
                    // returns, and the pending page is deliberately left in
                    // place (same policy as a held recovery claim) so
                    // re-consenting lets the user retry the same action.
                    const admitted = await deps.admit('save');
                    if ('rejected' in admitted) {
                        await logWarn(
                            `Notification Save rejected by recording admission: ${admitted.rejected.reason}`,
                            { url: url.substring(0, 10) + '...', reason: admitted.rejected.reason },
                            undefined,
                            'service-worker',
                        );
                        return;
                    }
                    const pages = await getPendingPages();
                    const page = pages.find(p => p.url === url);
                    if (page) {
                        // PBI 2026-09-25-12: the notification re-run is the third
                        // manual recovery surface — it takes the same durable
                        // claim as the popup / dashboard re-runs and the offline
                        // queue owner, so two surfaces cannot run it at once.
                        // A failed claim leaves the pending page in place: the
                        // user can retry once the other owner finishes.
                        if (await claimRecoveryOwner(url, 'manual')) {
                            try {
                                // PBI 2026-09-12-04: source policy (force, duplicate
                                // check, record type) lives in the shared builder.
                                await deps.record(buildRecordRequest('notification-confirm', {
                                    title: page.title,
                                    url: page.url,
                                    content: '',
                                }));
                            } finally {
                                await releaseRecoveryOwner(url, 'manual');
                            }
                            await removePendingPages([url]);
                            return;
                        }
                        await logWarn(
                            'Notification re-run skipped: recovery claim held by another owner',
                            { url: url.substring(0, 10) + '...' },
                            ErrorCode.INTERNAL_ERROR,
                            'service-worker',
                        );
                        return;
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
            void chrome.notifications.clear(notificationId).catch((error: unknown) => {
                void logWarn(
                    'Failed to clear notification',
                    { notificationId, error: errorMessage(error) },
                    ErrorCode.UNKNOWN_ERROR,
                    'service-worker',
                );
            });
        }
    }

    return { onButtonClicked, onClicked };
}
