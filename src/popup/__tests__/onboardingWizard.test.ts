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
});
