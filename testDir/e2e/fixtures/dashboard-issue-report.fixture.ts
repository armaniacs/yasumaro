/**
 * Fixture for dashboard-issue-report.spec.ts (PBI 2026-09-13-51).
 *
 * Extends the unified launch context with:
 * - a Gemini API key seeded into storage (so the sanitization contract has
 *   something real to exclude)
 * - a chrome.tabs.create stub that records the URL instead of opening a tab
 */
import { expect } from '@playwright/test';
import { createDashboardFixture } from './dashboard-shared.fixture.js';

export const SEEDED_API_KEY = 'test-secret-key-should-never-leak';

function issueReportInit(): void {
  (window as any).__createdTabUrls = [];

  chrome.tabs.create = ((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
    (window as any).__createdTabUrls.push(createProperties?.url);
    const fakeTab = { id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab;
    if (callback) callback(fakeTab);
    return Promise.resolve(fakeTab);
  }) as typeof chrome.tabs.create;
}

export const test = createDashboardFixture({
  // priorityList 'empty' + apiKey: the sanitization contract needs the
  // provider panel for the keyed provider visible under a user-configured
  // (explicitly empty) priority list — see ProviderPriorityListSeed.
  seedPolicy: {
    consent: true,
    settingsMigrated: true,
    breakingChangesShown: true,
    provider: {
      name: 'gemini',
      layout: 'a',
      priorityList: 'empty',
      apiKey: SEEDED_API_KEY,
    },
  },
  initScript: { script: issueReportInit },
});

export { expect };
