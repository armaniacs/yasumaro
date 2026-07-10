// @vitest-environment jsdom
/**
 * consentBadge.test.ts
 * Tests for the toolbar badge indicator that reflects privacy consent state (M3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockHasPrivacyConsent = vi.hoisted(() => vi.fn());
const mockSetBadgeText = vi.hoisted(() => vi.fn());
const mockSetBadgeBackgroundColor = vi.hoisted(() => vi.fn());

vi.mock('../../popup/privacyConsent.js', () => ({
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

  it('未同意の場合、グローバルバッジに警告表示を設定する', async () => {
    mockHasPrivacyConsent.mockResolvedValue(false);

    await updateConsentBadge();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(
      expect.objectContaining({ color: expect.any(String) })
    );
  });

  it('同意済みの場合、グローバルバッジをクリアする', async () => {
    mockHasPrivacyConsent.mockResolvedValue(true);

    await updateConsentBadge();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('tabIdを指定しない（グローバルバッジのため、個別タブの一時バッジと競合しない）', async () => {
    mockHasPrivacyConsent.mockResolvedValue(false);

    await updateConsentBadge();

    const call = mockSetBadgeText.mock.calls[0][0];
    expect(call).not.toHaveProperty('tabId');
  });

  it('hasPrivacyConsentが例外を投げても呼び出し元に伝播しない', async () => {
    mockHasPrivacyConsent.mockRejectedValue(new Error('storage error'));

    await expect(updateConsentBadge()).resolves.toBeUndefined();
  });
});
