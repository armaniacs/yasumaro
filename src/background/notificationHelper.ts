// src/background/notificationHelper.ts

import { getMessageOr } from '../utils/i18n.js';

// Notification ID prefix for privacy confirmation notifications
export const PRIVACY_CONFIRM_NOTIFICATION_PREFIX = 'privacy-confirm-';

export class NotificationHelper {
  static getIconUrl(): string {
    return chrome.runtime.getURL('icons/icon48.png');
  }

  static notifySuccess(title: string, message: string): void {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: this.getIconUrl(),
      title,
      message
    });
  }

  static notifyError(error: unknown): void {
    const title = getMessageOr('obsidianSyncFailed', 'Obsidian Sync Failed');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: this.getIconUrl(),
      title,
      message: `Error: ${error}`
    });
  }

  /**
   * Show a privacy confirmation notification with Save / Skip buttons.
   * @param notificationId - unique ID (PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded url)
   */
  static notifyPrivacyConfirm(notificationId: string, pageTitle: string, reason: string): void {
    const saveLabel = getMessageOr('notifyPrivacyConfirmSave', '保存する');
    const skipLabel = getMessageOr('notifyPrivacyConfirmSkip', 'スキップ');
    const title = getMessageOr('notifyPrivacyConfirmTitle', 'Yasumaro');
    const body = getMessageOr('notifyPrivacyConfirmBody', `「${pageTitle}」にプライバシー懸念があります（${reason}）。保存しますか？`, [pageTitle, reason]);

    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: this.getIconUrl(),
      title,
      message: body,
      buttons: [
        { title: saveLabel },
        { title: skipLabel }
      ],
      requireInteraction: true
    });
  }
}