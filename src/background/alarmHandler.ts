/**
 * alarmHandler.ts
 * Extracted from service-worker.ts (PBI-05).
 * Routes chrome.alarms.onAlarm events to the appropriate handler.
 */

import { handleDailyPurgeAlarm } from './dailyPurgeHandler.js';
import { flushPendingRecords } from './pendingSqliteQueue.js';
import { flushPendingWrites } from './pendingChromeStorageQueue.js';
import type { SqliteClient } from './sqliteClient.js';
import type { OfflineNetworkQueue } from './offlineNetworkQueue.js';
import type { RecordingPipeline } from './pipeline/RecordingPipeline.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';

export interface AlarmHandlerDeps {
  sqliteClient: SqliteClient;
  recordingPipeline: RecordingPipeline;
  getOfflineNetworkQueue: () => Promise<OfflineNetworkQueue>;
  retryPendingChromeStorageWrite: (write: never) => Promise<boolean>;
}

export function createAlarmHandler(deps: AlarmHandlerDeps): (alarm: chrome.alarms.Alarm) => void {
  return async (alarm: chrome.alarms.Alarm) => {
    if (alarm.name === 'yasumaro-daily-purge') {
      handleDailyPurgeAlarm(
        (days, max) => deps.sqliteClient.purgeOldRecordsResult(days, max),
        (days, max, starred) => deps.sqliteClient.purgeContentResult(days, max, starred),
      );
    }
    if (alarm.name === 'yasumaro-local-md-flush') {
      void (async () => {
        const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
        void flushBufferedExports();
      })();
    }
    if (alarm.name === 'yasumaro-local-md-daily-flush') {
      void (async () => {
        const { flushYesterdaysExport } = await import('./localMarkdownIdleFlusher.js');
        void flushYesterdaysExport();
      })();
    }
    if (alarm.name === 'yasumaro-local-md-immediate') {
      void (async () => {
        const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
        void flushBufferedExports();
      })();
    }
    if (alarm.name === 'yasumaro-offline-network-retry') {
      const offlineNetworkQueue = await deps.getOfflineNetworkQueue();
      const processOfflineNetworkQueue = createOfflineQueueProcessor({
        offlineNetworkQueue,
        recordingPipeline: deps.recordingPipeline,
      });
      // allSettled ensures one failing task doesn't block the others.
      await Promise.allSettled([
        processOfflineNetworkQueue(),
        flushPendingRecords(deps.sqliteClient),
        flushPendingWrites(deps.retryPendingChromeStorageWrite as never),
        // Piggyback a lightweight health check on this existing 5-minute
        // alarm to keep the offscreen document from being suspended for
        // long stretches on mobile Chrome (PBI-2026-07-26-20).
        deps.sqliteClient.isSqliteHealthy(),
      ]);
    }
  };
}
