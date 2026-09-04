/**
 * alarmRegistry.ts
 * Deep module owning the alarm registration table: name -> { static schedule,
 * run }. Replaces the alarmHandler if-chain (PBI 2026-09-05-05).
 *
 * Adding a timed job is one table row: the chrome.alarms.create spec (for
 * unconditional jobs), the lazy loader, the handler, and the uniform failure
 * policy (catch + log, other jobs keep running) all live next to the table.
 *
 * Out of scope: SessionAlarmService (own listener, session-timeout concern),
 * review-summary alarms (own listener + conditional creation), and the
 * conditional local-md creation in initExportScheduler (reads
 * LOCAL_MARKDOWN_EXPORT_TIMING). Only routing for those names lives here.
 *
 * Deletion test: deleting the table scatters the 5-arm chain + creation
 * specs + fan-out ordering back across the service-worker root and helpers.
 */

import { handleDailyPurgeAlarm } from './dailyPurgeHandler.js';
import { flushPendingRecords } from './pendingSqliteQueue.js';
import { flushPendingWrites } from './pendingChromeStorageQueue.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import type { OfflineNetworkQueue } from './offlineNetworkQueue.js';
import type { RecordingOrchestrator } from './pipeline/RecordingOrchestrator.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';
import { addLog, LogType } from '../utils/logger.js';

export interface AlarmHandlerDeps {
  sqliteClient: SqliteClient;
  recordingPipeline: RecordingOrchestrator;
  getOfflineNetworkQueue: () => Promise<OfflineNetworkQueue>;
  retryPendingChromeStorageWrite: (write: never) => Promise<boolean>;
}

export interface AlarmJobSpec {
  name: string;
  /** Unconditional creation spec. Absent = created elsewhere (conditional init). */
  staticSchedule?: chrome.alarms.AlarmCreateInfo | undefined;
  run: (deps: AlarmHandlerDeps) => Promise<void>;
}

async function runDailyPurge(deps: AlarmHandlerDeps): Promise<void> {
  await handleDailyPurgeAlarm(
    (days, max) => deps.sqliteClient.maintain({ type: 'purgeOldRecords', retentionDays: days, maxRecords: max } as { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number }),
    (days, max, starred) => deps.sqliteClient.maintain({ type: 'purgeContent', retentionDays: days, maxRecords: max, includeStarred: starred } as { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean }),
  );
}

/** Shared body for yasumaro-local-md-flush and yasumaro-local-md-immediate. */
async function runLocalMdFlush(): Promise<void> {
  const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
  await flushBufferedExports();
}

async function runLocalMdDailyFlush(): Promise<void> {
  const { flushYesterdaysExport } = await import('./localMarkdownIdleFlusher.js');
  await flushYesterdaysExport();
}

async function runOfflineNetworkRetry(deps: AlarmHandlerDeps): Promise<void> {
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
    deps.sqliteClient.maintain({ type: 'healthCheck' }),
  ]);
}

const JOBS: AlarmJobSpec[] = [
  { name: 'yasumaro-daily-purge', staticSchedule: { periodInMinutes: 1440 }, run: runDailyPurge },
  // Two names, one body: flush and immediate share runLocalMdFlush.
  { name: 'yasumaro-local-md-flush', run: runLocalMdFlush },
  { name: 'yasumaro-local-md-immediate', run: runLocalMdFlush },
  { name: 'yasumaro-local-md-daily-flush', run: runLocalMdDailyFlush },
  { name: 'yasumaro-offline-network-retry', staticSchedule: { periodInMinutes: 5 }, run: runOfflineNetworkRetry },
];

export interface AlarmRegistry {
  /** Create the unconditional alarms from the table. Idempotent per name. */
  installStaticAlarms(): void;
  /** Route one firing to its table entry with uniform failure logging. */
  handleAlarm: (alarm: chrome.alarms.Alarm) => void;
}

export function createAlarmRegistry(deps: AlarmHandlerDeps): AlarmRegistry {
  const byName = new Map(JOBS.map((job) => [job.name, job]));
  return {
    installStaticAlarms() {
      for (const job of JOBS) {
        if (job.staticSchedule) {
          chrome.alarms.create(job.name, job.staticSchedule);
        }
      }
    },
    handleAlarm(alarm) {
      const job = byName.get(alarm.name);
      if (!job) return;
      void job
        .run(deps)
        .catch((err: unknown) =>
          addLog(LogType.ERROR, `Alarm job ${job.name} failed`, { error: String(err) }),
        );
    },
  };
}
