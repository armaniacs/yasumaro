/**
 * badgePolicy.ts
 * Single owner of the toolbar badge display policy (PBI 2026-09-12-07).
 *
 * Four call sites used to re-derive text + color + tab scoping independently
 * (systemHandlers / recordingHandlers / tabEventHandlers / consentBadge), and
 * the tab-activation path wrote tab-derived state GLOBALLY — under Chrome's
 * per-tab-override semantics a global write becomes the fallback for every
 * tab without its own override, so one tab's "!" bled into the others.
 *
 * The table maps each badge state to its display; scope discipline:
 * tab-derived states (cleansed/recorded/private/excluded/recording) are
 * written per-tab, consent state (no-consent) is inherently global. The
 * cleansed badge intentionally has no timed clear — the old setTimeout in the
 * service worker died with SW suspension anyway (the clear almost never
 * fired); the per-tab badge now persists until the tab's next state
 * transition (navigation clears it via handleTabUpdated).
 */

import { BADGE_COLORS } from '../constants/appConstants.js';

export type BadgeState =
  | { kind: 'cleansed'; count: number }
  | { kind: 'recorded' }
  | { kind: 'private' }
  | { kind: 'excluded' }
  | { kind: 'recording' }
  | { kind: 'no-consent' }
  | { kind: 'clear' };

export interface BadgeDisplay {
  text: string;
  color?: string;
}

/** state → display table. One row per badge state. */
export function badgeDisplay(state: BadgeState): BadgeDisplay {
  switch (state.kind) {
    case 'cleansed':
      return { text: `C${state.count}`, color: BADGE_COLORS.GREEN as string };
    case 'recorded':
      return { text: '◎', color: BADGE_COLORS.BLUE as string };
    case 'private':
      return { text: '!', color: BADGE_COLORS.ORANGE as string };
    case 'no-consent':
      return { text: '!', color: BADGE_COLORS.ORANGE as string };
    case 'excluded':
      return { text: '∉', color: BADGE_COLORS.GREEN as string };
    case 'recording':
      return { text: '●', color: BADGE_COLORS.GREEN as string };
    case 'clear':
      return { text: '' };
  }
}

/**
 * Write a badge through the policy seam. Pass tabId for tab-derived states;
 * omit it only for inherently global states (no-consent).
 */
export async function setBadge(state: BadgeState, tabId?: number): Promise<void> {
  const display = badgeDisplay(state);
  if (tabId !== undefined) {
    await chrome.action.setBadgeText({ text: display.text, tabId });
    if (display.color) {
      await chrome.action.setBadgeBackgroundColor({ color: display.color, tabId });
    }
    return;
  }
  await chrome.action.setBadgeText({ text: display.text });
  if (display.color) {
    await chrome.action.setBadgeBackgroundColor({ color: display.color });
  }
}
