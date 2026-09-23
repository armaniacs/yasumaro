// @layer 0 — Foundation: recording admission gate table (pure, no chrome, no storage)
//
// Single seam for the recording-allowance precedence shared by the service
// worker pipeline, the content visit gate, and the popup record flow.
// Reordering changes which refusal the user sees — keep this order unless
// the precedence is deliberately renegotiated.

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

// ============================================================================
// Gate table: each row is { name, decide }. Adding a gate is one row here;
// decideGate / evaluateGates / step adapters follow without further edits.
// ============================================================================

export interface DomainFilterGateInput {
  isAllowed: boolean;
  force: boolean;
}

export interface PermissionGateInput {
  permitted: boolean;
  domain: string | null;
}

export interface TrustGateInput {
  canProceed: boolean;
  force: boolean;
}

export interface RecordingGateInputs {
  domainFilter: DomainFilterGateInput;
  permission: PermissionGateInput;
  trust: TrustGateInput;
  privacyHeaders: PrivacyDecisionInput;
  duplicate: DuplicateDecisionInput;
}

export type RecordingGateRow = {
  [N in RecordingGate]: {
    name: N;
    decide: (input: RecordingGateInputs[N]) => GateVerdict;
  };
}[RecordingGate];

export const RECORDING_GATE_TABLE: readonly RecordingGateRow[] = [
  {
    name: 'domainFilter',
    decide: (input: DomainFilterGateInput): GateVerdict =>
      decideDomainFilter(input.isAllowed, input.force),
  },
  {
    name: 'permission',
    decide: (input: PermissionGateInput): GateVerdict =>
      decidePermission(input.permitted, input.domain),
  },
  {
    name: 'trust',
    decide: (input: TrustGateInput): GateVerdict =>
      decideTrust(input.canProceed, input.force),
  },
  {
    name: 'privacyHeaders',
    decide: (input: PrivacyDecisionInput): GateVerdict => decidePrivacy(input),
  },
  {
    name: 'duplicate',
    decide: (input: DuplicateDecisionInput): GateVerdict => decideDuplicate(input),
  },
];

export function decideGate(name: 'domainFilter', input: DomainFilterGateInput): GateVerdict;
export function decideGate(name: 'permission', input: PermissionGateInput): GateVerdict;
export function decideGate(name: 'trust', input: TrustGateInput): GateVerdict;
export function decideGate(name: 'privacyHeaders', input: PrivacyDecisionInput): PrivacyDecision;
export function decideGate(name: RecordingGate, input: RecordingGateInputs[RecordingGate]): GateVerdict;
export function decideGate(name: RecordingGate, input: RecordingGateInputs[RecordingGate]): GateVerdict {
  const row = RECORDING_GATE_TABLE.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`Unknown recording gate: ${name}`);
  return (row.decide as (entry: RecordingGateInputs[RecordingGate]) => GateVerdict)(input);
}

export interface GateEvaluation {
  /** First-denying gate in table order; null when every gate allows. */
  gate: RecordingGate | null;
  verdict: GateVerdict;
}

/**
 * FATAL short-circuit over pure inputs: the first-denying gate wins the
 * display, matching the service worker pipeline's stop-on-first-rejection.
 */
export function evaluateGates(inputs: RecordingGateInputs): GateEvaluation {
  for (const row of RECORDING_GATE_TABLE) {
    const verdict = decideGate(row.name, inputs[row.name] as never);
    if (!verdict.allow) return { gate: row.name, verdict };
  }
  return { gate: null, verdict: { allow: true } };
}

// ============================================================================
// Scheme pre-check shared by popup (isRecordable) and content (visit gate).
// This sits outside the ordered table on purpose: it is a URL-shape guard
// with no settings input, so folding it into the precedence would renumber
// the display order. It mirrors tabUtils.isRecordable byte-for-byte.
// ============================================================================

export function isHttpRecordableUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('http');
}

export interface RecordableTabLike {
  readonly url?: string | undefined;
}

export function isRecordableTab(tab: RecordableTabLike | null | undefined): boolean {
  return !!tab?.url && isHttpRecordableUrl(tab.url);
}
