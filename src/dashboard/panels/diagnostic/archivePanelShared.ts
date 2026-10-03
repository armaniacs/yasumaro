/**
 * archivePanelShared.ts
 * Wiring shared by the archive panel lifecycle factories: the controls/busy
 * scope that feeds the in-flight guard in panelAction.ts, the staging state
 * shared between the archive lifecycle and restore areas, and the showStatus
 * target helper.
 */

import { MAX_ARCHIVE_EXPORT_CHUNK_BYTES } from '../../../utils/limits.js';

/** Per-message binary payload — keeps base64 hops under the 10MB cap. */
export const EXPORT_CHUNK_BYTES = MAX_ARCHIVE_EXPORT_CHUNK_BYTES;

/** Local helper keeping showStatus target id logic in one place. */
export function statusTarget(el: HTMLElement | null): HTMLElement | string {
  return el ?? 'archive-status';
}

/**
 * Controls disabled for the duration of each action and restored in its
 * `finally` — the scope the in-flight guard keys on. Sharing one instance
 * across factories is what keeps a second action from starting while any
 * archive-area action runs.
 */
export interface ArchiveBusyScope {
  controls: readonly (HTMLButtonElement | HTMLInputElement | null | undefined)[];
  setAriaBusy(busy: boolean): void;
  statusEl: HTMLElement | null;
}

/**
 * Staging state shared between the archive lifecycle (create stages the
 * outgoing name) and restore (a re-pick during the prepare await must not
 * cross wires — the in-flight guard serializes the runs).
 */
export interface ArchiveStagingState {
  lastStagingName: string | null;
  lastFileName: string;
}
