/**
 * alarmRegistry.ts
 * Deep module owning the alarm registration table: name -> { install, run }.
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
import { flushPendingWrites, type QueuedChromeStorageWrite } from './pendingChromeStorageQueue.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import type { OfflineNetworkQueue } from './offlineNetworkQueue.js';
import type { RecordingOrchestrator } from './pipeline/RecordingOrchestrator.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';
import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { SessionAlarmService } from './SessionAlarmService.js';
import { type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';

export interface AlarmHandlerDeps {
  sqliteClient: SqliteClient;
  recordingPipeline: RecordingOrchestrator;
  getOfflineNetworkQueue: () => OfflineNetworkQueue;
  retryPendingChromeStorageWrite: (write: QueuedChromeStorageWrite) => Promise<boolean>;
  reviewSummaryGenerator: ReviewSummaryGenerator;
  sessionAlarmService: SessionAlarmService;
  settingsReader: SettingsReader;
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
    undefined,
    (days) => deps.sqliteClient.maintain({ type: 'purgeAuditLog', retentionDays: days } as { type: 'purgeAuditLog'; retentionDays?: number }),
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

/**
 * Shared install for the standing local-md alarms. initExportScheduler is the
 * sole creator of the idle-fallback and daily alarms; the table only routes
 * installAll() through it so ownership is visible in one place. Idempotent:
 * it clears both standing alarms before re-arming for the current timing.
 */
async function installLocalMdScheduler(): Promise<void> {
  const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
  await initExportScheduler();
}

/**
 * Install for the immediate one-shot. There is no standing alarm to create:
 * the one-shot is armed per recording via scheduleImmediateFlush() (Chrome
 * replaces same-name alarms, giving the at-most-once-per-minute debounce),
 * so install is intentionally a no-op that records table ownership.
 */
async function installLocalMdImmediate(): Promise<void> {
}

async function runOfflineNetworkRetry(deps: AlarmHandlerDeps): Promise<void> {
  const offlineNetworkQueue = deps.getOfflineNetworkQueue();
  const processOfflineNetworkQueue = createOfflineQueueProcessor({
    offlineNetworkQueue,
    recordingPipeline: deps.recordingPipeline,
  });
  await Promise.allSettled([
    processOfflineNetworkQueue(),
    flushPendingRecords(deps.sqliteClient),
    flushPendingWrites(deps.retryPendingChromeStorageWrite),
    deps.sqliteClient.maintain({ type: 'healthCheck' }),
  ]);
}

async function installReviewSummary(settingsReader: SettingsReader): Promise<void> {
  const settings = await settingsReader.getAll();
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

// Factory, not a module constant: conditional install hooks capture deps
// (the review-summary jobs need deps.settingsReader to read the enabled flag).
const createJobs = (deps: AlarmHandlerDeps): AlarmJobSpec[] => [
  { name: 'yasumaro-daily-purge', staticSchedule: { periodInMinutes: 1440 }, run: runDailyPurge },
  { name: 'yasumaro-local-md-flush', install: installLocalMdScheduler, run: runLocalMdFlush },
  { name: 'yasumaro-local-md-immediate', install: installLocalMdImmediate, run: runLocalMdFlush },
  { name: 'yasumaro-local-md-daily-flush', install: installLocalMdScheduler, run: runLocalMdDailyFlush },
  { name: 'yasumaro-offline-network-retry', staticSchedule: { periodInMinutes: 5 }, run: runOfflineNetworkRetry },
  {
    name: 'yasumaro-review-weekly',
    install: () => installReviewSummary(deps.settingsReader),
    run: async () => { await deps.reviewSummaryGenerator.generateWeeklySummary(); },
  },
  {
    name: 'yasumaro-review-monthly',
    install: () => installReviewSummary(deps.settingsReader),
    run: async () => { await deps.reviewSummaryGenerator.generateMonthlySummary(); },
  },
  {
    name: 'check_session_timeout',
    install: async () => { await deps.sessionAlarmService.startTimeoutChecker(); },
    run: async () => { await deps.sessionAlarmService.checkTimeout(); },
  },
];

export interface AlarmRegistry {
  /** Create the unconditional alarms and run the conditional install hooks. */
  installAll(): Promise<void>;
  /** Route one firing to its table entry with uniform failure logging. */
  handleAlarm: (alarm: chrome.alarms.Alarm) => void;
}

export function createAlarmRegistry(deps: AlarmHandlerDeps): AlarmRegistry {
  const jobs = createJobs(deps);
  const byName = new Map(jobs.map((job) => [job.name, job]));
  return {
    async installAll() {
      for (const job of jobs) {
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
