import { type StaticFormPanel } from '../types.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../../../utils/storage.js';
import { getMessage } from '../../../utils/i18n.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import {
  loadGeneralSettings,
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
      const updatePrioritySummaryNames = (selected: string[]): void => {
        const selects = ['aiProvider', 'aiProviderPriority2', 'aiProviderPriority3'];
        selects.forEach((id, index) => {
          const select = document.getElementById(id) as HTMLSelectElement | null;
          const summaryName = document.querySelector(`.priority-provider-name[data-priority="${index + 1}"]`) as HTMLElement | null;
          if (select && summaryName) {
            const option = select.options[select.selectedIndex];
            summaryName.textContent = option.value ? `— ${option.text}` : '';
          }
        });
      };

      document.getElementById('aiProvider')?.addEventListener('change', refreshMultiVisibility);
      document.getElementById('aiProviderPriority2')?.addEventListener('change', refreshMultiVisibility);
      document.getElementById('aiProviderPriority3')?.addEventListener('change', refreshMultiVisibility);
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

      setupAllFieldValidations(
        document.getElementById('protocol') as HTMLInputElement | null,
        document.getElementById('port') as HTMLInputElement | null,
      );

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
      container.querySelector('#testLocalMarkdownBtnBottom')?.addEventListener('click', handleTestLocalMarkdown);
      document.getElementById('purgeNowBtn')?.addEventListener('click', handlePurgeNow);
      document.getElementById('contentPurgeNowBtn')?.addEventListener('click', handleContentPurgeNow);
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
