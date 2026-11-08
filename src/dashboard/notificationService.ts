import { logWarn } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';

/**
 * Shows a basic Chrome notification from dashboard-context code.
 *
 * Failures are never silent: a missing notifications API, a thrown error, or a
 * chrome.runtime.lastError (e.g. permission denied) is recorded through the
 * structured-log seam and reported as `false` so callers can react.
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
