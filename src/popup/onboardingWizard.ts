import { getSettings, saveSettings } from '../utils/storage.js';
import { StorageKeys } from '../utils/storage/types.js';

export type WizardType = 'obsidian' | 'sqlite' | 'minimal';

export async function shouldShowWizard(): Promise<boolean> {
  const settings = await getSettings();
  return !settings[StorageKeys.ONBOARDING_WIZARD_COMPLETED];
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
