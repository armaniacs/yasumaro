// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldShowWizard, completeWizard, initOnboardingWizard } from '../onboardingWizard.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { focusTrapManager } from '../../utils/ui/focusTrap.js';

const mockStorage = new Map<string, unknown>();

vi.mock('../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(async () => Object.fromEntries(mockStorage)),
    saveSettings: vi.fn(async (settings) => {
      Object.entries(settings).forEach(([key, value]) => mockStorage.set(key, value));
    }),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: vi.fn(async () => Object.fromEntries(mockStorage)),
      setAll: vi.fn(async (settings: Record<string, unknown>) => {
        Object.entries(settings).forEach(([k, v]) => mockStorage.set(k, v));
      }),
      getMany: vi.fn(async () => Object.fromEntries(mockStorage)),
      clearCache: vi.fn(),
    },
    SettingsRepository: class {
      getAll = vi.fn(async () => Object.fromEntries(mockStorage));
      setAll = vi.fn(async (settings: Record<string, unknown>) => { Object.entries(settings).forEach(([k, v]) => mockStorage.set(k, v)); });
      getMany = vi.fn(async () => Object.fromEntries(mockStorage));
      clearCache = vi.fn();
    },
  };
});

function setupChromeMocks(): void {
  const chromeAny = chrome as unknown as Record<string, unknown>;
  chromeAny.i18n = { getMessage: vi.fn((key: string) => key) };
  chromeAny.runtime = {
    ...(chromeAny.runtime || {}),
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
  };
  chromeAny.tabs = {
    ...(chromeAny.tabs || {}),
    create: vi.fn().mockResolvedValue({ id: 1 } as chrome.tabs.Tab),
  };
}

