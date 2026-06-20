// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldShowWizard, completeWizard, initOnboardingWizard } from '../onboardingWizard.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { focusTrapManager } from '../utils/focusTrap.js';

const mockStorage = new Map<string, unknown>();

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(async () => Object.fromEntries(mockStorage)),
  saveSettings: vi.fn(async (settings) => {
    Object.entries(settings).forEach(([key, value]) => mockStorage.set(key, value));
  }),
}));

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
});
