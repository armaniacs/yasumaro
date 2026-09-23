/**
 * recordingDecision.ts — PBI 2026-09-19-08 純粋関数 seam
 *
 * The admission gate table (order + verdict pure functions + evaluateGates)
 * lives in the neutral tier at src/utils/recordingGateTable.ts so the service
 * worker pipeline, the content visit gate, and the popup record flow share one
 * precedence owner. This module re-exports that table for backward
 * compatibility and keeps the background-tier verdicts that are outside the
 * admission precedence (trigger / header-detector / save-skip / L0).
 *
 * 優先順位表（判定順序の意味変更はしない — 集約のみ）:
 *   domainFilter -> permission -> trust -> privacyHeaders -> duplicate
 * いずれも FATAL 短絡のため、最初に拒否した gate が競合時の勝者となる。
 * Reordering changes which refusal the user sees — keep this order unless
 * the precedence is deliberately renegotiated.
 */

export {
  RECORDING_DECISION_ORDER,
  type RecordingGate,
  type GateVerdict,
  decideDomainFilter,
  decidePermission,
  decideTrust,
  type PrivacyAutoBehavior,
  type PrivacyDecisionInput,
  type PrivacyDecision,
  decidePrivacy,
  type DuplicateDecisionInput,
  isSameUtcDay,
  decideDuplicate,
  evaluateAdmissionPrecedence,
  type DomainFilterGateInput,
  type PermissionGateInput,
  type TrustGateInput,
  type RecordingGateInputs,
  type RecordingGateRow,
  RECORDING_GATE_TABLE,
  decideGate,
  type GateEvaluation,
  evaluateGates,
  isHttpRecordableUrl,
  type RecordableTabLike,
  isRecordableTab,
} from '../../utils/recordingGateTable.js';

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
