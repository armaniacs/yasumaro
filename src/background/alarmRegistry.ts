/**
 * alarmRegistry.ts
 * Deep module owning the alarm registration table: name -> { install, run }.
 * Replaces the alarmHandler if-chain (PBI 2026-09-05-05) and unifies the
 * 3 onAlarm listeners (PBI 2026-09-15-15).
 *
 * Adding a timed job is one table row: the chrome.alarms.create spec (for
 * unconditional jobs), an install hook (for conditional jobs), the run
 * handler, and the uniform failure policy (catch + log, other jobs keep
 * running) all live next to the table.
 *
 * Deletion test: deleting the table scatters the alarm chain + creation
 * specs + fan-out ordering back across the service-worker root and helpers.
 */

import { handleDailyPurgeAlarm } from './dailyPurgeHandler.js';
import { flushPendingRecords } from './pendingSqliteQueue.js';
import { flushPendingWrites } from './pendingChromeStorageQueue.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import type { OfflineNetworkQueue } from './offlineNetworkQueue.js';
import type { RecordingOrchestrator } from './pipeline/RecordingOrchestrator.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';
import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import { type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import {
  reviewSummaryGeneratorRef,
  sessionTimeoutInstallRef,
  sessionTimeoutRunRef,
} from './alarmRegistryRefs.js';

export interface AlarmHandlerDeps {
  sqliteClient: SqliteClient;
  recordingPipeline: RecordingOrchestrator;
  getOfflineNetworkQueue: () => Promise<OfflineNetworkQueue>;
  retryPendingChromeStorageWrite: (write: never) => Promise<boolean>;
  /** PBI 2026-09-15-15: injected for review-summary and session-timeout jobs. */
  reviewSummaryGenerator?: ReviewSummaryGenerator;
  settingsReader?: SettingsReader;
  sessionTimeoutChecker?: () => Promise<void>;
  sessionTimeoutInstall?: () => Promise<void>;
}

export interface AlarmJobSpec {
  name: string;
  /** Unconditional creation spec. Absent = created by `install` (conditional). */
  staticSchedule?: chrome.alarms.AlarmCreateInfo | undefined;
  /** Conditional creation hook (review-summary settings gate, session alarm re-arm). */
  install?: () => Promise<void>;
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
  await Promise.allSettled([
    processOfflineNetworkQueue(),
    flushPendingRecords(deps.sqliteClient),
    flushPendingWrites(deps.retryPendingChromeStorageWrite as never),
    deps.sqliteClient.maintain({ type: 'healthCheck' }),
  ]);
}

async function installReviewSummary(settingsReader?: SettingsReader): Promise<void> {
  const settings = settingsReader
    ? await settingsReader.getAll()
    : {};
  if (!settings[StorageKeys.REVIEW_SUMMARY_ENABLED]) {
    await chrome.alarms.clear('yasumaro-review-weekly');
    await chrome.alarms.clear('yasumaro-review-monthly');
    return;
  }
  await chrome.alarms.clear('yasumaro-review-weekly');
  await chrome.alarms.create('yasumaro-review-weekly', { when: getNextMondayAt(9, 0), periodInMinutes: 7 * 24 * 60 });
  await chrome.alarms.clear('yasumaro-review-monthly');
  await chrome.alarms.create('yasumaro-review-monthly', { when: getNextMonthFirstDayAt(9, 0), periodInMinutes: 31 * 24 * 60 });
  addLog(LogType.INFO, 'Review summary alarms installed');
}

function getNextMondayAt(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const day = target.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  target.setDate(target.getDate() + daysUntilMonday);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target.getTime();
}

function getNextMonthFirstDayAt(hour: number, minute: number): number {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), 1, hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, 1, hour, minute, 0, 0);
  }
  return target.getTime();
}

const JOBS: AlarmJobSpec[] = [
  { name: 'yasumaro-daily-purge', staticSchedule: { periodInMinutes: 1440 }, run: runDailyPurge },
  { name: 'yasumaro-local-md-flush', run: runLocalMdFlush },
  { name: 'yasumaro-local-md-immediate', run: runLocalMdFlush },
  { name: 'yasumaro-local-md-daily-flush', run: runLocalMdDailyFlush },
  { name: 'yasumaro-offline-network-retry', staticSchedule: { periodInMinutes: 5 }, run: runOfflineNetworkRetry },
  {
    name: 'yasumaro-review-weekly',
    install: () => installReviewSummary(),
    run: async () => { await reviewSummaryGeneratorRef?.generateWeeklySummary(); },
  },
  {
    name: 'yasumaro-review-monthly',
    install: () => installReviewSummary(),
    run: async () => { await reviewSummaryGeneratorRef?.generateMonthlySummary(); },
  },
  {
    name: 'check_session_timeout',
    install: async () => { await sessionTimeoutInstallRef?.(); },
    run: async () => { await sessionTimeoutRunRef?.(); },
  },
];

export interface AlarmRegistry {
  /** Create the unconditional alarms and run the conditional install hooks. */
  installAll(): Promise<void>;
  /** Route one firing to its table entry with uniform failure logging. */
  handleAlarm: (alarm: chrome.alarms.Alarm) => void;
}

export function createAlarmRegistry(deps: AlarmHandlerDeps): AlarmRegistry {
  const byName = new Map(JOBS.map((job) => [job.name, job]));
  return {
    async installAll() {
      for (const job of JOBS) {
        try {
          if (job.staticSchedule) {
            chrome.alarms.create(job.name, job.staticSchedule);
          }
          if (job.install) {
            await job.install();
          }
        } catch (err: unknown) {
          addLog(LogType.ERROR, `Alarm job ${job.name} install failed`, { error: String(err) });
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
