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

/** Wire error code for a rejected pause request. Owned here so the handler
 * factory maps it without keeping its own preset knowledge. */
export const INVALID_PAUSE_MINUTES = 'INVALID_PAUSE_MINUTES';

/**
 * Single owner of preset validation. The popup wire can carry anything, so
 * the runtime typeof guard stays even though the static type is number:
 * non-number payloads fail closed here while storage reads fail open.
 */
export function validatePauseMinutes(minutes: number): minutes is PausePresetMinutes {
  return typeof minutes === 'number' && isValidPreset(minutes);
}

/** Thrown by RecordingPause.pause for off-preset requests. */
export class InvalidPauseMinutesError extends Error {
  readonly code: string = INVALID_PAUSE_MINUTES;
  constructor() {
    super(INVALID_PAUSE_MINUTES);
  }
}

/** Pure: whole minutes left on the badge countdown, at least 1. */
export function remainingPauseMinutes(pausedUntil: number, now: number): number {
  return Math.max(1, Math.ceil((pausedUntil - now) / 60_000));
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
  // Badge first: if a later alarm call ever throws, the countdown is still
  // visible and the state round-trip (GET_PAUSE_STATE) stays truthful.
  await setBadge({ kind: 'paused', minutes });
  await chrome.alarms.create(PAUSE_ALARM_NAME, { when: until });
  await chrome.alarms.create(PAUSE_TICK_NAME, { periodInMinutes: PAUSE_TICK_PERIOD_MINUTES });
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

/**
 * Badge-tick body (armed alongside the pause, period PAUSE_TICK_PERIOD_MINUTES).
 * Refreshes the global remaining-minutes badge; on expiry (or a missed
 * resume alarm) it stands down via the same clear path as resume so no
 * stale number lingers. Storage errors fail open to the stand-down branch
 * (null => not paused), mirroring the gate predicate.
 */
export async function refreshPauseTick(
  deps: { storage?: PauseStorage; now?: () => number } = {},
): Promise<void> {
  const storage = deps.storage ?? createChromePauseStorage();
  const now = (deps.now ?? Date.now)();
  const until = await storage.getPausedUntil().catch(() => null);
  if (until !== null && isPaused(until, now)) {
    await setBadge({ kind: 'paused', minutes: remainingPauseMinutes(until, now) });
    return;
  }
  await setBadge({ kind: 'clear' });
  await chrome.alarms.clear(PAUSE_TICK_NAME);
}

/** Injectable seams for the pause module. Storage defaults to chrome. */
export interface RecordingPauseDeps {
  storage?: PauseStorage;
  now?: () => number;
}

/**
 * RecordingPause — the single interface behind which all pause knowledge
 * lives: preset validation, fail-open deadline reads, badge countdown,
 * and alarm wiring. Callers learn these five methods instead of the
 * storage key, alarm names, preset list, and badge rows.
 */
export interface RecordingPause {
  /** Validates the preset, then arms storage + badge + alarms. */
  pause(minutes: number): Promise<number>;
  /** Clears storage, both alarms, and the badge. */
  resume(): Promise<void>;
  /** Fail-open gate predicate: storage errors mean not paused. */
  isPaused(now?: number): Promise<boolean>;
  /** Fail-open deadline read: storage errors mean null. */
  getPausedUntil(): Promise<number | null>;
  /** Refreshes (or stands down) the badge countdown. */
  refreshTick(): Promise<void>;
}

export function createRecordingPause(deps: RecordingPauseDeps = {}): RecordingPause {
  const storage = deps.storage ?? createChromePauseStorage();
  const nowFn = deps.now ?? Date.now;
  return {
    async pause(minutes: number): Promise<number> {
      if (!validatePauseMinutes(minutes)) {
        throw new InvalidPauseMinutesError();
      }
      return schedulePause(minutes, { storage, now: nowFn });
    },
    async resume(): Promise<void> {
      await clearPause({ storage });
    },
    async isPaused(now: number = nowFn()): Promise<boolean> {
      const until = await storage.getPausedUntil().catch(() => null);
      return isPaused(until, now);
    },
    async getPausedUntil(): Promise<number | null> {
      return storage.getPausedUntil().catch(() => null);
    },
    async refreshTick(): Promise<void> {
      await refreshPauseTick({ storage, now: nowFn });
    },
  };
}
