/**
 * reviewSummaryAlarm.ts
 * 週次/月次レビューサマリの自動生成を chrome.alarms でスケジュールする
 */

import { getSettings, StorageKeys } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { generateWeeklySummary, generateMonthlySummary } from './reviewSummaryGenerator.js';

const WEEKLY_ALARM_NAME = 'yasumaro-review-weekly';
const MONTHLY_ALARM_NAME = 'yasumaro-review-monthly';

let listenerSetUp = false;

/**
 * レビューサマリ用アラームを初期化する
 * Service Worker起動時に呼ばれる
 */
export async function initializeReviewSummaryAlarms(): Promise<void> {
  const settings = await getSettings();
  const enabled = settings[StorageKeys.REVIEW_SUMMARY_ENABLED] as boolean;

  if (!enabled) {
    // 無効時はアラームをクリアして終了
    await chrome.alarms.clear(WEEKLY_ALARM_NAME);
    await chrome.alarms.clear(MONTHLY_ALARM_NAME);
    return;
  }

  // 週次アラーム: 毎週月曜日 09:00
  await chrome.alarms.create(WEEKLY_ALARM_NAME, {
    when: getNextMondayAt(9, 0),
    periodInMinutes: 7 * 24 * 60 // 1週間
  });

  // 月次アラーム: 毎月1日 09:00
  await chrome.alarms.create(MONTHLY_ALARM_NAME, {
    when: getNextMonthFirstDayAt(9, 0),
    periodInMinutes: 31 * 24 * 60 // 約1ヶ月
  });

  addLog(LogType.INFO, 'Review summary alarms initialized');
}

/**
 * アラームリスナーを設定する
 */
export function setupReviewSummaryAlarmListener(): void {
  if (listenerSetUp) return;
  listenerSetUp = true;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WEEKLY_ALARM_NAME) {
      generateWeeklySummary().catch((err) => {
        addLog(LogType.ERROR, 'Weekly summary alarm failed', { error: String(err) });
      });
    } else if (alarm.name === MONTHLY_ALARM_NAME) {
      generateMonthlySummary().catch((err) => {
        addLog(LogType.ERROR, 'Monthly summary alarm failed', { error: String(err) });
      });
    }
  });
}

/**
 * 次の月曜日の指定時刻を取得する
 */
function getNextMondayAt(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  const day = target.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  target.setDate(target.getDate() + daysUntilMonday);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 7);
  }

  return target.getTime();
}

/**
 * 次の月1日の指定時刻を取得する
 */
function getNextMonthFirstDayAt(hour: number, minute: number): number {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), 1, hour, minute, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, 1, hour, minute, 0, 0);
  }

  return target.getTime();
}
