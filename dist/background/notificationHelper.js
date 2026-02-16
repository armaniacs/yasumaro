// src/background/notificationHelper.ts
export class NotificationHelper {
    static getIconUrl() {
        return chrome.runtime.getURL('icons/icon48.png');
    }
    static notifySuccess(title, message) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: this.getIconUrl(),
            title,
            message
        });
    }
    static notifyError(error) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: this.getIconUrl(),
            title: 'Obsidian Sync Failed',
            message: `Error: ${error}`
        });
    }
}
//# sourceMappingURL=notificationHelper.js.map