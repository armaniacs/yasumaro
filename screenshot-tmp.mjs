import { chromium } from 'playwright';
import path from 'path';

const extensionPath = path.resolve('dist/chromium-mv3');
const userDataDir = '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/chrome-profile';

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
console.log('Extension ID:', extensionId);

const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/options.html`);
await page.waitForTimeout(1000);

// Click the markdown template tab
await page.click('[data-panel="panel-markdown-template"]');
await page.waitForTimeout(500);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/panel-list.png', fullPage: true });

// Click create button
await page.click('#markdownTemplateCreateBtn');
await page.waitForTimeout(500);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/7c08db5d-780d-4314-b63d-c17b64056acc/scratchpad/panel-editor.png', fullPage: true });

await context.close();
