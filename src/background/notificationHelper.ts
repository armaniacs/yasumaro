// src/background/notificationHelper.ts
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

  static notifyError(error: any): void {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: this.getIconUrl(),
      title: 'Obsidian Sync Failed',
      message: `Error: ${error}`
    });
  }
}