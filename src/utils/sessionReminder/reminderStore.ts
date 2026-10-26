/**
 * sessionReminderStore.ts
 *
 * Reminder action state (PBI 2026-10-22-04, box (b)): dismiss / re-notify
 * (snooze) / discard with persisted state.
 *
 * Why-analysis conclusions (recorded in the PBI):
 * - Place: chrome.storage.local under the module-owned namespaced key
 *   SESSION_REMINDER_STORAGE_KEY. Session storage would lose dismissals on
 *   restart (re-notify spam); the SQLite record DB is purgeable and must not
 *   mix user state with records.
 * - Payload: record ids only, never URLs/titles (no second PII copy outside
 *   the purgeable DB), bounded to MAX_STORED_RECORDS entries.
 * - Trust: storage is untrusted (corrupt restores, older shapes) — every
 *   load validates and fails closed to the default state. No any/unknown:
 *   validation narrows the persisted shape with typeof guards.
 * - Semantics: dismiss hides for the rest of the local day (re-eligible
 *   tomorrow); snooze hides until an epoch-ms instant (past instants are
 *   immediately re-eligible); discard excludes the id forever (a revisit
 *   creates a new id, so it becomes a candidate again — not a resurrection).
 *
 * Pure transitions take the state as an argument; the async load/save pair
 * takes an injected StorageArea so tests never touch real storage.
 */

import type { StorageArea } from '../ports.js';

/** Module-owned namespaced key (not StorageKeys: no shared-file edits). */
export const SESSION_REMINDER_STORAGE_KEY = 'session_reminder_state_v1';

/** Upper bound on stored per-record entries (memory-growth guard). */
export const MAX_STORED_RECORDS = 500;

export type ReminderRecordState =
  | { kind: 'dismissed'; day: string }
  | { kind: 'snoozed'; untilMs: number }
  | { kind: 'discarded' };

export interface SessionReminderState {
  lastFiredDay: string | null;
  records: Record<string, ReminderRecordState>;
}

/** Persisted wire shape (all fields optional: storage is untrusted). A type
 *  alias (not an interface): interfaces carry no implicit index signature
 *  and cannot satisfy StorageArea.get's Record<string, unknown> bound. */
export type PersistedReminderState = {
  lastFiredDay?: string | null;
  records?: Record<string, { kind?: string; day?: string; untilMs?: number } | null>;
}

export function defaultReminderState(): SessionReminderState {
  return { lastFiredDay: null, records: {} };
}

/** Keys that must never become own properties via bracket assignment. */
function isUnsafeRecordKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
function pruneRecords(records: Record<string, ReminderRecordState>): Record<string, ReminderRecordState> {
  const keys = Object.keys(records);
  if (keys.length <= MAX_STORED_RECORDS) return records;
  const pruned: Record<string, ReminderRecordState> = {};
  for (const key of keys.slice(keys.length - MAX_STORED_RECORDS)) {
    if (isUnsafeRecordKey(key)) continue;
    const entry = records[key];
    if (entry !== undefined) pruned[key] = entry;
  }
  return pruned;
}

/** Validates one loaded record entry; invalid entries are dropped. */
function validateRecordState(raw: { kind?: string; day?: string; untilMs?: number } | null): ReminderRecordState | null {
  if (raw === null || raw === undefined) return null;
  if (raw.kind === 'dismissed') {
    return typeof raw.day === 'string' && raw.day !== '' ? { kind: 'dismissed', day: raw.day } : null;
  }
  if (raw.kind === 'snoozed') {
    return typeof raw.untilMs === 'number' && Number.isFinite(raw.untilMs)
      ? { kind: 'snoozed', untilMs: raw.untilMs }
      : null;
  }
  if (raw.kind === 'discarded') {
    return { kind: 'discarded' };
  }
  return null;
}

/**
 * Fail-closed loader: any shape violation yields the default state (plus
 * the surviving valid entries when only some entries are corrupt).
 */
export function validateReminderState(raw: PersistedReminderState | null | undefined): SessionReminderState {
  if (raw === null || raw === undefined) return defaultReminderState();
  const lastFiredDay = typeof raw.lastFiredDay === 'string' || raw.lastFiredDay === null
    ? raw.lastFiredDay
    : null;
  const records: Record<string, ReminderRecordState> = {};
  if (raw.records !== undefined && raw.records !== null && typeof raw.records === 'object') {
    for (const [key, value] of Object.entries(raw.records)) {
      // storage is untrusted JSON: a '__proto__' own key would otherwise
      // hit the setter and mutate the prototype instead of storing data.
      if (isUnsafeRecordKey(key)) continue;
      const valid = validateRecordState(value);
      if (valid !== null) records[key] = valid;
    }
  }
  return { lastFiredDay, records: pruneRecords(records) };
}

/** Dismiss: hidden for the rest of the local day, re-eligible tomorrow. */
export function dismissReminder(
  state: SessionReminderState,
  recordId: number,
  today: string,
): SessionReminderState {
  return {
    ...state,
    records: pruneRecords({ ...state.records, [String(recordId)]: { kind: 'dismissed', day: today } }),
  };
}

/** Re-notify: hidden until the given epoch-ms instant. */
export function snoozeReminder(
  state: SessionReminderState,
  recordId: number,
  untilMs: number,
): SessionReminderState {
  return {
    ...state,
    records: pruneRecords({ ...state.records, [String(recordId)]: { kind: 'snoozed', untilMs } }),
  };
}

/** Discard: excluded forever for this record id. */
export function discardReminder(state: SessionReminderState, recordId: number): SessionReminderState {
  return {
    ...state,
    records: pruneRecords({ ...state.records, [String(recordId)]: { kind: 'discarded' } }),
  };
}

/** Records the day a notification fired (the daily 間引き write). */
export function markReminderFired(state: SessionReminderState, today: string): SessionReminderState {
  return { ...state, lastFiredDay: today };
}

/**
 * Eligibility of one record id against the stored actions. Dismissed ids
 * become eligible again on a later day; snoozed ids when now reaches the
 * instant; discarded ids never.
 */
export function isRecordEligible(
  state: SessionReminderState,
  recordId: number,
  today: string,
  nowMs: number,
): boolean {
  const entry = state.records[String(recordId)];
  if (entry === undefined) return true;
  if (entry.kind === 'discarded') return false;
  if (entry.kind === 'dismissed') return entry.day !== today;
  return nowMs >= entry.untilMs;
}

export async function loadReminderState(storage: StorageArea): Promise<SessionReminderState> {
  const loaded = await storage.get<Record<string, PersistedReminderState | undefined>>([
    SESSION_REMINDER_STORAGE_KEY,
  ]);
  return validateReminderState(loaded[SESSION_REMINDER_STORAGE_KEY]);
}

export async function saveReminderState(storage: StorageArea, state: SessionReminderState): Promise<void> {
  const persisted: PersistedReminderState = {
    lastFiredDay: state.lastFiredDay,
    records: state.records,
  };
  await storage.set({ [SESSION_REMINDER_STORAGE_KEY]: persisted });
}
