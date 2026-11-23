import { logWarn } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';

/**
 * Shows a basic Chrome notification from dashboard-context code.
 *
 * The returned boolean reports the dispatch attempt, not the final display
 * outcome: `true` when the notification was handed to the platform for
 * dispatch, `false` only when dispatch itself failed synchronously (missing
 * API or a throw). A rejected promise from the platform settles after the
 * handoff, so it is recorded through the structured-log seam but keeps the
 * `true` return. A later `chrome.runtime.lastError` (e.g. permission
 * denied) arrives asynchronously after dispatch, so it is likewise only
 * logged and does not flip the return value.
 */
export function notify(title: string, message: string): boolean {
  try {
    const api = chrome.notifications;
    if (!api?.create) {
      void logWarn('notify: notifications API unavailable', { title }, ErrorCode.UNKNOWN_ERROR, 'notificationService');
      return false;
    }
    const outcome: unknown = api.create(
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title,
        message,
      },
      () => {
        const lastError = chrome.runtime.lastError?.message;
        if (lastError) {
          void logWarn('notify: notification was not shown', { title, error: lastError }, ErrorCode.UNKNOWN_ERROR, 'notificationService');
        }
      },
    );
    if (outcome instanceof Promise) {
      outcome.catch((error: unknown) => {
        void logWarn('notify: notification failed', { title, error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'notificationService');
      });
    }
    return true;
  } catch (error: unknown) {
    void logWarn('notify: notification threw', { title, error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'notificationService');
    return false;
  }
}