describe('onboardingWizard', () => {
  beforeEach(() => {
    mockStorage.clear();
    document.body.innerHTML = `
      <div id="onboardingWizard" class="wizard hidden" role="dialog" aria-modal="true" aria-labelledby="wizardTitle">
        <h2 id="wizardTitle" class="wizard-title">Welcome to Yasumaro</h2>
        <div class="wizard-step" data-step="type">
          <p>How do you plan to use Yasumaro?</p>
          <div class="wizard-options">
            <button class="wizard-option" data-type="obsidian">Obsidian user</button>
            <button class="wizard-option" data-type="sqlite">SQLite (no Obsidian)</button>
            <button class="wizard-option" data-type="minimal">Just trying it out</button>
          </div>
        </div>
        <div class="wizard-step hidden" data-step="obsidian">
          <p>Set your Local REST API key and daily notes path.</p>
          <button class="wizard-skip">Skip</button>
          <button class="wizard-next">Open Dashboard</button>
        </div>
        <div class="wizard-step hidden" data-step="sqlite">
          <p>Choose an AI provider for summaries.</p>
          <button class="wizard-skip">Skip</button>
          <button class="wizard-next">Open Dashboard</button>
        </div>
      </div>
    `;
    vi.clearAllMocks();
    setupChromeMocks();
  });

  it('should show wizard when not completed', async () => {
    const result = await shouldShowWizard();
    expect(result).toBe(true);
  });

  it('wizard template explains the recording scope and consent withdrawal', () => {
    // テンプレート実体を検証するため、既存 DOM を作らず ensureWizardDOM 経由で生成する。
    // 表示文言は i18n（applyI18n が data-i18n キーを解決）に依存するため、
    // ここではキー紐付けと配置（type ステップ内）を検証する。
    document.body.innerHTML = '';
    initOnboardingWizard(true);

    const scopeNote = document.querySelector('[data-i18n="wizardRecordingScope"]');
    expect(scopeNote).not.toBeNull();
    expect(scopeNote?.getAttribute('data-i18n')).toBe('wizardRecordingScope');
    const typeStep = document.querySelector('.wizard-step[data-step="type"]');
    expect(typeStep?.contains(scopeNote ?? null)).toBe(true);
  });

  it('should not show wizard when completed', async () => {
    mockStorage.set(StorageKeys.ONBOARDING_WIZARD_COMPLETED, true);
    const result = await shouldShowWizard();
    expect(result).toBe(false);
  });

  it('should save completion and type', async () => {
    await completeWizard('obsidian');
    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_COMPLETED)).toBe(true);
    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_TYPE)).toBe('obsidian');
  });

  it('transitions to the obsidian step when the obsidian option is clicked', () => {
    initOnboardingWizard();
    const obsidianBtn = document.querySelector('[data-type="obsidian"]') as HTMLButtonElement;
    obsidianBtn.click();
    expect(document.querySelector('[data-step="obsidian"]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-step="type"]')?.classList.contains('hidden')).toBe(true);
  });

  it('transitions to the sqlite step when the sqlite option is clicked', () => {
    initOnboardingWizard();
    const sqliteBtn = document.querySelector('[data-type="sqlite"]') as HTMLButtonElement;
    sqliteBtn.click();
    expect(document.querySelector('[data-step="sqlite"]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-step="type"]')?.classList.contains('hidden')).toBe(true);
  });

  it('closes the wizard when the minimal option is clicked', async () => {
    initOnboardingWizard();
    const minimalBtn = document.querySelector('[data-type="minimal"]') as HTMLButtonElement;
    minimalBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('onboardingWizard')?.classList.contains('hidden')).toBe(true);
    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_COMPLETED)).toBe(true);
    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_TYPE)).toBe('minimal');
  });

  it('activates focus trap on init and re-traps after step transition', async () => {
    const trapSpy = vi.spyOn(focusTrapManager, 'trap');
    initOnboardingWizard();
    await vi.waitFor(() => expect(trapSpy).toHaveBeenCalled());
    const callsAfterInit = trapSpy.mock.calls.length;

    const obsidianBtn = document.querySelector('[data-type="obsidian"]') as HTMLButtonElement;
    obsidianBtn.click();
    await vi.waitFor(() => expect(trapSpy.mock.calls.length).toBeGreaterThan(callsAfterInit));

    trapSpy.mockRestore();
  });

  it('opens the dashboard with the obsidian section when finishing the obsidian step', async () => {
    initOnboardingWizard();
    (document.querySelector('[data-type="obsidian"]') as HTMLButtonElement).click();
    (document.querySelector('[data-step="obsidian"] .wizard-next') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('?section=obsidian') })
    );
  });

  it('opens the dashboard with the ai-provider section when finishing the sqlite step', async () => {
    initOnboardingWizard();
    (document.querySelector('[data-type="sqlite"]') as HTMLButtonElement).click();
    (document.querySelector('[data-step="sqlite"] .wizard-next') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('?section=ai-provider') })
    );
  });

  it('creates wizard DOM and backdrop when neither exists', () => {
    document.body.innerHTML = '';
    initOnboardingWizard();

    const wizard = document.getElementById('onboardingWizard');
    expect(wizard).not.toBeNull();
    expect(wizard?.getAttribute('role')).toBe('dialog');
    expect(wizard?.getAttribute('aria-modal')).toBe('true');
    expect(wizard?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('wizardBackdrop')).not.toBeNull();
    // Created wizard contains all four steps including the minimal finish step
    expect(wizard?.querySelectorAll('.wizard-step')).toHaveLength(4);
  });

  it('reuses an existing backdrop when creating the wizard DOM', () => {
    document.body.innerHTML = '<div id="wizardBackdrop"></div>';
    initOnboardingWizard();

    expect(document.querySelectorAll('#wizardBackdrop')).toHaveLength(1);
    expect(document.getElementById('onboardingWizard')).not.toBeNull();
  });

  it('skips listener setup when the wizard is already initialized', () => {
    initOnboardingWizard();
    const trapSpy = vi.spyOn(focusTrapManager, 'trap');
    initOnboardingWizard();
    // Second init returns early without re-arming the focus trap
    expect(trapSpy).not.toHaveBeenCalled();
    trapSpy.mockRestore();
  });

  it('rebinds listeners when re-initialized after the initialized flag is cleared', async () => {
    initOnboardingWizard();
    const wizard = document.getElementById('onboardingWizard') as HTMLElement;
    wizard.dataset.initialized = '';
    initOnboardingWizard();

    const obsidianBtn = document.querySelector('[data-type="obsidian"]') as HTMLButtonElement;
    obsidianBtn.click();
    expect(document.querySelector('[data-step="obsidian"]')?.classList.contains('hidden')).toBe(false);
  });

  it('falls back to the minimal type when finishing with no visible step', async () => {
    initOnboardingWizard();
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.add('hidden'));
    (document.querySelector('[data-step="obsidian"] .wizard-next') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_TYPE)).toBe('minimal');
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('?section=general') })
    );
  });

  it('does not navigate to the dashboard when skipNavigation is true', async () => {
    initOnboardingWizard(true);
    (document.querySelector('[data-type="obsidian"]') as HTMLButtonElement).click();
    (document.querySelector('[data-step="obsidian"] .wizard-next') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockStorage.get(StorageKeys.ONBOARDING_WIZARD_COMPLETED)).toBe(true);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('falls back to the type step title for an unknown step name', () => {
    const customBtn = document.createElement('button');
    customBtn.className = 'wizard-option';
    customBtn.setAttribute('data-type', 'custom');
    document.querySelector('.wizard-options')?.appendChild(customBtn);

    initOnboardingWizard();
    customBtn.click();

    // titleMap['custom'] is undefined → falls back to titleMap['type']
    expect(document.getElementById('wizardTitle')?.textContent).toBe('wizardTitle');
  });

  it('uses hardcoded fallback titles when i18n messages are unavailable', () => {
    (chrome as unknown as Record<string, unknown>).i18n = {
      getMessage: vi.fn(() => ''),
    };
    initOnboardingWizard();

    expect(document.getElementById('wizardTitle')?.textContent).toBe('Welcome to Yasumaro');
  });
});
