/**
 * generalSettingsLayout.ts
 * A/B provider-settings layout state machine for the general settings panel.
 * Owns the layout state (currentLayout and the two B views) and every DOM
 * update that branches on it: the shared provider option lists, the A
 * per-provider settings mount, the priority visibility refresh, the summary
 * names, and the A/B toggle with its persistence.
 */

import { type Settings, StorageKeys } from '../../../utils/storage/types.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';
import { updateProviderSettingsLayout, hideAllProviderSettings, restoreOriginalProviderSettingsLayout } from '../../aiProviderLayoutManager.js';
import { getAiProviderElements, setupAIProviderChangeListener, updateAIProviderVisibilityMulti } from '../../settings/aiProvider.js';
import { providerIdsInOrder, renderProviderOptions, renderProviderSettings } from '../../aiProviderCatalogView.js';
import { resolveInitialLayout, mountLayoutToggle } from '../../aiProviderLayoutToggle.js';
import { createBPriorityListView } from '../../aiProviderB/priorityListView.js';
import { createBProviderAccordionView } from '../../aiProviderB/providerAccordionView.js';
import {
  collectCurrentProviderPrioritySlots,
  PRIORITY_SELECT_IDS,
  OPTIONAL_PRIORITY_SELECT_IDS,
} from '../../providerPrioritySlots.js';

export interface AiProviderLayoutDeps {
  container: HTMLElement;
  /**
   * The settings snapshot owned by the composition root (reloadFromRepository
   * keeps it current). Read at each layout refresh, not captured, so an
   * A/B toggle after an external write builds the B views from the
   * post-refresh values.
   */
  getSettings: () => Settings;
}

export interface AiProviderLayoutController {
  /**
   * Resolve the initial layout, render the shared <option> lists, and build
   * the A per-provider mount. Must run before the settings snapshot is
   * applied: loadSettingsToInputs targets the blocks this builds.
   */
  prepare(): Promise<void>;
  /** Wire the change listeners and the A/B toggle, then run the first refresh. */
  wire(): void;
}

