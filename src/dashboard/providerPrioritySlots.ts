/**
 * providerPrioritySlots.ts
 * Single owner of the A/B provider-priority collection rule (PBI 2026-10-02-01).
 *
 * Consolidates the inline copies that lived in settingsPipeline.ts (save path:
 * layout b -> B collect -> A fallback) and generalSettingsPanel.ts (B-view
 * init: A collect -> storage fallback). Saved ProviderSlot[] content, order,
 * and empty-array conditions are unchanged; the B-collector's throw is not
 * swallowed into the A fallback (collector failures propagate uniformly —
 * see collectCurrentProviderPrioritySlots).
 */

import type { ProviderSlot } from '../utils/storage/types.js';
import { collectProviderPrioritySlots } from './generalSettings/settingsForm.js';
import { collectBProviderPrioritySlots } from './aiProviderB/priorityListView.js';

export interface CurrentProviderPrioritySlotsInput {
  /** Active provider-settings layout; anything but 'b' takes the A path. */
  layout: 'a' | 'b' | undefined;
  /** B-layout row container; absent or rowless falls through to the A path. */
  bList?: HTMLElement | null;
  /** Storage snapshot used only when DOM collection yields nothing. */
  stored?: unknown;
}

/**
 * Priority select ids in slot order: index i is slot i+1. The positional
 * coupling is deliberate — the general settings panel derives
 * data-priority="${i+1}", the visibility-refresh slot order, and the change
 * listener wiring from this single list, so a slot change is one edit here.
 */
export const PRIORITY_SELECT_IDS = ['aiProvider', 'aiProviderPriority2', 'aiProviderPriority3'] as const;

/**
 * The optional priority selects (slots 2-3). Slot 1 is required, so only
 * these render with the includeNone "Not set" option.
 */
export const OPTIONAL_PRIORITY_SELECT_IDS = PRIORITY_SELECT_IDS.slice(1);

// Rationale (params/sync over async): callers already hold layout/DOM/storage snapshots from
// different async (save pipeline) vs sync (panel init) paths, so the helper takes them as params
// and stays sync/testable instead of reading the settings repository itself.
export function isBPriorityListActive(
  layout: 'a' | 'b' | undefined,
  bList: HTMLElement | null | undefined,
): bList is HTMLElement {
  return layout === 'b' && !!bList?.querySelector('.b-priority-row');
}

/**
 * Collect the current provider priority slots, B-first with A fallback.
 * B collect when the B layout is active, A collect otherwise, then storage
 * fallback when DOM collection is empty.
 *
 * Throw semantics (PBI 2026-10-02-09 A-throw; B-throw unified with it): BOTH
 * collectors' throws propagate to the caller — a failed collection never
 * falls back to the other collector or to []. Swallowing would persist data
 * the DOM never showed: the save path passes no stored snapshot, so an
 * A-throw swallowed to [] silently blanks the priority list, and a B-throw
 * swallowed into the A collector persists the A hidden inputs' [] while the
 * B UI still shows valid rows. Callers handle the throw: the save pipeline
 * catches it and returns { success: false, error: 'collector_failed' }
 * (rendered via saveErrorText's generic saveError text), and the B-view init
 * catches it and falls back to the stored snapshot. The storage fallback at
 * the end only fires on a legitimately empty DOM collection, never on a
 * throw.
 */
export function collectCurrentProviderPrioritySlots({
  layout,
  bList,
  stored,
}: CurrentProviderPrioritySlotsInput): ProviderSlot[] {
  const slots = isBPriorityListActive(layout, bList)
    ? collectBProviderPrioritySlots(bList)
    : collectProviderPrioritySlots();
  if (slots.length === 0 && Array.isArray(stored)) return stored as ProviderSlot[];
  return slots;
}
