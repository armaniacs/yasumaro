export declare const PRIVACY_CONFIRM_NOTIFICATION_PREFIX = "privacy-confirm-";
export declare class NotificationHelper {
    static getIconUrl(): string;
    static notifySuccess(title: string, message: string): void;
    static notifyError(error: any): void;
    /**
     * Show a privacy confirmation notification with Save / Skip buttons.
     * @param notificationId - unique ID (PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded url)
     */
    static notifyPrivacyConfirm(notificationId: string, pageTitle: string, reason: string): void;
}
//# sourceMappingURL=notificationHelper.d.ts.map