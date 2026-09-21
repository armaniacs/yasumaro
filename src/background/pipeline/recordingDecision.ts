/**
 * recordingDecision.ts — PBI 2026-09-19-08 純粋関数 seam
 *
 * 記録可否判定の verdict 部分だけを集約した pure module。chrome.* 参照・
 * logging・通知・storage 書き込み等の副作用は一切含まない。各 pipeline
 * check step / RecordingTriggerManager.shouldRecord / HeaderDetector の gate
 * 部分はここに委譲するのみ。
 *
 * 優先順位表（判定順序の意味変更はしない — 集約のみ）:
 *   domainFilter -> permission -> trust -> privacyHeaders -> duplicate
 * いずれも FATAL 短絡のため、最初に拒否した gate が競合時の勝者となる。
 * Reordering changes which refusal the user sees — keep this order unless
 * the precedence is deliberately renegotiated.
 */

export const RECORDING_DECISION_ORDER = [
  'domainFilter',
  'permission',
  'trust',
  'privacyHeaders',
  'duplicate',
] as const;

export type RecordingGate = (typeof RECORDING_DECISION_ORDER)[number];

export interface GateVerdict {
  allow: boolean;
  error?: string;
}

// ============================================================================
// Domain filter: isDomainAllowed(url) の bool + force override
// ============================================================================

export function decideDomainFilter(isAllowed: boolean, force: boolean): GateVerdict {
  if (isAllowed) return { allow: true };
  if (force) return { allow: true };
  return { allow: false, error: 'DOMAIN_BLOCKED' };
}

// ============================================================================
// Permission: isHostPermitted(url) の bool + domain 解決可否
// Step は extractDomain(url) || new URL(url).hostname を try/catch で解決する。
// ここでは解決済みの domain を受け取り、verdict のみを返す。
// ============================================================================

export function decidePermission(permitted: boolean, domain: string | null): GateVerdict {
  if (permitted) return { allow: true };
  if (!domain) return { allow: false, error: 'INVALID_URL' };
  return { allow: false, error: 'PERMISSION_REQUIRED' };
}

// ============================================================================
// Trust: TrustChecker.checkDomain(url) の canProceed + force override
// ============================================================================

export function decideTrust(canProceed: boolean, force: boolean): GateVerdict {
  if (canProceed) return { allow: true };
  if (force) return { allow: true };
  return { allow: false, error: 'DOMAIN_NOT_TRUSTED' };
}

// ============================================================================
// Privacy headers: force / whitelist / isPrivate / behavior マトリクス
// ============================================================================

export type PrivacyAutoBehavior = 'save' | 'skip' | 'confirm';

export interface PrivacyDecisionInput {
  force: boolean;
  whitelisted: boolean;
  isPrivate: boolean;
  autoSaveBehavior: PrivacyAutoBehavior;
  requireConfirmation: boolean;
}

export interface PrivacyDecision extends GateVerdict {
  /** true の場合、呼び出し側は pending 保存の副作用を行う */
  savePending: boolean;
  confirmationRequired?: boolean;
  /**
   * どの条件で deny したか。step が throw ペイロードを組み立てる際に
   * マトリクスを再導出しなくて済むように判定側が単一所有する
   * （requireConfirmation と behavior=confirm は confirmationRequired が
   * 同値でも headerValue 有無のペイロード差があるため区別する）。
   */
  deniedBy?: 'requireConfirmation' | 'skip' | 'confirm';
}

export function decidePrivacy(input: PrivacyDecisionInput): PrivacyDecision {
  if (input.force) return { allow: true, savePending: false };
  if (input.whitelisted) return { allow: true, savePending: false };
  if (!input.isPrivate) return { allow: true, savePending: false };

  if (input.requireConfirmation) {
    return {
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
      confirmationRequired: true,
      deniedBy: 'requireConfirmation',
    };
  }
  if (input.autoSaveBehavior === 'skip') {
    return { allow: false, error: 'PRIVATE_PAGE_DETECTED', savePending: true, deniedBy: 'skip' };
  }
  if (input.autoSaveBehavior === 'confirm') {
    return {
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
      confirmationRequired: true,
      deniedBy: 'confirm',
    };
  }
  return { allow: true, savePending: false };
}

// ============================================================================
// Duplicate: same-day (UTC) + URL set 上限
// ============================================================================

export interface DuplicateDecisionInput {
  skipCheck: boolean;
  savedTimestamp: number | undefined;
  now: number;
  urlMapSize: number;
  maxSize: number;
}

export function isSameUtcDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

export function decideDuplicate(input: DuplicateDecisionInput): GateVerdict {
  if (!input.skipCheck && input.savedTimestamp !== undefined && isSameUtcDay(input.savedTimestamp, input.now)) {
    return { allow: false, error: 'same_day' };
  }
  if (input.urlMapSize >= input.maxSize) {
    return { allow: false, error: 'URL_SET_LIMIT_EXCEEDED' };
  }
  return { allow: true };
}

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
// 競合時の勝者: 順序表の先頭から最初の拒否 gate を返す
// ============================================================================

export function evaluateAdmissionPrecedence(
  failures: Record<RecordingGate, boolean>
): RecordingGate | null {
  for (const gate of RECORDING_DECISION_ORDER) {
    if (failures[gate]) return gate;
  }
  return null;
}
