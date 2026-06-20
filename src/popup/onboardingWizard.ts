import { getSettings, saveSettings } from '../utils/storage.js';
import { StorageKeys } from '../utils/storage/types.js';

export type WizardType = 'obsidian' | 'sqlite' | 'minimal';

export async function shouldShowWizard(): Promise<boolean> {
  const settings = await getSettings();
  return !settings[StorageKeys.ONBOARDING_WIZARD_COMPLETED];
}

export async function hasCompletedWizard(): Promise<boolean> {
  const settings = await getSettings();
  return !!settings[StorageKeys.ONBOARDING_WIZARD_COMPLETED];
}

export async function completeWizard(type: WizardType): Promise<void> {
  await saveSettings({
    [StorageKeys.ONBOARDING_WIZARD_COMPLETED]: true,
    [StorageKeys.ONBOARDING_WIZARD_TYPE]: type,
  });
}

export function getWizardTypeLabel(type: WizardType): string {
  const labels: Record<WizardType, string> = {
    obsidian: chrome.i18n.getMessage('wizardTypeObsidian') || 'Obsidian user',
    sqlite: chrome.i18n.getMessage('wizardTypeSqlite') || 'SQLite (no Obsidian)',
    minimal: chrome.i18n.getMessage('wizardTypeMinimal') || 'Just trying it out',
  };
  return labels[type];
}

export function initOnboardingWizard(): void {
  const wizard = document.getElementById('onboardingWizard');
  if (!wizard) return;

  wizard.classList.remove('hidden');
  showStep(wizard, 'type');

  wizard.querySelectorAll('.wizard-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-type') as WizardType;
      if (type === 'minimal') {
        await completeWizard('minimal');
        closeWizard(wizard);
        return;
      }
      showStep(wizard, type);
    });
  });

  wizard.querySelectorAll('.wizard-skip').forEach(btn => {
    btn.addEventListener('click', async () => {
      await completeWizard('minimal');
      closeWizard(wizard);
    });
  });

  wizard.querySelectorAll('.wizard-next, .wizard-finish').forEach(btn => {
    btn.addEventListener('click', async () => {
      const step = wizard.querySelector('.wizard-step:not(.hidden)');
      const type = step?.getAttribute('data-step') as WizardType || 'minimal';
      await completeWizard(type);
      closeWizard(wizard);
      openDashboardSection(type);
    });
  });
}

function showStep(wizard: HTMLElement, stepName: string): void {
  wizard.querySelectorAll('.wizard-step').forEach(step => {
    step.classList.toggle('hidden', step.getAttribute('data-step') !== stepName);
  });
}

function closeWizard(wizard: HTMLElement): void {
  wizard.classList.add('hidden');
}

function openDashboardSection(type: WizardType): void {
  const sectionMap: Record<WizardType, string> = {
    obsidian: 'obsidian',
    sqlite: 'ai-provider',
    minimal: 'general',
  };
  const dashboardUrl = chrome.runtime.getURL('options.html');
  chrome.tabs.create({ url: `${dashboardUrl}?section=${sectionMap[type]}` });
}
