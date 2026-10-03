import { type PanelLifecycle } from '../types.js';
import { loadSettingsToInputs } from '../../../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { type Settings } from '../../../utils/storage/types.js';
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
import { setupAllFieldValidations, setupObsidianHostValidation, setupGeminiApiVersionValidation } from '../../settings/fieldValidation.js';
import { createAiProviderLayoutController } from './generalSettingsLayout.js';
import { mountWizardReopen } from './generalSettingsWizard.js';
import { mountModelsDevDialog } from './generalSettingsModelsDev.js';

const REVIEW_SUMMARY_BUTTONS: ReadonlyArray<{ btnId: string; periodType: 'weekly' | 'monthly' }> = [
  { btnId: 'generateWeeklySummaryBtn', periodType: 'weekly' },
  { btnId: 'generateMonthlySummaryBtn', periodType: 'monthly' },
];

/**
 * Review summary buttons live only on this panel, so their handlers do too.
 * A thin shell over generateReviewSummary, parameterized by period.
 */
async function handleGenerateReviewSummary(btnId: string, periodType: 'weekly' | 'monthly'): Promise<void> {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  const statusEl = document.getElementById('reviewSummaryStatus') as HTMLElement | null;
  await generateReviewSummary({ button: btn, statusElement: statusEl, periodType });
}

/**
 * The three show/hide follow-ups (obsidian details, local export, review
 * summary) share one change-listener shape: absent either element, no-op.
 */
function wireVisibilityToggle(
  input: HTMLInputElement | null,
  target: HTMLElement | null,
  apply: (target: HTMLElement, checked: boolean) => void,
): void {
  if (input && target) {
    input.addEventListener('change', () => apply(target, input.checked));
  }
}

const toggleHidden = (target: HTMLElement, checked: boolean): void => {
  target.classList.toggle('hidden', !checked);
};

export function createGeneralSettingsPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  let panelContainer: HTMLElement | null = null;
  // One mutable snapshot shared by mount() and refresh(). The layout toggle
  // reads it lazily, so a per-path local would leave it rebuilding the A/B
  // inputs from the values captured at mount time after any refresh or
  // external write.
  let currentSettings: Settings = {};
  // Shared by refresh() and the import/restore listener so both update the
  // same snapshot and the same inputs. mount() applies the snapshot through
  // the same core once the layout module has built the A mount, so the
  // mount path and the reload paths cannot drift.
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

      const layout = createAiProviderLayoutController({
        container,
        getSettings: () => currentSettings,
      });
      await layout.prepare();

      await reloadFromRepository();

      const obsidianEnabled = container.querySelector('#obsidianEnabled') as HTMLInputElement | null;
      const obsidianDetails = container.querySelector('#obsidianSettingsDetails') as HTMLDetailsElement | null;
      wireVisibilityToggle(obsidianEnabled, obsidianDetails, (target, checked) => {
        (target as HTMLDetailsElement).open = checked;
      });

      const localExportEnabled = container.querySelector('#localMarkdownExportEnabled') as HTMLInputElement | null;
      const localExportSettingsDiv = container.querySelector('#localMarkdownExportSettings') as HTMLElement | null;
      wireVisibilityToggle(localExportEnabled, localExportSettingsDiv, toggleHidden);

      const reviewSummaryEnabled = container.querySelector('#reviewSummaryEnabled') as HTMLInputElement | null;
      const reviewSummaryManualActions = container.querySelector('#reviewSummaryManualActions') as HTMLElement | null;
      wireVisibilityToggle(reviewSummaryEnabled, reviewSummaryManualActions, toggleHidden);

      for (const { btnId, periodType } of REVIEW_SUMMARY_BUTTONS) {
        container.querySelector(`#${btnId}`)?.addEventListener('click', () => handleGenerateReviewSummary(btnId, periodType));
      }

      layout.wire();

      mountWizardReopen(container);

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

      mountModelsDevDialog(container);

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
