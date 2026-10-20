const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const BATCH_FLUSH_ALARM_MINUTES = 1;
/** How long onSuspend waits for the flush before giving up (and reporting). */
const SUSPEND_FLUSH_TIMEOUT_MS = 3000;

export interface LogFlushScheduler {
  onFlushRequested(handler: () => Promise<void>): void;
  schedule(): void;
  /** Cancel a pending scheduled flush (e.g. after a flush already ran). */
  clear(): void;
  flushNow(): Promise<void>;
}

/** Chrome runtime implementation — uses chrome.alarms + onSuspend */
export class ChromeAlarmFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;
  private listenersRegistered = false;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
    // Idempotent: re-init (e.g. repeated initLogger calls on one instance)
    // must not stack duplicate alarm/suspend listeners that would flush N
    // times per alarm. Multi-instance registration is unchanged — each
    // instance still owns its own single pair.
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === LOGGER_ALARM_NAME) void this.handler?.();
      });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(async () => {
        // Await flush with a timeout so pending logs are not lost when the SW dies.
        const flushCompleted = await Promise.race([
          this.flushNow().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SUSPEND_FLUSH_TIMEOUT_MS)),
        ]);
        if (!flushCompleted) {
          console.error(
            '[Logger] Flush timed out during suspend — pending log entries may not have been persisted'
          );
        }
      });
    }
  }

  schedule(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
  }

  clear(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.clear(LOGGER_ALARM_NAME);
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

  clear(): void {
    // No real alarm exists in this fake — nothing to cancel.
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}
