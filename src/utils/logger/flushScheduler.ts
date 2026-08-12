const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const BATCH_FLUSH_ALARM_MINUTES = 1;

export interface LogFlushScheduler {
  onFlushRequested(handler: () => Promise<void>): void;
  schedule(): void;
  flushNow(): Promise<void>;
}

/** Chrome runtime implementation — uses chrome.alarms + onSuspend */
export class ChromeAlarmFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === LOGGER_ALARM_NAME) void this.handler?.();
      });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(async () => {
        await this.flushNow();
      });
    }
  }

  schedule(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}

/** Test fake — runs handler synchronously/immediately */
export class ImmediateFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  schedule(): void {
    void this.handler?.();
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}
