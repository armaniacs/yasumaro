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

import { getSettings, StorageKeys } from '../utils/storage.js';
import { flushBufferedExports } from './localMarkdownExportCore.js';

export const IDLE_FALLBACK_ALARM = 'yasumaro-local-md-flush';
export const DAILY_FLUSH_ALARM = 'yasumaro-local-md-daily-flush';
const IDLE_FALLBACK_INTERVAL_MIN = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getYesterdayDateString(): string {
  const d = new Date(Date.now() - DAY_MS);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextMidnightTimestamp(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime();
}

/**
 * Wire the alarm/listener combination for the current LOCAL_MARKDOWN_EXPORT_TIMING.
 * Safe to call on every Service Worker startup, and whenever the user changes
 * the timing setting — always clears prior alarms first so switching modes
 * doesn't leave stale registrations behind.
 */
export async function initExportScheduler(): Promise<void> {
  chrome.alarms.clear(IDLE_FALLBACK_ALARM);
  chrome.alarms.clear(DAILY_FLUSH_ALARM);

  const settings = await getSettings();
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING];

  if (timing === 'idle') {
    chrome.alarms.create(IDLE_FALLBACK_ALARM, { periodInMinutes: IDLE_FALLBACK_INTERVAL_MIN });
    if (chrome.idle) {
      chrome.idle.onStateChanged.addListener((state) => {
        if (state === 'idle') void flushBufferedExports();
      });
    }
  } else if (timing === 'daily') {
    chrome.alarms.create(DAILY_FLUSH_ALARM, {
      when: getNextMidnightTimestamp(),
      periodInMinutes: 1440,
    });
  }
  // 'manual' and 'immediate' need no standing alarm or listener.
}

/**
 * Flush only yesterday's buffer. Called from the daily alarm handler.
 */
export async function flushYesterdaysExport(): Promise<void> {
  await flushBufferedExports((date) => date === getYesterdayDateString());
}
