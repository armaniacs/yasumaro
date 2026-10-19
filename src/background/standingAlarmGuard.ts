/**
 * standingAlarmGuard.ts
 * The pure decision shared by every get-then-create guard on a standing
 * alarm: create it only when no alarm is registered under the name.
 *
 * Why the guard exists: chrome.alarms.create cancels and replaces a same-name
 * alarm, and for a periodInMinutes-only spec the replaced alarm's first
 * firing is recomputed from creation time. Recreating a daily alarm on every
 * Service Worker startup therefore resets its countdown, and the 5-minute
 * offline-retry alarm keeps waking the worker, so the daily job never
 * reaches its scheduled time. Chrome's own docs recommend the
 * get-then-create shape (PBI 2026-10-18-02, 調査結果: RESOLVED).
 *
 * The MV3 side effects stay with the alarm owners: each caller fetches the
 * existing alarm with chrome.alarms.get(name) and only calls
 * chrome.alarms.create when this predicate allows it
 * (localMarkdownIdleFlusher.ensureDailyFlushArmed for the daily local-md
 * flush, alarmRegistry's installDailyPurge for the daily retention purge).
 */
export function shouldCreateStandingAlarm(
  name: string,
  existing: chrome.alarms.Alarm | undefined,
): boolean {
  return existing?.name !== name;
}
