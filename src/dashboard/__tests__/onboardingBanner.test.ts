// @vitest-environment jsdom
/**
 * onboardingBanner.test.ts
 * PBI 2026-10-22-02 ― 初見軽量化 (onboarding light).
 * Pins: the banner shows once until dismissed (shouldShowOnboardingBanner),
 * and the zero-config record path keeps title/url + derives the domain from
 * the URL (acceptance: 要約なし記録でも基本列が欠落しない).
 * PBI 2026-10-23-09 adds the injected store seam (save/read/corrupt through a
 * real SettingsRepository over an in-memory port).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../utils/crypto/__tests__/secretKekHelper.js';
import { logError } from '../../utils/logger/api.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { waitForMock } from '../../../testDir/waitPolicy.js';

vi.mock('../../utils/logger/api.js', () => ({ logError: vi.fn(() => Promise.resolve()) }));

import { shouldShowOnboardingBanner, initOnboardingBanner, type OnboardingBannerStore } from '../onboardingBanner.js';
import { buildOfflineRetryRequest, type OfflineJobPayload } from '../../background/recordRequestBuilder.js';
import { extractDomain } from '../../utils/domainUtils.js';

describe('shouldShowOnboardingBanner (初回起動の3択表示)', () => {
  it('shows the banner until the user dismisses it once', () => {
    expect(shouldShowOnboardingBanner(false)).toBe(true);
    expect(shouldShowOnboardingBanner(true)).toBe(false);
  });
});

describe('zero-config record keeps the basic columns (要約なし記録の基本列)', () => {
  it('keeps title/url on the request path when no summary was generated', () => {
    const payload: OfflineJobPayload = {
      title: 'Example',
      url: 'https://example.com/p1',
      content: 'body',
    };
    const record = buildOfflineRetryRequest(payload);
    expect(record.title).toBe('Example');
    expect(record.url).toBe('https://example.com/p1');
  });

  it('derives the domain column from the URL (no summary needed)', () => {
    expect(extractDomain('https://example.com/p1')).toBe('example.com');
  });
});

describe('initOnboardingBanner (injected store seam)', () => {
  let repo: OnboardingBannerStore;

  function mountBanner(): HTMLElement {
    document.body.innerHTML = `
      <div id="onboardingBanner" hidden>
        <p id="onboardingIntro"></p>
        <button type="button" data-onboarding-action="try-first">try</button>
        <button type="button" data-onboarding-action="obsidian">obsidian</button>
        <button type="button" data-onboarding-action="ai">ai</button>
        <button type="button" data-onboarding-action="dismiss">dismiss</button>
      </div>`;
    return document.getElementById('onboardingBanner') as HTMLElement;
  }

  function dismissButton(banner: HTMLElement): HTMLButtonElement {
    return banner.querySelector<HTMLButtonElement>('[data-onboarding-action="dismiss"]') as HTMLButtonElement;
  }

  beforeEach(async () => {
    await installTestSecretKek();
    const real = await vi.importActual<typeof import('../../utils/storage/SettingsRepository.js')>('../../utils/storage/SettingsRepository.js');
    repo = new real.SettingsRepository(new real.InMemoryStorageAdapter());
    vi.mocked(logError).mockClear();
    document.body.innerHTML = '';
  });

  describe('initOnboardingBanner', () => {
    it('shows the banner when the injected repository has no dismissal', async () => {
      const banner = mountBanner();

      await initOnboardingBanner(repo);

      expect(banner.hidden).toBe(false);
    });

    it('hides the banner when the injected repository reports dismissed', async () => {
      await repo.set(StorageKeys.ONBOARDING_DISMISSED, true);
      const banner = mountBanner();

      await initOnboardingBanner(repo);

      expect(banner.hidden).toBe(true);
    });

    it('shows the banner and logs STORAGE_READ_FAILURE when the injected read throws', async () => {
      const banner = mountBanner();
      vi.spyOn(repo, 'get').mockRejectedValueOnce(new Error('storage boom'));

      await initOnboardingBanner(repo);

      expect(banner.hidden).toBe(false);
      expect(logError).toHaveBeenCalledWith(
        '[Onboarding] read failed',
        { error: 'storage boom' },
        ErrorCode.STORAGE_READ_FAILURE,
        'onboardingBanner',
      );
    });

    it('persists the dismissal through the injected repository without blocking the screen', async () => {
      const banner = mountBanner();
      await initOnboardingBanner(repo);
      expect(banner.hidden).toBe(false);

      dismissButton(banner).click();

      await waitForMock(() => expect(banner.hidden).toBe(true));
      await expect(repo.get(StorageKeys.ONBOARDING_DISMISSED)).resolves.toBe(true);
    });

    it('still hides the banner for the launch when the injected write fails', async () => {
      const banner = mountBanner();
      await initOnboardingBanner(repo);
      vi.spyOn(repo, 'set').mockRejectedValueOnce(new Error('write boom'));

      dismissButton(banner).click();

      await waitForMock(() => expect(banner.hidden).toBe(true));
      expect(logError).toHaveBeenCalledWith(
        '[Onboarding] dismiss failed',
        { error: 'write boom' },
        ErrorCode.INTERNAL_ERROR,
        'onboardingBanner',
      );
    });
  });
});
