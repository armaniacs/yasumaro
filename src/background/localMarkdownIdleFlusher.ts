/**
 * localMarkdownIdleFlusher.ts
 * Registers the alarm/listener combination matching the user's chosen
 * LOCAL_MARKDOWN_EXPORT_TIMING ('idle' or 'daily'). 'manual' and 'immediate'
 * need no standing registration — 'immediate' instead schedules a one-shot
 * debounce alarm per recording (see saveLocalMarkdownStep.ts).
 *
 * Actual chrome.downloads.download calls live in localMarkdownExportCore.ts,
 * shared across all three auto-export timings.
 */

import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { flushBufferedExports } from './localMarkdownExportCore.js';
import { formatLocalDateString } from '../utils/localDate.js';

export const IDLE_FALLBACK_ALARM = 'yasumaro-local-md-flush';
export const DAILY_FLUSH_ALARM = 'yasumaro-local-md-daily-flush';
export const IMMEDIATE_FLUSH_ALARM = 'yasumaro-local-md-immediate';
const IDLE_FALLBACK_INTERVAL_MIN = 30;
const IMMEDIATE_DEBOUNCE_MIN = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function getYesterdayDateString(): string {
  return formatLocalDateString(Date.now() - DAY_MS);
}

export function getNextMidnightTimestamp(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime();
}

/**
 * Wire the alarm/listener combination for the current LOCAL_MARKDOWN_EXPORT_TIMING.
 * Safe to call on every Service Worker startup, and whenever the user changes
 * the timing setting.
 *
 * Only the standing alarms this function owns — the idle fallback and the
 * daily flush — are cleared, and both clears are awaited so a mode switch
 * cannot end up with the previous mode's alarm alive next to the new one.
 * This function is the sole creator of DAILY_FLUSH_ALARM: the recording side
 * never creates it directly and only calls ensureDailyFlushArmed() (arm-only).
 * The idle listener follows the same re-registration discipline: it is a
 * module-level named function removed before re-adding, so repeated calls
 * never accumulate listeners (the shape manualContentFetcher had to fix once
 * already for its tab listener).
 *
 * IMMEDIATE_FLUSH_ALARM is deliberately left untouched: scheduleImmediateFlush()
 * owns that one-shot, arms it per recording, and there is no way to re-create
 * it here because this function cannot tell whether the day's buffer is empty.
 * Clearing it used to drop the pending flush whenever the user merely saved a
 * setting or ran a connection test, holding the day's export back until the
 * next recording. The accepted consequence is that switching away from
 * immediate may still fire one stale one-shot, which is harmless because every
 * flush rewrites the same daily file with conflictAction: 'overwrite'.
 */
function onIdleStateChanged(state: string): void {
  if (state === 'idle') void flushBufferedExports();
}

export async function initExportScheduler(): Promise<void> {
  await chrome.alarms.clear(IDLE_FALLBACK_ALARM);
  await chrome.alarms.clear(DAILY_FLUSH_ALARM);

  const settings = await settingsRepository.getAll();
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING];

  if (chrome.idle) {
    // Remove-then-add regardless of the new mode: a leftover listener from a
    // previous 'idle' setting must not survive a switch to 'daily'/'manual'.
    chrome.idle.onStateChanged.removeListener(onIdleStateChanged);
  }

  if (timing === 'idle') {
    chrome.alarms.create(IDLE_FALLBACK_ALARM, { periodInMinutes: IDLE_FALLBACK_INTERVAL_MIN });
    if (chrome.idle) {
      chrome.idle.onStateChanged.addListener(onIdleStateChanged);
    }
  } else if (timing === 'daily') {
    chrome.alarms.create(DAILY_FLUSH_ALARM, {
      when: getNextMidnightTimestamp(),
      periodInMinutes: 1440,
    });
  }
  // 'manual' needs no standing alarm or listener. 'immediate' arms the
  // per-recording one-shot via scheduleImmediateFlush() and is never re-armed
  // or cleared here.
}

/**
 * Arm-only helper for the recording side (saveLocalMarkdownStep via
 * MarkdownBufferManager): if DAILY_FLUSH_ALARM is already armed its midnight
 * `when` is left untouched, otherwise it is armed once with the same spec
 * initExportScheduler uses. Never recreates an armed alarm, so recordings
 * cannot shift the daily timing off midnight.
 */
export async function ensureDailyFlushArmed(): Promise<void> {
  const existing = await chrome.alarms.get(DAILY_FLUSH_ALARM);
  if (existing) return;
  chrome.alarms.create(DAILY_FLUSH_ALARM, {
    when: getNextMidnightTimestamp(),
    periodInMinutes: 1440,
  });
}

/**
 * Schedule the immediate-mode one-shot flush (saveLocalMarkdownStep calls
 * this per buffered recording). Chrome replaces an alarm with the same name,
 * so rapid recordings collapse into a single flush — at most one download
 * per minute, which is the documented immediate-timing behavior. The alarm
 * body is the shared runLocalMdFlush in alarmRegistry.ts.
 */
export function scheduleImmediateFlush(): void {
  chrome.alarms.create(IMMEDIATE_FLUSH_ALARM, {
    when: Date.now() + IMMEDIATE_DEBOUNCE_MIN * 60 * 1000,
  });
}

/**
 * Flush only yesterday's buffer. Called from the daily alarm handler.
 */
export async function flushYesterdaysExport(): Promise<void> {
  await flushBufferedExports((date) => date === getYesterdayDateString());
}
