// @vitest-environment jsdom
/**
 * consentBadge.test.ts
 * Tests for the toolbar badge indicator that reflects privacy consent state (M3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockHasPrivacyConsent = vi.hoisted(() => vi.fn());
const mockSetBadgeText = vi.hoisted(() => vi.fn());
const mockSetBadgeBackgroundColor = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/privacyConsent.js', () => ({
  hasPrivacyConsent: mockHasPrivacyConsent,
}));

vi.stubGlobal('chrome', {
  action: {
    setBadgeText: mockSetBadgeText,
    setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
  },
});

import { updateConsentBadge } from '../consentBadge.js';

describe('updateConsentBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a warning on the global badge when consent is missing', async () => {
    mockHasPrivacyConsent.mockResolvedValue(false);

    await updateConsentBadge();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(
      expect.objectContaining({ color: expect.any(String) })
    );
  });

  it('clears the global badge when consent is given', async () => {
    mockHasPrivacyConsent.mockResolvedValue(true);

    await updateConsentBadge();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('omits tabId (uses the global badge to avoid clashing with per-tab badges)', async () => {
    mockHasPrivacyConsent.mockResolvedValue(false);

    await updateConsentBadge();

    const call = mockSetBadgeText.mock.calls[0]![0];
    expect(call).not.toHaveProperty('tabId');
  });

  it('does not propagate even when hasPrivacyConsent throws', async () => {
    mockHasPrivacyConsent.mockRejectedValue(new Error('storage error'));

    await expect(updateConsentBadge()).resolves.toBeUndefined();
  });
});
