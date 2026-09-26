import { expect, type BrowserContext } from '@playwright/test';

// The background gate compares against PRIVACY_POLICY_VERSION in
// src/utils/storage/privacyConsent.ts. That module cannot be imported here
// because it pulls in Chrome-only dependencies, so this E2E copy must be bumped
// by hand; keeping it in this file makes that a single edit.
export const PRIVACY_POLICY_VERSION = '2026-09-08';

export async function seedPrivacyConsent(
  context: BrowserContext,
  extra?: Record<string, unknown>,
): Promise<void> {
  const sw = context.serviceWorkers()[0];
  expect(sw, 'service worker must be running').toBeTruthy();
  await sw!.evaluate(async ({ version, extra }) => {
    await chrome.storage.local.set({
      ...extra,
      privacy_consent: { hasConsented: true, consentVersion: version, consentDate: Date.now() },
      privacy_consent_version: version,
      settings_migrated: true,
    });
  }, { version: PRIVACY_POLICY_VERSION, extra: extra ?? {} });
}
