/**
 * providerPrioritySlots.ts
 * Single owner of the A/B provider-priority collection rule (PBI 2026-10-02-01).
 *
 * Consolidates the inline copies that lived in settingsPipeline.ts (save path:
 * layout b -> B collect -> A fallback) and generalSettingsPanel.ts (B-view
 * init: A collect -> storage fallback). Saved ProviderSlot[] content, order,
 * empty-array conditions, and the B-try-before-A fallback priority are
 * unchanged — only the branching location moved.
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
 * B try -> A fallback, then storage fallback when DOM collection is empty.
 */
export function collectCurrentProviderPrioritySlots({
  layout,
  bList,
  stored,
}: CurrentProviderPrioritySlotsInput): ProviderSlot[] {
  let slots: ProviderSlot[];
  if (isBPriorityListActive(layout, bList)) {
    try {
      slots = collectBProviderPrioritySlots(bList);
    } catch {
      slots = collectASafe();
    }
  } else {
    slots = collectASafe();
  }
  if (slots.length === 0 && Array.isArray(stored)) return stored as ProviderSlot[];
  return slots;
}

function collectASafe(): ProviderSlot[] {
  try {
    return collectProviderPrioritySlots();
  } catch {
    return [];
  }
}
