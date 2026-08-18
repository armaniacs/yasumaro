import { type ErrorCodeValues } from './types.js';

export interface CriticalAlertSink {
  raise(message: string, details: Record<string, unknown>, errorCode: ErrorCodeValues): void;
}

/** Test fake — records raised alerts without side effects */
export class FakeCriticalSink implements CriticalAlertSink {
  raised: Array<{ message: string; details: Record<string, unknown>; errorCode: ErrorCodeValues }> = [];

  raise(message: string, details: Record<string, unknown>, errorCode: ErrorCodeValues): void {
    this.raised.push({ message, details, errorCode });
  }
}

const COOLDOWN_MS = 5 * 60 * 1000;

/** Production sink — fires chrome.notifications with a cooldown */
export class ChromeNotificationCriticalSink implements CriticalAlertSink {
  private lastNotificationTime = -COOLDOWN_MS;
  private readonly now: () => number;
  private readonly notifications: typeof chrome.notifications | undefined;

  constructor(opts?: { now?: () => number; notifications?: typeof chrome.notifications }) {
    this.now = opts?.now ?? (() => Date.now());
    this.notifications = opts?.notifications;
  }

  /** Whether a notification may be raised now (cooldown aware) */
  shouldRaise(): boolean {
    const now = this.now();
    if (now - this.lastNotificationTime < COOLDOWN_MS) return false;
    this.lastNotificationTime = now;
    return true;
  }

  raise(message: string, _details: Record<string, unknown>, _errorCode: ErrorCodeValues): void {
    if (!this.shouldRaise()) return;
    try {
      const notifications =
        this.notifications ?? (typeof chrome !== 'undefined' ? chrome.notifications : undefined);
      if (!notifications || typeof notifications.create !== 'function') return;
      const title = chrome.i18n?.getMessage('criticalAlertTitle') || 'Yasumaro — Critical Error';
      const body = chrome.i18n?.getMessage('criticalAlertBody', [message]) || message;
      const iconUrl =
        typeof chrome.runtime !== 'undefined' && typeof chrome.runtime.getURL === 'function'
          ? chrome.runtime.getURL('icons/icon48.png')
          : 'icons/icon48.png';
      notifications.create({
        type: 'basic',
        iconUrl,
        title,
        message: body,
        priority: 2,
        requireInteraction: true,
      });
    } catch (e) {
      console.error('Logger: Failed to create critical notification', e);
    }
  }
}

/** Default shared instance used when no sink is passed to logCritical */
export const defaultCriticalSink = new ChromeNotificationCriticalSink();
