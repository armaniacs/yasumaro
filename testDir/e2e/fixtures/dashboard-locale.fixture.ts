/**
 * Fixture for i18n-layout.spec.ts (PBI 2026-09-13-50).
 *
 * chrome.i18n.getMessage() resolves against the browser's UI locale, which
 * for a Chromium extension test can only be set at context launch time
 * (Playwright's `locale` context option + --lang), not toggled at runtime
 * via JS. This fixture is parameterized per-test via test.use({ locale }).
 */
import { expect, type Page } from '@playwright/test';
import { createDashboardFixture } from './dashboard-shared.fixture.js';

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    settingsMigrated: true,
    breakingChangesShown: true,
    // This spec is about layout/locale rendering, not the provider
    // synthesis path: an explicitly empty (user-configured) list keeps
    // every provider panel hidden, which is what the pre-unification
    // seed did — see ProviderPriorityListSeed.
    provider: { name: 'gemini', layout: 'a', priorityList: 'empty' },
  },
});

export { expect };
export type { Page };
