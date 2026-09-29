// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/trancoConsent.ts
 * Tranco 同意のルール判断と、同意状態 3 キーの delta write。
 *
 * WHY one owner: popup のバナーと dashboard のパネルが同じ「拒否から 30 日
 * 経ったら再提示」ルールを別々に実装しており、境界で結論が割れていた
 * （dashboard は経過日数を切り上げるため 29.5 日でも再提示としていた）。
 * 判定はここ 1 箇所に置き、表記の差（dashboard の 5 状態 / popup の boolean）
 * は呼び出し側の写像に残す。
 */

import { StorageKeys } from './types.js';
import { saveSettingsAndRefreshDomainFilterCache } from './domainFilterCache.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 拒否の記録から再提示を許すまでの日数。 */
export const TRANCO_CONSENT_RETRY_INTERVAL_DAYS = 30;

/** 拒否記録として保存する理由。 */
const TRANCO_CONSENT_DENY_REASON = 'deny';

export interface TrancoConsentSnapshot {
  /** 現在の Tranco バージョン。 */
  currentVersion: string;
  /** 同意済みとして記録されたバージョン。未同意なら null。 */
  grantedVersion: string | null;
  /** 拒否時刻。拒否記録が無いなら null。 */
  deniedTimestamp: number | null;
}

export interface TrancoConsentDecision {
  /** 現在バージョンへの同意が記録済みか。 */
  alreadyGranted: boolean;
  /** 拒否記録があるか。 */
  hasDenial: boolean;
  /** 30 日ルールに基づく、同意/拒否の提示可否。 */
  needsConsent: boolean;
  /** 拒否記録から再提示できるまでの日数。拒否記録が無い場合は null。 */
  daysUntilRetry: number | null;
}

/**
 * 30 日ルールの唯一の判定。
 *
 * 経過日数を切り上げる実装では、30 日未満でも再提示扱いになる。境界の定義は
 * 「30 日が満了するまで再提示しない」。
 */
export function evaluateTrancoConsent(
  snapshot: TrancoConsentSnapshot,
  now: number = Date.now(),
): TrancoConsentDecision {
  const alreadyGranted = snapshot.grantedVersion === snapshot.currentVersion;
  const deniedTimestamp = snapshot.deniedTimestamp;
  const hasDenial = typeof deniedTimestamp === 'number' && Number.isFinite(deniedTimestamp);

  if (alreadyGranted) {
    return { alreadyGranted, hasDenial, needsConsent: false, daysUntilRetry: null };
  }
  if (!hasDenial) {
    return { alreadyGranted, hasDenial, needsConsent: true, daysUntilRetry: null };
  }

  const retryAt = deniedTimestamp + TRANCO_CONSENT_RETRY_INTERVAL_DAYS * MS_PER_DAY;
  return {
    alreadyGranted,
    hasDenial,
    needsConsent: now >= retryAt,
    daysUntilRetry: Math.max(0, Math.ceil((retryAt - now) / MS_PER_DAY)),
  };
}

/** popup 側の boolean 表現。判定そのものは evaluateTrancoConsent に委ねる。 */
export function needsTrancoConsent(
  snapshot: TrancoConsentSnapshot,
  now: number = Date.now(),
): boolean {
  return evaluateTrancoConsent(snapshot, now).needsConsent;
}

export async function persistTrancoConsentGrant(version: string): Promise<void> {
  // Delta write: only the three consent keys this decision owns enter the
  // payload, so a concurrent writer's change to an unrelated key is not
  // reverted by a getAll() snapshot.
  await saveSettingsAndRefreshDomainFilterCache({
    [StorageKeys.TRANCO_CONSENT_GRANTED]: version,
    [StorageKeys.TRANCO_CONSENT_DENIED_REASON]: null,
    [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: null,
  });
}

export async function persistTrancoConsentDeny(deniedAt: number = Date.now()): Promise<void> {
  // Same three keys as the grant path.
  await saveSettingsAndRefreshDomainFilterCache({
    [StorageKeys.TRANCO_CONSENT_GRANTED]: null,
    [StorageKeys.TRANCO_CONSENT_DENIED_REASON]: TRANCO_CONSENT_DENY_REASON,
    [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: deniedAt,
  });
}
