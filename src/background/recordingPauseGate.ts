/**
 * recordingPauseGate.ts — the shared pause gate for the recording entry
 * points (admission pre-stage and trigger evaluation).
 *
 * Both call sites used to hand-copy the same sequence: dynamic-import
 * recordingPause.js, read the persisted deadline with a fail-open catch, then
 * ask isPaused. One predicate owns that sequence so the read, the fail-open
 * behavior, and the comparison cannot drift between the two.
 *
 * Thin delegation: the sequence itself lives in
 * recordingPause.createRecordingPause().isPaused (fail-open read plus the
 * strict-before-deadline comparison). This module only keeps the shared
 * entry point and the lazy import, so the service worker pays the
 * recordingPause.js load cost only when the gate actually runs.
 */
export async function isRecordingPaused(now: number = Date.now()): Promise<boolean> {
  const { createRecordingPause } = await import('./recordingPause.js');
  return createRecordingPause().isPaused(now);
}
