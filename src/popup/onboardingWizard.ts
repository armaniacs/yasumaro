import { getSettings, saveSettings } from '../utils/storage.js';
import { StorageKeys } from '../utils/storage/types.js';
import { focusTrapManager } from './utils/focusTrap.js';
import { logError, ErrorCode } from '../utils/logger.js';

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

let wizardTrapId: string | null = null;

export function initOnboardingWizard(): void {
  const wizard = document.getElementById('onboardingWizard');
  if (!wizard) return;

  if (wizard.dataset.initialized === 'true') return;
  wizard.dataset.initialized = 'true';

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
      await skipWizard(wizard);
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

async function showStep(wizard: HTMLElement, stepName: string): Promise<void> {
  wizard.querySelectorAll('.wizard-step').forEach(step => {
    step.classList.toggle('hidden', step.getAttribute('data-step') !== stepName);
  });

  const titleEl = document.getElementById('wizardTitle');
  if (titleEl) {
    const { getMessage } = await import('./i18n.js');
    const titleMap: Record<string, string> = {
      type: getMessage('wizardTitle') || 'Welcome to Yasumaro',
      obsidian: getMessage('wizardObsidianTitle') || 'Connect Obsidian',
      sqlite: getMessage('wizardSqliteTitle') || 'Set up AI Provider',
      minimal: getMessage('wizardMinimalTitle') || "You're ready",
    };
    titleEl.textContent = titleMap[stepName] ?? titleMap.type;
  }

  // ステップ切り替え時もフォーカストラップを現在の表示要素に合わせて更新
  if (wizardTrapId) {
    focusTrapManager.release(wizardTrapId);
    wizardTrapId = null;
  }
  wizardTrapId = focusTrapManager.trap(wizard, () => void skipWizard(wizard));
}

function closeWizard(wizard: HTMLElement): void {
  wizard.classList.add('hidden');

  if (wizardTrapId) {
    focusTrapManager.release(wizardTrapId);
    wizardTrapId = null;
  }
}

async function skipWizard(wizard: HTMLElement): Promise<void> {
  await completeWizard('minimal');
  closeWizard(wizard);
}

function openDashboardSection(type: WizardType): void {
  const sectionMap: Record<WizardType, string> = {
    obsidian: 'obsidian',
    sqlite: 'ai-provider',
    minimal: 'general',
  };
  const dashboardUrl = chrome.runtime.getURL('options.html');
  const url = `${dashboardUrl}?section=${sectionMap[type]}`;

  (async () => {
    try {
      await chrome.tabs.create({ url });
    } catch (error) {
      logError('[OnboardingWizard] Failed to open dashboard', { cause: error, url }, ErrorCode.API_REQUEST_FAILURE);
    }
  })();
}