export function createAiProviderLayoutController(deps: AiProviderLayoutDeps): AiProviderLayoutController {
  const { container, getSettings } = deps;

  // Shared singleton: reads and the layout write go through the same port
  // and settings transaction as every other panel, so no isolated repo.
  const layoutRepo = settingsRepository;
  let currentLayout: 'a' | 'b' = 'a';
  let bPriorityView: ReturnType<typeof createBPriorityListView> | null = null;
  let bAccordionView: ReturnType<typeof createBProviderAccordionView> | null = null;

  const providerMount = container.querySelector('#providerSettingsMount') as HTMLElement | null;
  const bPrioritySection = container.querySelector('#bPrioritySection') as HTMLElement | null;
  const aDetails = container.querySelectorAll<HTMLElement>('.priority-details');

  // Build the A-layout per-provider settings blocks (#<id>Settings) into
  // #providerSettingsMount. In B layout the accordion owns its own blocks
  // with the same ids, so building these here too would create duplicate
  // ids — the A block wins every querySelector and B never gets its values.
  // rebuildProviderSettingsMount() is also called on an A<-B toggle.
  const rebuildProviderSettingsMount = (): void => {
    if (!providerMount) return;
    // Remove any #<id>Settings block that a previous loadGeneralSettings
    // call moved OUT of the mount (updateProviderSettingsLayout relocates
    // the selected provider's block into #priority1ProviderSettings), or
    // a rebuild would create duplicate ids and break strict-mode
    // locators (the mount's fresh block plus the relocated one).
    for (const id of providerIdsInOrder()) {
      document.getElementById(`${id}Settings`)?.remove();
    }
    providerMount.textContent = '';
    for (const id of providerIdsInOrder()) {
      const block = document.createElement('div');
      block.style.display = 'none';
      renderProviderSettings(block, id);
      providerMount.appendChild(block);
    }
  };

  // Update <summary> provider names dynamically
  const updatePrioritySummaryNames = (_selected: string[]): void => {
    PRIORITY_SELECT_IDS.forEach((id, index) => {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      const summaryName = document.querySelector(`.priority-provider-name[data-priority="${index + 1}"]`) as HTMLElement | null;
      if (select && summaryName) {
        const option = select.options[select.selectedIndex];
        summaryName.textContent = option?.value ? `— ${option.text}` : '';
      }
    });
  };

  const refreshMultiVisibility = (): void => {
    // A-layout only: B owns its accordion DOM and never reparents #*Settings.
    if (currentLayout === 'b') return;
    const selected = PRIORITY_SELECT_IDS.map(
      (id) => (document.getElementById(id) as HTMLSelectElement | null)?.value ?? '',
    );
    updateAIProviderVisibilityMulti(getAiProviderElements(), selected);
    updateProviderSettingsLayout(selected);
    updatePrioritySummaryNames(selected);
  };

  const refreshAIProviderLayout = (): void => {
    const isB = currentLayout === 'b';
    if (bPrioritySection) bPrioritySection.hidden = !isB;
    aDetails.forEach((el) => { (el as HTMLElement).hidden = isB; });
    if (isB) {
      // Aの移動を戻してからBを構築（hideAllはBでは不要 — アコーディオン側で可視化するため）
      restoreOriginalProviderSettingsLayout();
      // In B, the accordion owns the #<id>Settings blocks; the A mount must
      // not carry duplicates or its (loaded) fields leak into the priority
      // containers and the accordion shows empty placeholders.
      if (providerMount) providerMount.textContent = '';
      const bListContainer = container.querySelector('#bPriorityList') as HTMLElement | null;
      const bAccordionContainer = container.querySelector('#bProviderAccordion') as HTMLElement | null;
      if (bListContainer && !bPriorityView) {
        // A collect + empty-DOM storage fallback live in the shared helper;
        // this path seeds the B view from A DOM or stored slots. An
        // A-collector throw propagates (PBI 2026-10-02-09), so catch it
        // here and seed from the stored snapshot instead of breaking mount.
        const stored = getSettings()[StorageKeys.AI_PROVIDER_PRIORITY_LIST];
        let existingSlots;
        try {
          existingSlots = collectCurrentProviderPrioritySlots({
            layout: currentLayout,
            stored,
          });
        } catch {
          existingSlots = Array.isArray(stored) ? stored : [];
        }
        bPriorityView = createBPriorityListView(bListContainer, existingSlots, getSettings());
      } else if (bListContainer && bPriorityView) {
        // Ensure hidden flag sync even if view already exists
        bPriorityView.container.hidden = false;
      }
      if (bAccordionContainer && !bAccordionView) {
        bAccordionView = createBProviderAccordionView(bAccordionContainer);
        // The accordion's inputs were just created empty — populate them.
        loadSettingsToInputs(bAccordionContainer, getSettings(), GENERAL_SETTINGS_SCHEMA);
      }
    } else {
      bPriorityView?.container?.querySelectorAll('.b-priority-warn, .b-priority-req-warn').forEach((el) => el.remove());
      bAccordionView?.destroy();
      bPriorityView = null;
      bAccordionView = null;
      // Rebuild the A mount (empty in B) and reload its values.
      rebuildProviderSettingsMount();
      loadSettingsToInputs(container, getSettings(), GENERAL_SETTINGS_SCHEMA);
      hideAllProviderSettings();
      refreshMultiVisibility();
    }
  };

  return {
    async prepare() {
      currentLayout = await resolveInitialLayout(layoutRepo);

      // Provider <option> lists are shared by both layouts.
      const providerSelect = container.querySelector('#aiProvider') as HTMLSelectElement | null;
      if (providerSelect) renderProviderOptions(providerSelect);
      for (const priorityId of OPTIONAL_PRIORITY_SELECT_IDS) {
        const sel = container.querySelector(`#${priorityId}`) as HTMLSelectElement | null;
        if (sel) renderProviderOptions(sel, { includeNone: true });
      }

      if (currentLayout === 'a') rebuildProviderSettingsMount();
    },
    wire() {
      const aiProviderEl = getAiProviderElements();
      if (aiProviderEl.select) {
        setupAIProviderChangeListener(aiProviderEl);
      }

      for (const priorityId of PRIORITY_SELECT_IDS) {
        document.getElementById(priorityId)?.addEventListener('change', refreshMultiVisibility);
      }

      // ヘッダーにトグルをマウント
      const aiSectionTitle = container.querySelector('#aiProviderSection .settings-section-title') as HTMLElement | null;
      if (aiSectionTitle) {
        mountLayoutToggle(aiSectionTitle, currentLayout, async (next) => {
          currentLayout = next;
          await layoutRepo.set(StorageKeys.AI_PROVIDER_LAYOUT, next);
          refreshAIProviderLayout();
        });
      }

      refreshAIProviderLayout();
    },
  };
}
