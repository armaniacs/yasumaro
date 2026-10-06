import { expect } from '@playwright/test';
import { createPopupFixture } from './popup-shared.fixture.js';

/**
 * PBI-27 用のポップアップフィクスチャ。
 * ポップアップを chrome-extension:// URL で開き、chrome.tabs.create と
 * window.close の呼び出しを window グローバルに記録する。
 * 起動骨格 (context / extensionId / pages()[0] / goto / dismiss) は
 * createPopupFixture に集約し、差分だけを initScript で差し込む。
 * tabs.query スタブは tabStub: 'example' で明示する。
 */
function pbi27InteractionInit(): void {
  (window as any).__createdTabUrls = [];
  (window as any).__closeCalled = false;

  // Not this spec's concern — the onboarding wizard now launches
  // reactively right after the user accepts consent in the same
  // session (PBI 0913a popup.ts fix), which would otherwise cover
  // #menuBtn here. Mark onboarding done so this fixture's UI-driven
  // consent acceptance below doesn't trigger it (seeded at launch via
  // the seed policy).
  window.close = () => {
    (window as any).__closeCalled = true;
  };

  chrome.tabs.create = (createProperties: any, callback?: (tab: chrome.tabs.Tab) => void) => {
    (window as any).__createdTabUrls.push(createProperties?.url);
    if (callback) {
      callback({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
    }
    return Promise.resolve({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
  };
}

export const test = createPopupFixture({
  seedPolicy: {
    consent: true,
    settingsMigrated: true,
    onboardingCompleted: true,
  },
  tabStub: 'example',
  initScript: { script: pbi27InteractionInit },
});

export { expect };
