import { saveSettingsAndRefreshDomainFilterCache } from '../../../utils/storage/domainFilterCache.js';
import { type PanelLifecycle } from '../types.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { StorageKeys, type Settings } from '../../../utils/storage/types.js';
import {
  loadGeneralSettings,
  handlePurgeNow, handleContentPurgeNow,
  setupRetentionUnlimitedWarning,
} from '../../generalSettings/settingsForm.js';
import {
  handleSaveOnly, handleTestObsidian, handleTestAi, handleTestLocalMarkdown,
} from '../../generalSettings/connectionTests.js';
import { handleManualLocalMarkdownExport } from '../../localMarkdownExport.js';
import { generateReviewSummary } from '../../reviewSummaryHandler.js';
import { wireProviderPresetButtons } from '../../generalSettings/providerPresets.js';
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
import { setupAllFieldValidations, setupObsidianHostValidation, setupGeminiApiVersionValidation } from '../../settings/fieldValidation.js';
import { initOnboardingWizard } from '../../../utils/ui/onboardingWizard.js';
import { ModelsDevDialog } from '../../models-dev-dialog.js';

/**
 * Review summary buttons live only on this panel, so their handlers do too.
 * Both are thin shells over generateReviewSummary.
 */
async function handleGenerateWeeklySummary(): Promise<void> {
  const btn = document.getElementById('generateWeeklySummaryBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('reviewSummaryStatus') as HTMLElement | null;
  await generateReviewSummary({ button: btn, statusElement: statusEl, periodType: 'weekly' });
}

async function handleGenerateMonthlySummary(): Promise<void> {
  const btn = document.getElementById('generateMonthlySummaryBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('reviewSummaryStatus') as HTMLElement | null;
  await generateReviewSummary({ button: btn, statusElement: statusEl, periodType: 'monthly' });
}

const WIZARD_CLASS_OBSERVER_INIT: MutationObserverInit = { attributes: true, attributeFilter: ['class'] };

let wizardClassObserver: MutationObserver | null = null;
let wizardClassObserverTarget: Element | null = null;

function syncWizardBackdrop(): void {
  const backdropNow = document.getElementById('wizardBackdrop');
  const wizardNow = document.getElementById('onboardingWizard');
  if (backdropNow) backdropNow.style.display = wizardNow?.classList.contains('hidden') ? 'none' : 'block';
}

/**
 * One observer for the wizard's class attribute, reused by every reopen. A
 * fresh MutationObserver per click stacked up on the same element — nothing
 * ever disconnected them, so N reopens meant N live observers.
 */
function observeWizardClasses(wizardEl: Element): void {
  if (wizardClassObserverTarget !== wizardEl) {
    wizardClassObserver?.disconnect();
    wizardClassObserverTarget = wizardEl;
  }
  if (!wizardClassObserver) wizardClassObserver = new MutationObserver(syncWizardBackdrop);
  wizardClassObserver.observe(wizardEl, WIZARD_CLASS_OBSERVER_INIT);
}

export function createGeneralSettingsPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  let panelContainer: HTMLElement | null = null;
  // One mutable snapshot shared by mount() and refresh(). The layout toggle
  // reads it lazily, so a per-path local would leave it rebuilding the A/B
  // inputs from the values captured at mount time after any refresh or
  // external write.
  let currentSettings: Settings = {};
  // Shared by refresh() and the import/restore listener so both update the
  // same snapshot and the same inputs.
  const reloadFromRepository = async (): Promise<void> => {
    const container = panelContainer;
    if (!container) return;
    currentSettings = await settingsRepository.getAll();
    loadSettingsToInputs(container, currentSettings, GENERAL_SETTINGS_SCHEMA);
    await loadGeneralSettings();
  };
  return {
    id: 'panel-general',
    category: 'static-form',
    async mount(container) {
      panelContainer = container;
      currentSettings = await settingsRepository.getAll();

      // Shared singleton: reads and the layout write go through the same port
      // and settings transaction as every other panel, so no isolated repo.
      const layoutRepo = settingsRepository;
      let currentLayout = await resolveInitialLayout(layoutRepo) as 'a' | 'b';

      // Provider <option> lists are shared by both layouts.
      const providerSelect = container.querySelector('#aiProvider') as HTMLSelectElement | null;
      if (providerSelect) renderProviderOptions(providerSelect);
      for (const priorityId of OPTIONAL_PRIORITY_SELECT_IDS) {
        const sel = container.querySelector(`#${priorityId}`) as HTMLSelectElement | null;
        if (sel) renderProviderOptions(sel, { includeNone: true });
      }

      const providerMount = container.querySelector('#providerSettingsMount') as HTMLElement | null;
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
      if (currentLayout === 'a') rebuildProviderSettingsMount();

      loadSettingsToInputs(container, currentSettings, GENERAL_SETTINGS_SCHEMA);
      await loadGeneralSettings();

      const obsidianEnabled = container.querySelector('#obsidianEnabled') as HTMLInputElement | null;
      const obsidianDetails = container.querySelector('#obsidianSettingsDetails') as HTMLDetailsElement | null;
      if (obsidianEnabled && obsidianDetails) {
        obsidianEnabled.addEventListener('change', () => {
          obsidianDetails.open = obsidianEnabled.checked;
        });
      }

      const localExportEnabled = container.querySelector('#localMarkdownExportEnabled') as HTMLInputElement | null;
      const localExportSettingsDiv = container.querySelector('#localMarkdownExportSettings') as HTMLElement | null;
      if (localExportEnabled && localExportSettingsDiv) {
        localExportEnabled.addEventListener('change', () => {
          localExportSettingsDiv.classList.toggle('hidden', !localExportEnabled.checked);
        });
      }

      const reviewSummaryEnabled = container.querySelector('#reviewSummaryEnabled') as HTMLInputElement | null;
      const reviewSummaryManualActions = container.querySelector('#reviewSummaryManualActions') as HTMLElement | null;
      if (reviewSummaryEnabled && reviewSummaryManualActions) {
        reviewSummaryEnabled.addEventListener('change', () => {
          reviewSummaryManualActions.classList.toggle('hidden', !reviewSummaryEnabled.checked);
        });
      }

      container.querySelector('#generateWeeklySummaryBtn')?.addEventListener('click', handleGenerateWeeklySummary);
      container.querySelector('#generateMonthlySummaryBtn')?.addEventListener('click', handleGenerateMonthlySummary);

      const aiProviderEl = getAiProviderElements();
      if (aiProviderEl.select) {
        setupAIProviderChangeListener(aiProviderEl);
      }

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

      for (const priorityId of PRIORITY_SELECT_IDS) {
        document.getElementById(priorityId)?.addEventListener('change', refreshMultiVisibility);
      }

      let bPriorityView: ReturnType<typeof createBPriorityListView> | null = null;
      let bAccordionView: ReturnType<typeof createBProviderAccordionView> | null = null;

      const bPrioritySection = container.querySelector('#bPrioritySection') as HTMLElement | null;
      const aDetails = container.querySelectorAll<HTMLElement>('.priority-details');

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
            const stored = currentSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST];
            let existingSlots;
            try {
              existingSlots = collectCurrentProviderPrioritySlots({
                layout: currentLayout,
                stored,
              });
            } catch {
              existingSlots = Array.isArray(stored) ? stored : [];
            }
            bPriorityView = createBPriorityListView(bListContainer, existingSlots, currentSettings);
          } else if (bListContainer && bPriorityView) {
            // Ensure hidden flag sync even if view already exists
            bPriorityView.container.hidden = false;
          }
          if (bAccordionContainer && !bAccordionView) {
            bAccordionView = createBProviderAccordionView(bAccordionContainer);
            // The accordion's inputs were just created empty — populate them.
            loadSettingsToInputs(bAccordionContainer, currentSettings, GENERAL_SETTINGS_SCHEMA);
          }
        } else {
          bPriorityView?.container?.querySelectorAll('.b-priority-warn, .b-priority-req-warn').forEach((el) => el.remove());
          bAccordionView?.destroy();
          bPriorityView = null;
          bAccordionView = null;
          // Rebuild the A mount (empty in B) and reload its values.
          rebuildProviderSettingsMount();
          loadSettingsToInputs(container, currentSettings, GENERAL_SETTINGS_SCHEMA);
          hideAllProviderSettings();
          refreshMultiVisibility();
        }
      };

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

      {
        const observeWizard = () => {
          const wizardEl = document.getElementById('onboardingWizard');
          const backdropEl = document.getElementById('wizardBackdrop');
          if (wizardEl && backdropEl) {
            observeWizardClasses(wizardEl);
          }
        };
        const reopenWizard = () => {
          const wizard = document.getElementById('onboardingWizard');
          if (wizard) {
            delete wizard.dataset.initialized;
          }
          initOnboardingWizard(true);
          observeWizard();
          syncWizardBackdrop();
        };
        container.querySelector('#reopenWizardBtn')?.addEventListener('click', reopenWizard);
        container.querySelector('#reopenWizardBtnTop')?.addEventListener('click', reopenWizard);
      }

      const bindTopButton = (id: string, handler: () => void) => {
        container.querySelector(`#${id}`)?.addEventListener('click', () => handler());
      };

      bindTopButton('saveTop', handleSaveOnly);
      bindTopButton('testObsidianBtnTop', handleTestObsidian);
      bindTopButton('testAiBtnTop', handleTestAi);
      bindTopButton('testLocalMarkdownBtnTop', handleTestLocalMarkdown);
      bindTopButton('localExportManualBtn', handleManualLocalMarkdownExport);

      setupAllFieldValidations(
        document.getElementById('protocol') as HTMLInputElement | null,
        document.getElementById('port') as HTMLInputElement | null,
      );
      setupObsidianHostValidation(container.querySelector('#obsidianHost') as HTMLInputElement | null);
      setupGeminiApiVersionValidation(container.querySelector('#geminiApiVersion') as HTMLInputElement | null);

      const openModelsDevDialogBtn = container.querySelector('#openModelsDevDialogBtn') as HTMLButtonElement;
      const selectedProviderInfoDiv = container.querySelector('#selectedProviderInfo') as HTMLElement;
      const providerInfoDisplayDiv = container.querySelector('#providerInfoDisplay') as HTMLElement;

      let modelsDevDialog: ModelsDevDialog | null = null;
      openModelsDevDialogBtn?.addEventListener('click', async () => {
        if (!modelsDevDialog) {
          modelsDevDialog = new ModelsDevDialog({
            onSave: async (providerId, baseUrl, apiKey, model) => {
              selectedProviderInfoDiv?.classList.remove('hidden');
              providerInfoDisplayDiv!.textContent = `${providerId} (${baseUrl})${model ? ` - ${model}` : ''}`;
              const providerApiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement | null;
              const providerModelInput = document.getElementById('providerModel') as HTMLInputElement | null;
              if (providerApiKeyInput) providerApiKeyInput.value = apiKey;
              if (providerModelInput) providerModelInput.value = model;
              // Delta write (PBI 2026-09-17-17): the four connection keys this
              // dialog owns enter the payload alone, so the connection fields a
              // concurrent writer changed are not reverted by a getAll() snapshot.
              await saveSettingsAndRefreshDomainFilterCache({
                [StorageKeys.PROVIDER_TYPE]: providerId,
                [StorageKeys.PROVIDER_BASE_URL]: baseUrl,
                [StorageKeys.PROVIDER_API_KEY]: apiKey,
                [StorageKeys.PROVIDER_MODEL]: model,
              });
            },
            onCancel: () => {}
          });
        }
        await modelsDevDialog.show();
      });

      wireProviderPresetButtons(container);

      document.getElementById('save')?.addEventListener('click', handleSaveOnly);
      document.getElementById('testObsidianBtn')?.addEventListener('click', handleTestObsidian);
      document.getElementById('testAiBtn')?.addEventListener('click', handleTestAi);
      container.querySelector('#testLocalMarkdownBtnBottom')?.addEventListener('click', () => handleTestLocalMarkdown());
      // The purge handlers render their own failure text; this boundary only
      // stops an unexpected throw from escaping as an unhandled rejection.
      const onPurgeClick = (handler: () => Promise<void>) => async (): Promise<void> => {
        try {
          await handler();
        } catch (error) {
          console.error('General settings: purge failed', error);
        }
      };
      document.getElementById('purgeNowBtn')?.addEventListener('click', onPurgeClick(handlePurgeNow));
      document.getElementById('contentPurgeNowBtn')?.addEventListener('click', onPurgeClick(handleContentPurgeNow));

      // Unlimited-retention warning follows the two record-layer bound selects.
      setupRetentionUnlimitedWarning();

      // Settings import/restore completion (exportImport.ts, encryptedBackupPanel.ts)
      // is signalled with this document event; those flows only see settings
      // modules, so the panel — which owns the snapshot the layout toggle
      // reads — listens itself instead of exposing its instance. A failed
      // reload is logged and must not break the flow's own completion status.
      document.addEventListener('reload-general-settings', async () => {
        try {
          await reloadFromRepository();
        } catch (error) {
          console.error('General settings: reload after import/restore failed', error);
        }
      });
    },
    async refresh() {
      await reloadFromRepository();
    },
  };
}
