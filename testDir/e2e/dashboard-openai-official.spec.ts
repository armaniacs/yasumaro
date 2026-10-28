import { testInteraction, expect } from './fixtures/dashboard.fixture.js';

// No API key or live API call: exercise only the actual extension settings UI.
testInteraction.describe('Official OpenAI settings @interaction @extension', () => {
  testInteraction('selects OpenAI with one key and model field and keeps compatible providers available', async ({ dashboardPage: page }) => {
    const select = page.locator('#aiProvider');
    await select.selectOption('openai-official');
    const panel = page.locator('#openai-officialSettings');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#openaiOfficialApiKey')).toBeVisible();
    await expect(panel.locator('#openaiOfficialModel')).toBeVisible();
    await expect(panel.locator('input')).toHaveCount(2);
    await expect(panel.locator('[data-i18n="openaiOfficialHelp"]')).toContainText('https://api.openai.com/v1');
    await expect(page.locator('#geminiSettings')).toBeHidden();
    await select.selectOption('openai2');
    await expect(panel).toBeHidden();
    await expect(page.locator('#openai2Settings')).toBeVisible();
    await select.selectOption('openai-official');
    await expect(panel).toBeVisible();
    await expect(page.locator('#openaiOfficialApiKey')).toHaveCount(1);
  });
});
