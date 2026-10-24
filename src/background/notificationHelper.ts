// src/background/notificationHelper.ts
//
// Thin write facade over the notification policy table (PBI 2026-10-24-02).
// All wording, buttons, flags and icons live in `notificationPolicy.ts`;
// every method below resolves one table row and funnels through the single
// write point `show`. Kept (not deleted) so the five call sites keep their
// call expressions and payloads stay byte-identical.

import { getMessageOr } from '../utils/i18n.js';
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
    if (notificationId === undefined) {
      chrome.notifications.create(options);
      return;
    }
    chrome.notifications.create(notificationId, options);
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
