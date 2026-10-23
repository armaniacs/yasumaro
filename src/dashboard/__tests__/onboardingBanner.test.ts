/**
 * onboardingBanner.test.ts
 * PBI 2026-10-22-02 ― 初見軽量化 (onboarding light).
 * Pins: the banner shows once until dismissed (shouldShowOnboardingBanner),
 * and the zero-config record path keeps title/url + derives the domain from
 * the URL (acceptance: 要約なし記録でも基本列が欠落しない).
 */
import { describe, it, expect } from 'vitest';
import { shouldShowOnboardingBanner } from '../onboardingBanner.js';
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
