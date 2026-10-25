/**
 * captureOutcome.ts
 *
 * Last-capture outcome vocabulary (PBI 2026-10-22-06, slice 2: diag wiring).
 * The diagnostics panel must show the final recording result instead of
 * failing silently, so the content side persists one small record per
 * settled visit: the reason code plus the timestamp. No content, no URL,
 * no title — the record carries nothing an attacker or a synced profile
 * could read back as page text.
 *
 * The code domain is the tree's own reason vocabulary: 'recorded' on
 * success, otherwise the worker's `error`/`reason` verbatim (the same
 * strings `classifyCaptureFailure` in the dashboard table consumes).
 * Unknown codes stay visible as unlisted instead of being dropped.
 */

import type { RecordingResult } from '../messaging/types.js';
import { StorageKeys } from './storage/types.js';

/** Persisted last-capture record: reason code + timestamp only. */
export interface LastCaptureOutcome {
  code: string;
  at: number;
}

/** Success marker: the worker accepted the visit. Not a failure-table code. */
export const RECORDED_OUTCOME_CODE = 'recorded';

/** Terminal transport failure with no worker verdict to quote. */
export const NO_RESPONSE_OUTCOME_CODE = 'no-response';

/**
 * Derives the outcome code from the worker's settled verdict. Success maps
 * to 'recorded'; a settled rejection quotes the worker's error/reason
 * verbatim so the dashboard table classifies the exact string the tree
 * emitted. A missing verdict (undefined response) maps to 'no-response'
 * instead of throwing.
 */
export function deriveOutcomeCode(response: RecordingResult | undefined): string {
  if (!response) return NO_RESPONSE_OUTCOME_CODE;
  if (response.success === true) return RECORDED_OUTCOME_CODE;
  const quoted = response.error ?? response.reason;
  if (typeof quoted === 'string' && quoted !== '') return quoted;
  return NO_RESPONSE_OUTCOME_CODE;
}

/**
 * Fail-closed reader for the persisted record. Corrupt, partial, or
 * foreign shapes (older builds, synced garbage) read as null so the panel
 * renders "no capture yet" instead of crashing or showing a half-record.
 */
export function normalizeOutcome(value: {
  code?: string;
  at?: number;
} | null | undefined): LastCaptureOutcome | null {
  if (!value) return null;
  if (typeof value.code !== 'string' || value.code === '') return null;
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
  return { code: value.code, at: value.at };
}

/** Content-script-safe chrome accessor: undefined outside the extension. */
interface ChromeLocalArea {
  get: (key: string) => Promise<Record<string, { code?: string; at?: number } | undefined>>;
  set: (items: Record<string, LastCaptureOutcome>) => Promise<void>;
}

function localStorageArea(): ChromeLocalArea | undefined {
  const holder = globalThis as { chrome?: { storage?: { local?: ChromeLocalArea } } };
  const area = holder.chrome?.storage?.local;
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') return undefined;
  return area;
}

/**
 * Best-effort persist of the last settled outcome. Never throws and never
 * rejects: the reporting path must not break because a telemetry write
 * failed (unload races, quota, missing chrome in tests).
 */
export async function persistLastCaptureOutcome(outcome: LastCaptureOutcome): Promise<void> {
  try {
    const area = localStorageArea();
    if (!area) return;
    await area.set({ [StorageKeys.LAST_CAPTURE_OUTCOME]: outcome });
  } catch {
    // Telemetry is advisory — a failed write must not fail the visit.
  }
}

/**
 * Best-effort read of the last settled outcome for the dashboard collector.
 * Returns null when nothing was recorded yet or the stored shape is foreign.
 */
export async function readLastCaptureOutcome(): Promise<LastCaptureOutcome | null> {
  try {
    const area = localStorageArea();
    if (!area) return null;
    const raw = await area.get(StorageKeys.LAST_CAPTURE_OUTCOME);
    return normalizeOutcome(raw?.[StorageKeys.LAST_CAPTURE_OUTCOME]);
  } catch {
    return null;
  }
}
