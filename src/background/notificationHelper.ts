// src/background/notificationHelper.ts
export class NotificationHelper {
  static ICON_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  static notifySuccess(title: string, message: string): void {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: this.ICON_URL,
      title,
      message
    });
  }

  static notifyError(error: any): void {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: this.ICON_URL,
      title: 'Obsidian Sync Failed',
      message: `Error: ${error}`
    });
  }
}