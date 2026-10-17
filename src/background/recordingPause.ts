// src/background/recordingPause.ts
import { StorageKeys } from '../utils/storage/types.js';

/** One-shot alarm armed per pause. install is a no-op (local-md immediate pattern). */
export const PAUSE_ALARM_NAME = 'yasumaro-recording-resume';
/** Preset choices shown in the popup. Fixed set (custom minutes: out of scope). */
export const PAUSE_PRESETS_MINUTES = [30, 60, 180] as const;

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
  return until;
}

export async function clearPause(
  deps: { storage?: PauseStorage } = {},
): Promise<void> {
  const storage = deps.storage ?? createChromePauseStorage();
  await storage.clearPausedUntil();
  await chrome.alarms.clear(PAUSE_ALARM_NAME);
}
