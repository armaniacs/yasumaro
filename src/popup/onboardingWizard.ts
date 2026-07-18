import { getSettings, saveSettings } from '../utils/storage.js';
import { StorageKeys } from '../utils/storage/types.js';
import { focusTrapManager } from './utils/focusTrap.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { applyI18n, getMessage } from '../utils/i18n.js';

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

let wizardAbortController: AbortController | null = null;

/**
 * Create the wizard DOM if it doesn't already exist in the page.
 * This centralizes the HTML template so both popup and dashboard
 * entrypoints share the same source of truth.
 */
function ensureWizardDOM(): HTMLElement {
  let wizard = document.getElementById('onboardingWizard');
  if (wizard) return wizard;

  // Create the backdrop (dashboard overlay)
  if (!document.getElementById('wizardBackdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'wizardBackdrop';
    backdrop.className = 'wizard-backdrop';
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);
  }

  // Create wizard container
  wizard = document.createElement('div');
  wizard.id = 'onboardingWizard';
  wizard.className = 'wizard hidden';
  wizard.setAttribute('role', 'dialog');
  wizard.setAttribute('aria-modal', 'true');
  wizard.setAttribute('aria-labelledby', 'wizardTitle');

  wizard.innerHTML = `
    <h2 id="wizardTitle" class="wizard-title" data-i18n="wizardTitle">Welcome to Yasumaro</h2>
    <div class="wizard-step" data-step="type">
      <p data-i18n="wizardTypePrompt">How do you plan to use Yasumaro?</p>
      <div class="wizard-options">
        <button class="wizard-option" data-type="obsidian" data-i18n="wizardTypeObsidian">Obsidian user</button>
        <button class="wizard-option" data-type="sqlite" data-i18n="wizardTypeSqlite">SQLite (no Obsidian)</button>
        <button class="wizard-option" data-type="minimal" data-i18n="wizardTypeMinimal">Just trying it out</button>
      </div>
    </div>
    <div class="wizard-step hidden" data-step="obsidian">
      <p data-i18n="wizardObsidianDescription">Set your Local REST API key and daily notes path.</p>
      <button class="wizard-skip" data-i18n="wizardSkip">Skip</button>
      <button class="wizard-next" data-i18n="wizardOpenDashboard">Open Dashboard</button>
    </div>
    <div class="wizard-step hidden" data-step="sqlite">
      <p data-i18n="wizardSqliteDescription">Choose an AI provider for summaries.</p>
      <button class="wizard-skip" data-i18n="wizardSkip">Skip</button>
      <button class="wizard-next" data-i18n="wizardOpenDashboard">Open Dashboard</button>
    </div>
    <div class="wizard-step hidden" data-step="minimal">
      <p data-i18n="wizardMinimalDescription">You can customize settings anytime from the dashboard.</p>
      <button class="wizard-finish" data-i18n="wizardFinish">Get started</button>
    </div>
  `;

  document.body.appendChild(wizard);
  return wizard;
}

export function initOnboardingWizard(skipNavigation = false): void {
  const wizard = ensureWizardDOM();

  if (wizard.dataset.initialized === 'true') return;
  wizard.dataset.initialized = 'true';

  // Abort previous listeners before rebinding (safe for reopen via delete dataset.initialized)
  wizardAbortController?.abort();
  wizardAbortController = new AbortController();
  const { signal } = wizardAbortController;

  wizard.classList.remove('hidden');
  showStep(wizard, 'type');

  // Apply i18n to wizard elements (especially when dynamically created)
  applyI18n(wizard);

  wizard.querySelectorAll('.wizard-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-type') as WizardType;
      if (type === 'minimal') {
        await completeWizard('minimal');
        closeWizard(wizard);
        return;
      }
      showStep(wizard, type);
    }, { signal });
  });

  wizard.querySelectorAll('.wizard-skip').forEach(btn => {
    btn.addEventListener('click', async () => {
      await skipWizard(wizard);
    }, { signal });
  });

  wizard.querySelectorAll('.wizard-next, .wizard-finish').forEach(btn => {
    btn.addEventListener('click', async () => {
      const step = wizard.querySelector('.wizard-step:not(.hidden)');
      const type = step?.getAttribute('data-step') as WizardType || 'minimal';
      await completeWizard(type);
      closeWizard(wizard);
      if (!skipNavigation) {
        openDashboardSection(type);
      }
    }, { signal });
  });
}

async function showStep(wizard: HTMLElement, stepName: string): Promise<void> {
  wizard.querySelectorAll('.wizard-step').forEach(step => {
    step.classList.toggle('hidden', step.getAttribute('data-step') !== stepName);
  });

  const titleEl = document.getElementById('wizardTitle');
  if (titleEl) {
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
