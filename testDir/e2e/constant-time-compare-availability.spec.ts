import { test, expect } from './fixtures/extension.fixture.js';

/**
 * PBI-11: Verify that crypto.subtle.timingSafeEqual is available in the
 * extension's Service Worker runtime.
 *
 * If this API is available, the manual fallback path in
 * src/utils/crypto/index.ts is never executed in production, which makes the
 * micro-benchmarking of that fallback path unnecessary for supported Chrome
 * versions.
 *
 * This test requires headed Chrome and is tagged @extension so it runs in the
 * dedicated extension project (and is skipped in headless/CI environments).
 */
test.describe('constantTimeCompare runtime availability @extension', () => {
  test('records crypto.subtle.timingSafeEqual availability in the Service Worker', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw, 'Service Worker should be running').toBeTruthy();

    const availability = await sw!.evaluate(() => {
      const hasCrypto = typeof crypto !== 'undefined';
      const hasSubtle = hasCrypto && 'subtle' in crypto;
      const timingSafeEqualType = hasSubtle ? typeof crypto.subtle.timingSafeEqual : 'n/a';
      const hasTimingSafeEqual = timingSafeEqualType === 'function';
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

      return {
        hasCrypto,
        hasSubtle,
        timingSafeEqualType,
        hasTimingSafeEqual,
        userAgent,
      };
    });

    // eslint-disable-next-line no-console
    console.log('Service Worker crypto availability:', availability);

    expect(availability.hasCrypto, 'crypto object should be present').toBe(true);
    expect(availability.hasSubtle, 'crypto.subtle should be present').toBe(true);

    if (!availability.hasTimingSafeEqual) {
      // eslint-disable-next-line no-console
      console.warn(
        'WARNING: crypto.subtle.timingSafeEqual is NOT available in this Service Worker runtime. '
          + 'The manual fallback path in constantTimeCompare() will be executed.'
      );
    }
  });
});
