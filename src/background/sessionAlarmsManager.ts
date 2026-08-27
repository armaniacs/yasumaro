/**
 * sessionAlarmsManager.ts
 * セッションタイムアウト管理 (chrome.alarms API)
 * Service Worker環境対応
 *
 * 実体は SessionAlarmService (AlarmPort + Clock + StoragePort 注入可能) に移した。
 * 既存呼び出し元 (service-worker.ts 等) との互換性のため関数エクスポートを維持する。
 */

import { SessionAlarmService } from './SessionAlarmService.js';

const defaultSessionAlarmService = new SessionAlarmService();

export async function updateActivity(): Promise<void> {
  return defaultSessionAlarmService.updateActivity();
}

export async function startTimeoutChecker(): Promise<void> {
  return defaultSessionAlarmService.startTimeoutChecker();
}

export async function stopTimeoutChecker(): Promise<void> {
  return defaultSessionAlarmService.stopTimeoutChecker();
}

export async function initialize(): Promise<void> {
  return defaultSessionAlarmService.initialize();
}
