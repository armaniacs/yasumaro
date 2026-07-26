import { test, expect } from './fixtures/popup-pbi27.fixture.js';

/**
 * PBI-27: ポップアップから重複した settingsScreen UI を削除し、
 * 設定メニューでダッシュボード（options.html）を新規タブで開く動作を検証する。
 */

test.describe('Popup - PBI-27 @extension', () => {
  test('popup shows mainScreen and does not contain inline settingsScreen', async ({ popupPage: page }) => {
    await expect(page.locator('#mainScreen')).toBeVisible();
    await expect(page.locator('#settingsScreen')).toHaveCount(0);
    await expect(page.locator('#menuBtn')).toBeVisible();
    await expect(page.locator('#recordBtn')).toBeVisible();
  });

  test('menu button opens dashboard in a new tab and closes popup', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();

    const state = await page.evaluate(() => ({
      urls: (window as any).__createdTabUrls as string[],
      closeCalled: (window as any).__closeCalled as boolean,
    }));

    expect(state.urls.length).toBeGreaterThanOrEqual(1);
    expect(state.urls[state.urls.length - 1]).toMatch(/options\.html$/);
    expect(state.closeCalled).toBe(true);
  });

  test('history button opens history tab in dashboard and closes popup', async ({ popupPage: page }) => {
    await page.locator('#historyBtn').click();

    const state = await page.evaluate(() => ({
      urls: (window as any).__createdTabUrls as string[],
      closeCalled: (window as any).__closeCalled as boolean,
    }));

    expect(state.urls.length).toBeGreaterThanOrEqual(1);
    expect(state.urls[state.urls.length - 1]).toMatch(/options\.html\?tab=history$/);
    expect(state.closeCalled).toBe(true);
  });

  test('record button remains on mainScreen and does not open settings', async ({ popupPage: page }) => {
    await page.locator('#recordBtn').click();

    const state = await page.evaluate(() => ({
      urls: (window as any).__createdTabUrls as string[],
      closeCalled: (window as any).__closeCalled as boolean,
    }));

    // Record button may trigger a confirmation flow, but it must not open options.html
    expect(state.urls).not.toContain(expect.stringMatching(/options\.html/));
    expect(state.closeCalled).toBe(false);
  });
});
