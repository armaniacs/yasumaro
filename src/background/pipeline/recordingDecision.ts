/**
 * recordingDecision.ts — background-tier verdicts (PBI 2026-09-19-08 seam,
 * PBI 2026-10-16-07 shim removal).
 *
 * The admission gate table (order + verdict pure functions + evaluateGates)
 * lives ONLY at src/utils/recordingGateTable.ts. Import it directly —
 * this module no longer re-exports it. This module keeps the background-tier
 * verdicts that are outside the admission precedence (trigger /
 * header-detector / save-skip / L0).
 *
 * 判定順序の SSOT は src/utils/recordingGateTable.ts を参照。
 */

// ============================================================================
// Recording trigger (RecordingTriggerManager.shouldRecord の純粋核):
// event + triggers + thresholds -> bool。storage 読みは呼び出し側。
// ============================================================================

export type RecordingEventType = 'scroll_idle' | 'manual_save' | 'snapshot';

export interface RecordingTriggerSettings {
  scrollAndTime: boolean;
  manualSave: boolean;
  periodicSnapshot: boolean;
}

export interface RecordingTriggerEvent {
  type: string;
  scrollPercent?: number;
  visitDuration?: number;
}

export function decideRecordingTrigger(
  event: RecordingTriggerEvent,
  triggers: RecordingTriggerSettings,
  minScrollDepth: number,
  minVisitDurationMs: number
): boolean {
  switch (event.type as RecordingEventType) {
    case 'scroll_idle': {
      if (!triggers.scrollAndTime) return false;
      if ((event.scrollPercent ?? 0) < minScrollDepth) return false;
      if ((event.visitDuration ?? 0) < minVisitDurationMs) return false;
      return true;
    }
    case 'manual_save':
      return triggers.manualSave;
    case 'snapshot':
      return triggers.periodicSnapshot;
    default:
      return false;
  }
}

// ============================================================================
// HeaderDetector gate: main_frame + text/html のみ処理する純粋判定
// ============================================================================

export interface HeadersGateResult {
  process: boolean;
  reason?: string;
}

export function shouldProcessHeadersResponse(
  resourceType: string | undefined,
  contentTypeValue: string | undefined
): HeadersGateResult {
  if (resourceType !== 'main_frame') return { process: false, reason: 'non-main_frame' };
  if (!contentTypeValue?.includes('text/html')) return { process: false, reason: 'non-html' };
  return { process: true };
}

// ============================================================================
// Save skip: obsidianEnabled flag + client presence -> skip verdict.
// Step keeps the I/O (settings read, deps.obsidian presence, logging).
// Disabled takes precedence over absent client, matching step order.
// ============================================================================

export interface SaveSkipVerdict {
  skip: boolean;
  reason?: string;
}

export function decideSaveSkip(obsidianEnabled: boolean, clientPresent: boolean): SaveSkipVerdict {
  if (!obsidianEnabled) return { skip: true, reason: 'obsidian-disabled' };
  if (!clientPresent) return { skip: true, reason: 'no-client' };
  return { skip: false };
}

// ============================================================================
// L0 skip: enabled flag -> skip verdict. Step keeps settings read + logging.
// ============================================================================

export function decideL0(enabled: boolean): SaveSkipVerdict {
  if (!enabled) return { skip: true, reason: 'l0-disabled' };
  return { skip: false };
}
