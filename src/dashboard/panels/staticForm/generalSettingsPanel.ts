import { type StaticFormPanel } from '../types.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../../../utils/storage.js';
import { getMessage } from '../../../popup/i18n.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import {
  loadGeneralSettings, getDashboardElements,
  handleSaveOnly, handleTestObsidian, handleTestAi, handleTestLocalMarkdown,
  handlePurgeNow, handleContentPurgeNow, handleManualLocalMarkdownExport,
  handleGenerateWeeklySummary, handleGenerateMonthlySummary,
  getAiProviderElements, syncStatusToTop,
} from '../../dashboard.js';
import { updateProviderSettingsLayout, hideAllProviderSettings } from '../../aiProviderLayoutManager.js';
import { setupAIProviderChangeListener, updateAIProviderVisibilityMulti } from '../../../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../../../popup/settings/fieldValidation.js';
import { initOnboardingWizard } from '../../../popup/onboardingWizard.js';
import { ModelsDevDialog } from '../../models-dev-dialog.js';

export function createGeneralSettingsPanel(): StaticFormPanel {
  let panelContainer: HTMLElement | null = null;
  return {
    id: 'panel-general',
    category: 'static-form',
    async mount(container) {
      panelContainer = container;
      const settings = await getSettings();
      loadSettingsToInputs(container, settings);
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
        const el = getDashboardElements();
        const selected = [
          el.aiProviderSelect?.value ?? '',
          el.aiProviderPriority2Select?.value ?? '',
          el.aiProviderPriority3Select?.value ?? ''
        ];
        updateAIProviderVisibilityMulti(getAiProviderElements(), selected);
        updateProviderSettingsLayout(selected);
      };

      const el = getDashboardElements();
      el.aiProviderSelect?.addEventListener('change', refreshMultiVisibility);
      el.aiProviderPriority2Select?.addEventListener('change', refreshMultiVisibility);
      el.aiProviderPriority3Select?.addEventListener('change', refreshMultiVisibility);
      hideAllProviderSettings();
      refreshMultiVisibility();

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

      const el2 = getDashboardElements();
      setupAllFieldValidations(el2.protocolInput, el2.portInput);

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
              const el3 = getDashboardElements();
              if (el3.providerApiKeyInput) el3.providerApiKeyInput.value = apiKey;
              if (el3.providerModelInput) el3.providerModelInput.value = model;
              const settings2 = await getSettings();
              settings2[StorageKeys.PROVIDER_TYPE] = providerId;
              settings2[StorageKeys.PROVIDER_BASE_URL] = baseUrl;
              settings2[StorageKeys.PROVIDER_API_KEY] = apiKey;
              settings2[StorageKeys.PROVIDER_MODEL] = model;
              await saveSettingsWithAllowedUrls(settings2);
            },
            onCancel: () => {}
          });
        }
        await modelsDevDialog.show();
      });

      container.querySelector('#lmStudioPresetBtn')?.addEventListener('click', () => {
        const el3 = getDashboardElements();
        if (el3.providerBaseUrlInput) el3.providerBaseUrlInput.value = 'http://localhost:1234/v1';
        if (el3.statusDiv) {
          el3.statusDiv.textContent = getMessage('lmStudioPresetApplied') || 'LM Studio preset applied (http://localhost:1234/v1)';
          el3.statusDiv.className = 'status-success';
          syncStatusToTop();
        }
      });

      container.querySelector('#ollamaPresetBtn')?.addEventListener('click', () => {
        const el3 = getDashboardElements();
        if (el3.providerBaseUrlInput) el3.providerBaseUrlInput.value = 'http://localhost:11434/v1';
        if (el3.statusDiv) {
          el3.statusDiv.textContent = getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)';
          el3.statusDiv.className = 'status-success';
          syncStatusToTop();
        }
      });

      {
        const el3 = getDashboardElements();
        el3.saveBtn?.addEventListener('click', handleSaveOnly);
        el3.testObsidianBtn?.addEventListener('click', handleTestObsidian);
        el3.testAiBtn?.addEventListener('click', handleTestAi);
        container.querySelector('#testLocalMarkdownBtnBottom')?.addEventListener('click', handleTestLocalMarkdown);
        el3.purgeNowBtn?.addEventListener('click', handlePurgeNow);
        el3.contentPurgeNowBtn?.addEventListener('click', handleContentPurgeNow);
      }
    },
    async refresh() {
      const container = panelContainer;
      if (container) {
        const settings = await getSettings();
        loadSettingsToInputs(container, settings);
        await loadGeneralSettings();
      }
    },
  };
}
