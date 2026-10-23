/**
 * onboardingBanner.ts
 *
 * First-launch onboarding banner (PBI 2026-10-22-02). Shows the three entry
 * choices (まず試す / Obsidian連携 / AI要約) once on the Initial Setup panel;
 * the user dismisses it and the flag persists. 適用はユーザーの選択のみ:
 * nothing is configured or written behind the banner (既存利用者の動作は
 * 変えない, consent flow untouched).
 *
 * 縮退の出口: a failed flag read or write leaves the banner visible but never
 * blocks the panel — the choices still navigate, the dismissal just does not
 * stick until the next launch.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { tryNavigateTyped } from './panels/registryContext.js';
import { getMessageOr } from '../utils/i18n.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';

/** Whether the banner is still relevant (pure, table-tested). */
export function shouldShowOnboardingBanner(dismissed: boolean): boolean {
  return !dismissed;
}

async function isOnboardingDismissed(): Promise<boolean> {
  try {
    const stored = await settingsRepository.get(StorageKeys.ONBOARDING_DISMISSED);
    return stored === true;
  } catch {
    // 縮退の出口: a corrupted read shows the banner again — the user can
    // dismiss it once more instead of losing the entry points.
    return false;
  }
}

async function dismissOnboarding(): Promise<void> {
  await settingsRepository.set(StorageKeys.ONBOARDING_DISMISSED, true);
}

/**
 * The three entry choices. Navigation rides the panel registry; the settings
 * choices reveal the existing sections instead of duplicating a link.
 */
function wireChoiceActions(container: HTMLElement): void {
  const tryFirst = container.querySelector<HTMLButtonElement>('[data-onboarding-action="try-first"]');
  const obsidian = container.querySelector<HTMLButtonElement>('[data-onboarding-action="obsidian"]');
  const ai = container.querySelector<HTMLButtonElement>('[data-onboarding-action="ai"]');
  tryFirst?.addEventListener('click', () => {
    void tryNavigateTyped('panel-sqlite-history', {});
  });
  obsidian?.addEventListener('click', () => {
    document.getElementById('obsidianEnabled')?.scrollIntoView({ block: 'center' });
    document.getElementById('obsidianEnabled')?.focus();
  });
  ai?.addEventListener('click', () => {
    const section = document.getElementById('aiProviderSection');
    section?.scrollIntoView({ block: 'start' });
    document.getElementById('aiProvider')?.focus();
  });
}

function wireDismiss(container: HTMLElement, banner: HTMLElement): void {
  const dismissButton = container.querySelector<HTMLButtonElement>('[data-onboarding-action="dismiss"]');
  dismissButton?.addEventListener('click', () => {
    void (async () => {
      try {
        await dismissOnboarding();
        banner.hidden = true;
      } catch (error) {
        // 縮退の出口: a failed write hides the banner for this launch anyway —
        // blocking the panel over a persisted flag would be worse.
        banner.hidden = true;
        void logError('[Onboarding] dismiss failed', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'onboardingBanner');
      }
    })();
  });
}

/**
 * Page-level wiring: shows the banner once per install until dismissed.
 * Called from initDashboard, so it targets only static HTML and must not
 * wait on navigation.
 */
export async function initOnboardingBanner(): Promise<void> {
  const banner = document.getElementById('onboardingBanner');
  if (!banner) return;
  const dismissed = await isOnboardingDismissed();
  if (!shouldShowOnboardingBanner(dismissed)) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  wireChoiceActions(banner);
  wireDismiss(banner, banner);
  // The banner text rides data-i18n (applyI18n in main.ts); the intro line is
  // resolved here only where substitution is needed.
  const intro = banner.querySelector<HTMLElement>('#onboardingIntro');
  if (intro) {
    intro.textContent = getMessageOr('onboarding_intro', '設定がなくても記録と検索は使えます。始め方を選んでください。');
  }
}
