/**
 * recordingPauseGate.ts — the shared pause gate for the recording entry
 * points (admission pre-stage and trigger evaluation).
 *
 * Both call sites used to hand-copy the same sequence: dynamic-import
 * recordingPause.js, read the persisted deadline with a fail-open catch, then
 * ask isPaused. One predicate owns that sequence so the read, the fail-open
 * behavior, and the comparison cannot drift between the two.
 *
 * Storage errors fail open (null => not paused), so the gate never throws
 * into its callers' contracts. recordingPause.js stays behind a dynamic
 * import, as at both former call sites, so the service worker only pays its
 * load cost when the gate actually runs.
 */
export async function isRecordingPaused(now: number = Date.now()): Promise<boolean> {
  const { createChromePauseStorage, isPaused } = await import('./recordingPause.js');
  const pausedUntil = await createChromePauseStorage().getPausedUntil().catch(() => null);
  return isPaused(pausedUntil, now);
}
