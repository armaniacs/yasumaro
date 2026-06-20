import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldShowWizard, completeWizard, getWizardTypeLabel } from '../onboardingWizard.js';

const mockStorage = new Map<string, unknown>();

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(async () => Object.fromEntries(mockStorage)),
  saveSettings: vi.fn(async (settings) => {
    Object.entries(settings).forEach(([key, value]) => mockStorage.set(key, value));
  }),
}));

describe('onboardingWizard', () => {
  beforeEach(() => mockStorage.clear());

  it('should show wizard when not completed', async () => {
    const result = await shouldShowWizard();
    expect(result).toBe(true);
  });

  it('should not show wizard when completed', async () => {
    mockStorage.set('onboarding_wizard_completed', true);
    const result = await shouldShowWizard();
    expect(result).toBe(false);
  });

  it('should save completion and type', async () => {
    await completeWizard('obsidian');
    expect(mockStorage.get('onboarding_wizard_completed')).toBe(true);
    expect(mockStorage.get('onboarding_wizard_type')).toBe('obsidian');
  });

  it('returns localized label for each wizard type', () => {
    const originalGetMessage = chrome.i18n.getMessage;
    (chrome.i18n.getMessage as vi.Mock).mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        wizardTypeObsidian: 'Obsidian user',
        wizardTypeSqlite: 'SQLite (no Obsidian)',
        wizardTypeMinimal: 'Just trying it out',
      };
      return messages[key] || key;
    });

    const obsidianLabel = getWizardTypeLabel('obsidian');
    const sqliteLabel = getWizardTypeLabel('sqlite');
    const minimalLabel = getWizardTypeLabel('minimal');

    expect(typeof obsidianLabel).toBe('string');
    expect(obsidianLabel.length).toBeGreaterThan(0);
    expect(typeof sqliteLabel).toBe('string');
    expect(sqliteLabel.length).toBeGreaterThan(0);
    expect(typeof minimalLabel).toBe('string');
    expect(minimalLabel.length).toBeGreaterThan(0);

    expect(obsidianLabel).toBe('Obsidian user');
    expect(sqliteLabel).toBe('SQLite (no Obsidian)');
    expect(minimalLabel).toBe('Just trying it out');

    chrome.i18n.getMessage = originalGetMessage;
  });
});
