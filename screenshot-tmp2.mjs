import { chromium } from 'playwright';
import path from 'path';

const extensionPath = path.resolve('dist/chromium-mv3');
const userDataDir = '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/chrome-profile2';

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

await new Promise(r => setTimeout(r, 1500));

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
const extensionId = sw.url().split('/')[2];

const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/options.html`);
await page.waitForTimeout(1000);

await page.click('[data-panel="panel-markdown-template"]');
await page.waitForTimeout(300);
await page.click('#markdownTemplateCreateBtn');
await page.waitForTimeout(300);

// Test save with empty entries placeholder to trigger validation error
await page.fill('#markdownTemplateFileInput', '# {{date}}\n{{entries}}');
await page.fill('#markdownTemplateEntryInput', '- {{badkey}}');
await page.waitForTimeout(300);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/panel-invalid-preview.png', fullPage: true });

await page.click('#markdownTemplateSaveBtn');
await page.waitForTimeout(300);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/panel-save-error.png', fullPage: true });

// Fix and save
await page.fill('#markdownTemplateEntryInput', '- {{timestamp}} {{title}}');
await page.waitForTimeout(300);
await page.click('#markdownTemplateSaveBtn');
await page.waitForTimeout(500);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/panel-after-save.png', fullPage: true });

await context.close();
