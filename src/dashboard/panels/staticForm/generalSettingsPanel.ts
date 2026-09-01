import { updateDomainFilterCache } from '../../../utils/storage/domainFilterCache.js';
import { type PanelLifecycle } from '../types.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { getMessage } from '../../../utils/i18n.js';
import {
  loadGeneralSettings,
  handlePurgeNow, handleContentPurgeNow,
} from '../../generalSettings/settingsForm.js';
import {
  handleSaveOnly, handleTestObsidian, handleTestAi, handleTestLocalMarkdown,
} from '../../generalSettings/connectionTests.js';
import { handleManualLocalMarkdownExport } from '../../localMarkdownExport.js';
import { generateReviewSummary } from '../../reviewSummaryHandler.js';
import { syncStatusToTop } from '../../statusView.js';
import { updateProviderSettingsLayout, hideAllProviderSettings, restoreOriginalProviderSettingsLayout } from '../../aiProviderLayoutManager.js';
import { getAiProviderElements, setupAIProviderChangeListener, updateAIProviderVisibilityMulti } from '../../settings/aiProvider.js';
import { providerIdsInOrder, renderProviderOptions, renderProviderSettings } from '../../aiProviderCatalogView.js';
import { resolveInitialLayout, mountLayoutToggle } from '../../aiProviderLayoutToggle.js';
import { createBPriorityListView } from '../../aiProviderB/priorityListView.js';
import { createBProviderAccordionView } from '../../aiProviderB/providerAccordionView.js';
import { SettingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { ChromeStoragePort } from '../../../utils/storage/storagePort.js';
import { collectProviderPrioritySlots } from '../../generalSettings/settingsForm.js';
import { setupAllFieldValidations, setupObsidianHostValidation, setupGeminiApiVersionValidation } from '../../settings/fieldValidation.js';
import { initOnboardingWizard } from '../../../popup/onboardingWizard.js';
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

export function createGeneralSettingsPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  let panelContainer: HTMLElement | null = null;
  return {
    id: 'panel-general',
    category: 'static-form',
    async mount(container) {
      panelContainer = container;
      const settings = await settingsRepository.getAll();

      const layoutRepo = new SettingsRepository(new ChromeStoragePort());
      let currentLayout = await resolveInitialLayout(layoutRepo) as 'a' | 'b';

      // Provider <option> lists are shared by both layouts.
      const providerSelect = container.querySelector('#aiProvider') as HTMLSelectElement | null;
      if (providerSelect) renderProviderOptions(providerSelect);
      for (const priorityId of ['aiProviderPriority2', 'aiProviderPriority3']) {
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
        providerMount.textContent = '';
        for (const id of providerIdsInOrder()) {
          const block = document.createElement('div');
          block.style.display = 'none';
          renderProviderSettings(block, id);
          providerMount.appendChild(block);
        }
      };
      if (currentLayout === 'a') rebuildProviderSettingsMount();

      loadSettingsToInputs(container, settings, GENERAL_SETTINGS_SCHEMA);
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
        const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement | null;
        const aiProviderPriority2Select = document.getElementById('aiProviderPriority2') as HTMLSelectElement | null;
        const aiProviderPriority3Select = document.getElementById('aiProviderPriority3') as HTMLSelectElement | null;
        const selected = [
          aiProviderSelect?.value ?? '',
          aiProviderPriority2Select?.value ?? '',
          aiProviderPriority3Select?.value ?? ''
        ];
        updateAIProviderVisibilityMulti(getAiProviderElements(), selected);
        updateProviderSettingsLayout(selected);
        updatePrioritySummaryNames(selected);
      };

      // Update <summary> provider names dynamically
      const updatePrioritySummaryNames = (_selected: string[]): void => {
        const selects = ['aiProvider', 'aiProviderPriority2', 'aiProviderPriority3'];
        selects.forEach((id, index) => {
          const select = document.getElementById(id) as HTMLSelectElement | null;
          const summaryName = document.querySelector(`.priority-provider-name[data-priority="${index + 1}"]`) as HTMLElement | null;
          if (select && summaryName) {
            const option = select.options[select.selectedIndex];
            summaryName.textContent = option?.value ? `— ${option.text}` : '';
          }
        });
      };

      document.getElementById('aiProvider')?.addEventListener('change', refreshMultiVisibility);
      document.getElementById('aiProviderPriority2')?.addEventListener('change', refreshMultiVisibility);
      document.getElementById('aiProviderPriority3')?.addEventListener('change', refreshMultiVisibility);

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
            let existingSlots: ReturnType<typeof collectProviderPrioritySlots> = [];
            try {
              existingSlots = collectProviderPrioritySlots();
            } catch { existingSlots = []; }
            // storage fallback if DOM collection is empty (initial load after reload)
            if (existingSlots.length === 0) {
              const stored = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as unknown as typeof existingSlots | undefined;
              if (Array.isArray(stored)) existingSlots = stored;
            }
            bPriorityView = createBPriorityListView(bListContainer, existingSlots);
          } else if (bListContainer && bPriorityView) {
            // Ensure hidden flag sync even if view already exists
            bPriorityView.container.hidden = false;
          }
          if (bAccordionContainer && !bAccordionView) {
            bAccordionView = createBProviderAccordionView(bAccordionContainer);
            // The accordion's inputs were just created empty — populate them.
            loadSettingsToInputs(bAccordionContainer, settings, GENERAL_SETTINGS_SCHEMA);
          }
        } else {
          bPriorityView?.container?.querySelectorAll('.b-priority-warn, .b-priority-req-warn').forEach((el) => el.remove());
          bAccordionView?.destroy();
          bPriorityView = null;
          bAccordionView = null;
          // Rebuild the A mount (empty in B) and reload its values.
          rebuildProviderSettingsMount();
          loadSettingsToInputs(container, settings, GENERAL_SETTINGS_SCHEMA);
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
        const syncBackdrop = () => {
          const backdropNow = document.getElementById('wizardBackdrop');
          const wizardNow = document.getElementById('onboardingWizard');
          if (backdropNow) backdropNow.style.display = wizardNow?.classList.contains('hidden') ? 'none' : 'block';
        };
        const observeWizard = () => {
          const wizardEl = document.getElementById('onboardingWizard');
          const backdropEl = document.getElementById('wizardBackdrop');
          if (wizardEl && backdropEl) {
            const obs = new MutationObserver(syncBackdrop);
            obs.observe(wizardEl, { attributes: true, attributeFilter: ['class'] });
          }
        };
        const reopenWizard = () => {
          const wizard = document.getElementById('onboardingWizard');
          if (wizard) {
            delete wizard.dataset.initialized;
          }
          initOnboardingWizard(true);
          observeWizard();
          syncBackdrop();
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
              const settings2 = await settingsRepository.getAll();
              settings2[StorageKeys.PROVIDER_TYPE] = providerId;
              settings2[StorageKeys.PROVIDER_BASE_URL] = baseUrl;
              settings2[StorageKeys.PROVIDER_API_KEY] = apiKey;
              settings2[StorageKeys.PROVIDER_MODEL] = model;
              await (async (s)=>{ await settingsRepository.setAll(s); await updateDomainFilterCache(await settingsRepository.getAll()); })(settings2);
            },
            onCancel: () => {}
          });
        }
        await modelsDevDialog.show();
      });

      container.querySelector('#lmStudioPresetBtn')?.addEventListener('click', () => {
        const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement | null;
        const statusDiv = document.getElementById('status') as HTMLElement | null;
        if (providerBaseUrlInput) providerBaseUrlInput.value = 'http://localhost:1234/v1';
        if (statusDiv) {
          statusDiv.textContent = getMessage('lmStudioPresetApplied') || 'LM Studio preset applied (http://localhost:1234/v1)';
          statusDiv.className = 'status-success';
          syncStatusToTop();
        }
      });

      container.querySelector('#ollamaPresetBtn')?.addEventListener('click', () => {
        const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement | null;
        const statusDiv = document.getElementById('status') as HTMLElement | null;
        if (providerBaseUrlInput) providerBaseUrlInput.value = 'http://localhost:11434/v1';
        if (statusDiv) {
          statusDiv.textContent = getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)';
          statusDiv.className = 'status-success';
          syncStatusToTop();
        }
      });

      document.getElementById('save')?.addEventListener('click', handleSaveOnly);
      document.getElementById('testObsidianBtn')?.addEventListener('click', handleTestObsidian);
      document.getElementById('testAiBtn')?.addEventListener('click', handleTestAi);
      container.querySelector('#testLocalMarkdownBtnBottom')?.addEventListener('click', () => handleTestLocalMarkdown());
      document.getElementById('purgeNowBtn')?.addEventListener('click', handlePurgeNow);
      document.getElementById('contentPurgeNowBtn')?.addEventListener('click', handleContentPurgeNow);
    },
    async refresh() {
      const container = panelContainer;
      if (container) {
        const settings = await settingsRepository.getAll();
        loadSettingsToInputs(container, settings, GENERAL_SETTINGS_SCHEMA);
        await loadGeneralSettings();
      }
    },
  };
}
