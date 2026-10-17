// src/background/recordingPause.ts
import { StorageKeys } from '../utils/storage/types.js';
import { setBadge } from './badgePolicy.js';

/** One-shot alarm armed per pause. install is a no-op (local-md immediate pattern). */
export const PAUSE_ALARM_NAME = 'yasumaro-recording-resume';
/** Periodic badge-countdown ticker, armed alongside the pause. */
export const PAUSE_TICK_NAME = 'yasumaro-recording-pause-tick';
/** Ticker granularity (minutes). Chrome's minimum repeat period. */
export const PAUSE_TICK_PERIOD_MINUTES = 1;
/**
 * Press steps for the popup pause button (PBI follow-up 2026-10-17: each
 * press extends the deadline by 30 min up to PAUSE_MAX_MINUTES). The popup
 * snaps the computed minutes up into this set; the handler re-validates.
 */
export const PAUSE_PRESETS_MINUTES = [30, 60, 90, 120] as const;
/** Hard cap for accumulated presses (4 presses × 30 min). */
export const PAUSE_MAX_MINUTES = 120;

export type PausePresetMinutes = (typeof PAUSE_PRESETS_MINUTES)[number];

export function isValidPreset(minutes: number): minutes is PausePresetMinutes {
  return (PAUSE_PRESETS_MINUTES as readonly number[]).includes(minutes);
}

/** Pure: paused strictly before the deadline. null/expired => not paused. */
export function isPaused(pausedUntil: number | null, now: number): boolean {
  return pausedUntil !== null && now < pausedUntil;
}

/** schedule/clear/resume go through these seams (injectable in tests). */
export interface PauseStorage {
  getPausedUntil(): Promise<number | null>;
  setPausedUntil(value: number): Promise<void>;
  clearPausedUntil(): Promise<void>;
}

export function createChromePauseStorage(): PauseStorage {
  const key = StorageKeys.RECORDING_PAUSED_UNTIL;
  return {
    async getPausedUntil() {
      const result = await chrome.storage.local.get(key);
      const raw = result[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    },
    async setPausedUntil(value: number) {
      await chrome.storage.local.set({ [key]: value });
    },
    async clearPausedUntil() {
      await chrome.storage.local.remove(key);
    },
  };
}

export async function schedulePause(
  minutes: PausePresetMinutes,
  deps: { storage: PauseStorage; now?: () => number } = { storage: createChromePauseStorage() },
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const until = now + minutes * 60_000;
  await deps.storage.setPausedUntil(until);
  await chrome.alarms.create(PAUSE_ALARM_NAME, { when: until });
  await chrome.alarms.create(PAUSE_TICK_NAME, { periodInMinutes: PAUSE_TICK_PERIOD_MINUTES });
  await setBadge({ kind: 'paused', minutes });
  return until;
}

export async function clearPause(
  deps: { storage?: PauseStorage } = {},
): Promise<void> {
  const storage = deps.storage ?? createChromePauseStorage();
  await storage.clearPausedUntil();
  await chrome.alarms.clear(PAUSE_ALARM_NAME);
  await chrome.alarms.clear(PAUSE_TICK_NAME);
  await setBadge({ kind: 'clear' });
}
