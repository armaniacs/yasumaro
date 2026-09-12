/**
 * TabBadgeResolver — tab badge decision as a pure ordered table.
 *
 * `handleTabActivated` and `handleTabUpdated` used to re-derive the same
 * decision inline (restore → normalizeUrl → privacyCache → isPrivate ?
 * private : isDomainExcluded ? excluded : tail), differing only in the tail.
 * A new badge state or a precedence change needed two synchronized edits.
 *
 * This module owns the decision; the handlers keep only I/O (cache read,
 * `setBadge` call). Precedence, highest first:
 * recorded (activate only) > no-url clear > private > excluded >
 * recording/clear (activate tail) / clear (navigate tail).
 */
import { isDomainAllowed } from '../../utils/domainUtils.js';
import type { BadgeState } from '../badgePolicy.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

export interface TabBadgeInput {
  privacyInfo?: PrivacyInfo | undefined;
  url?: string | undefined;
  /** Auto-saved badge tab — activate keeps ◎, navigate already deleted it. */
  isRecorded: boolean;
  /** True for the activate tail (recording/clear), false for navigate (clear). */
  forActivation: boolean;
  /** Recording gate. Called lazily, only when the tail needs it. */
  isRecordingAllowed?: (() => Promise<boolean>) | undefined;
}

/**
 * Domain filter の除外判定。storage 未設定など失敗時は「除外ではない」に倒す
 * （バッジ表示は補助情報であり、判定不能を「記録されない」と誤表示しない）。
 */
export async function isDomainExcluded(url: string): Promise<boolean> {
  try {
    return !(await isDomainAllowed(url));
  } catch {
    return false;
  }
}

export async function resolveTabBadge(input: TabBadgeInput): Promise<BadgeState> {
  if (input.isRecorded && input.forActivation) {
    return { kind: 'recorded' };
  }
  if (!input.url) {
    return { kind: 'clear' };
  }
  if (input.privacyInfo?.isPrivate) {
    return { kind: 'private' };
  }
  if (await isDomainExcluded(input.url)) {
    return { kind: 'excluded' };
  }
  if (input.forActivation) {
    // 記録が有効なタブでは「記録中」を常時可視化する（PBI 2026-09-05-10）。
    // ゲート（同意）が無い場合は無表示を維持する。
    const allowed = input.isRecordingAllowed ? await input.isRecordingAllowed() : false;
    return allowed ? { kind: 'recording' } : { kind: 'clear' };
  }
  // Navigation also clears the per-tab cleansed badge (C{n}) — the
  // state transition replaces the old SW setTimeout (PBI 2026-09-12-07).
  return { kind: 'clear' };
}
