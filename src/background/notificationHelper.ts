// src/background/notificationHelper.ts
//
// Thin write facade over the notification policy table (PBI 2026-10-24-02).
// All wording, buttons, flags and icons live in `notificationPolicy.ts`;
// every method below resolves one table row and funnels through the single
// write point `show`. Kept (not deleted) so the five call sites keep their
// call expressions and payloads stay byte-identical.

import { getMessageOr } from '../utils/i18n.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logWarn } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import {
  NOTIFICATION_ICON_48_PATH,
  privacyConfirmOptions,
  successOptions,
  syncErrorOptions,
  type NotificationPayload,
} from './notificationPolicy.js';

export { PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from './notificationPolicy.js';

export class NotificationHelper {
  static getIconUrl(): string {
    return chrome.runtime.getURL(NOTIFICATION_ICON_48_PATH);
  }

  /** Single write point: the only `chrome.notifications.create` call. */
  static show(options: NotificationPayload, notificationId?: string): void {
    try {
      const pending =
        notificationId === undefined
          ? chrome.notifications.create(options)
          : chrome.notifications.create(notificationId, options);
      // Callback-style failures surface as chrome.runtime.lastError; read it
      // synchronously so a denied create is logged instead of silent.
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        void logWarn(
          'Failed to show notification',
          { error: lastError.message ?? String(lastError) },
          ErrorCode.UNKNOWN_ERROR,
          'notificationHelper',
        );
        return;
      }
      // Promise-style failures reject; a rejection handler keeps them from
      // escaping as unhandled rejections. Non-promise stubs (unit tests)
      // carry no catch and are skipped.
      if (pending !== undefined && typeof (pending as Promise<string>).catch === 'function') {
        void (pending as Promise<string>).catch((error: unknown) => {
          void logWarn(
            'Failed to show notification',
            { error: errorMessage(error) },
            ErrorCode.UNKNOWN_ERROR,
            'notificationHelper',
          );
        });
      }
    } catch (error: unknown) {
      void logWarn(
        'Failed to show notification',
        { error: errorMessage(error) },
        ErrorCode.UNKNOWN_ERROR,
        'notificationHelper',
      );
    }
  }

  static notifySuccess(title: string, message: string): void {
    this.show(successOptions({ title, message, iconUrl: this.getIconUrl() }));
  }

  static notifyError(error: unknown): void {
    this.show(syncErrorOptions({ error, resolve: getMessageOr, iconUrl: this.getIconUrl() }));
  }

  /**
   * Show a privacy confirmation notification with Save / Skip buttons.
   * @param notificationId - unique ID (PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded url)
   */
  static notifyPrivacyConfirm(notificationId: string, pageTitle: string, reason: string): void {
    this.show(
      privacyConfirmOptions({
        pageTitle,
        reason,
        resolve: getMessageOr,
        iconUrl: this.getIconUrl(),
      }),
      notificationId,
    );
  }

}
