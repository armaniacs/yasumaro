import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPTIONS_PATH = path.join(__dirname, '../../dist/chromium-mv3/options.html');

/**
 * Dashboard UI テスト - 全パネルの構造検証
 *
 * 対象: dist/chromium-mv3/options.html
 * プロトコル: file:// (静的HTML)
 *
 * 注意: file:// プロトコルでは Chrome 拡張機能 API が利用不可のため、
 * JavaScript によるナビゲーション（active クラス、aria-selected 変更）は
 * 動作しない。このテストは DOM 構造の存在確認のみを検証する。
 *
 * HTML 構造:
 * - サイドバー: div.sidebar-section-label (Settings/Data/Tools) + button.sidebar-nav-btn[role="tab"] (16個)
 * - パネル: section.panel[role="tabpanel"] (ID: panel-general, panel-domain, ...)
 */

// ========================================
// 1. 初期表示テスト
// ========================================
test.describe('Dashboard - Initial Load @ui', () => {
  test('has correct page title', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page).toHaveTitle('Yasumaro Dashboard');
  });

  test('has sidebar navigation with 3 sections', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    // Settings, Data, Tools の3セクション見出しが存在すること
    const sectionLabels = page.locator('.sidebar-section-label');
    await expect(sectionLabels).toHaveCount(3);
    await expect(sectionLabels.nth(0)).toHaveText('Settings');
    await expect(sectionLabels.nth(1)).toHaveText('Data');
    await expect(sectionLabels.nth(2)).toHaveText('Tools');
  });

  test('has 16 sidebar navigation tabs', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const sidebarTabs = page.locator('.sidebar-nav-btn');
    await expect(sidebarTabs).toHaveCount(16);
  });

  test('initial tab (panel-general) is selected', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const initialTab = page.locator('.sidebar-nav-btn[aria-controls="panel-general"]');
    await expect(initialTab).toHaveAttribute('aria-selected', 'true');
    await expect(initialTab).toHaveClass(/active/);
  });

  test('initial panel (panel-general) is active', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const activePanel = page.locator('section.panel.active');
    await expect(activePanel).toHaveAttribute('id', 'panel-general');
  });

  test('main content area is visible', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });
});

// ========================================
// 2. ナビゲーションテスト（DOM存在確認のみ）
// ========================================
test.describe('Dashboard - Sidebar Navigation @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
  });

  const panelTests = [
    { tab: 'Domain Filter', panel: 'panel-domain' },
    { tab: 'Prompt', panel: 'panel-prompt' },
    { tab: 'Privacy', panel: 'panel-privacy' },
    { tab: 'Content', panel: 'panel-content' },
    { tab: 'AI Summary Cleansing', panel: 'panel-ai-summary-cleansing' },
    { tab: 'Trust', panel: 'panel-trust' },
    { tab: 'CSP', panel: 'panel-csp' },
    { tab: 'Tags', panel: 'panel-tags' },
    { tab: 'Recording Conditions', panel: 'panel-recording-conditions' },
    { tab: 'Diagnostics', panel: 'panel-diagnostics' },
    { tab: 'Tag Cluster', panel: 'panel-tag-cluster' },
    { tab: 'SQLite History', panel: 'panel-sqlite-history' },
    { tab: 'Domain Search', panel: 'panel-domain-search' },
    { tab: 'Export Logs', panel: 'panel-export-logs' },
    { tab: 'Export / Import', panel: 'panel-export-import' },
  ];

  for (const { tab, panel } of panelTests) {
    test(`has ${tab} tab and ${panel}`, async ({ page }) => {
      // タブがDOMに存在すること
      await expect(page.getByRole('tab', { name: tab })).toBeAttached();
      // パネルがDOMに存在すること
      await expect(page.locator(`#${panel}`)).toBeAttached();
    });
  }

  test('only one tab is initially selected', async ({ page }) => {
    const selectedTabs = page.locator('.sidebar-nav-btn[aria-selected="true"]');
    await expect(selectedTabs).toHaveCount(1);
  });
});

// ========================================
// 3. 初期設定パネルテスト
// ========================================
test.describe('Dashboard - Initial Settings Panel @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
  });

  test('has Obsidian connection section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.locator('h2.panel-title')).toHaveText(/初期設定/);
    await expect(panel.getByText('Obsidian 接続')).toBeVisible();
  });

  test('has Obsidian settings details fieldset', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.locator('#obsidianSettingsDetails')).toBeAttached();
  });

  test('has local Markdown export section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('ローカル Markdown 書き出し')).toBeVisible();
  });

  test('has weekly/monthly summary section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('週次/月次振り返りサマリ')).toBeVisible();
  });

  test('has AI provider priority sections', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('AI プロバイダー')).toBeVisible();
  });

  test('has Gemini API key input', async ({ page }) => {
    await expect(page.locator('#geminiApiKey')).toBeAttached();
  });

  test('has retention policy section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('閲覧履歴 保持ポリシー')).toBeVisible();
  });

  test('has content retention section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('コンテンツ保持設定')).toBeVisible();
  });

  test('has action buttons at top and bottom', async ({ page }) => {
    const panel = page.locator('#panel-general');

    // 保存するボタンが上下に2つあること
    const saveButtons = panel.getByRole('button', { name: '保存する' });
    await expect(saveButtons).toHaveCount(2);

    // Obsidian テストボタンが上下に2つあること
    const obsidianTestButtons = panel.getByRole('button', { name: 'Obsidian テスト' });
    await expect(obsidianTestButtons).toHaveCount(2);
  });

  test('can expand detailed settings', async ({ page }) => {
    const panel = page.locator('#panel-general');
    const details = panel.locator('#obsidianSettingsDetails');

    // デフォルトは閉じている
    await expect(details).not.toHaveAttribute('open', '');

    // Protocol / Port 入力がDOMに存在すること
    await expect(page.locator('#protocol')).toBeAttached();
    await expect(page.locator('#port')).toBeAttached();
  });
});

// ========================================
// 4. Domain Filter パネルテスト
// ========================================
test.describe('Dashboard - Domain Filter Panel @ui', () => {
  test('has domain mode tabs (blacklist/whitelist)', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#domainModeTab-blacklist')).toBeAttached();
    await expect(page.locator('#domainModeTab-whitelist')).toBeAttached();
  });
});

// ========================================
// 5. Prompt パネルテスト
// ========================================
test.describe('Dashboard - Prompt Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-prompt')).toBeAttached();
  });
});

// ========================================
// 6. Privacy パネルテスト
// ========================================
test.describe('Dashboard - Privacy Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-privacy')).toBeAttached();
  });
});

// ========================================
// 7. Content パネルテスト
// ========================================
test.describe('Dashboard - Content Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-content')).toBeAttached();
  });
});

// ========================================
// 8. AI Summary Cleansing パネルテスト
// ========================================
test.describe('Dashboard - AI Summary Cleansing Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-ai-summary-cleansing')).toBeAttached();
  });
});

// ========================================
// 9. Trust パネルテスト
// ========================================
test.describe('Dashboard - Trust Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-trust')).toBeAttached();
  });
});

// ========================================
// 10. CSP パネルテスト
// ========================================
test.describe('Dashboard - CSP Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-csp')).toBeAttached();
  });
});

// ========================================
// 11. Tags パネルテスト
// ========================================
test.describe('Dashboard - Tags Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-tags')).toBeAttached();
  });
});

// ========================================
// 12. Recording Conditions パネルテスト
// ========================================
test.describe('Dashboard - Recording Conditions Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-recording-conditions')).toBeAttached();
  });
});

// ========================================
// 13. Diagnostics パネルテスト
// ========================================
test.describe('Dashboard - Diagnostics Panel @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
  });

  test('has diagnostics panel section with all key elements', async ({ page }) => {
    await expect(page.locator('#panel-diagnostics')).toBeAttached();
    await expect(page.locator('#diagStorageStats')).toBeAttached();
    await expect(page.locator('#diagSqliteStats')).toBeAttached();
    await expect(page.locator('#diagExtInfo')).toBeAttached();
    await expect(page.locator('#diagObsidianSettings')).toBeAttached();
    await expect(page.locator('#diagAiSettings')).toBeAttached();
    await expect(page.locator('#diagDeficiencyStats')).toBeAttached();
  });

  test('has diagnostic action buttons', async ({ page }) => {
    await expect(page.locator('#diagTestObsidianBtn')).toBeAttached();
    await expect(page.locator('#diagTestAiBtn')).toBeAttached();
    await expect(page.locator('#diagTestSqliteBtn')).toBeAttached();
    await expect(page.locator('#diagDebugModeToggle')).toBeAttached();
    await expect(page.locator('#diagOpfsSpikeBtn')).toBeAttached();
    await expect(page.locator('#diagMigrateBtn')).toBeAttached();
    await expect(page.locator('#diagBackfillBtn')).toBeAttached();
    await expect(page.locator('#diagCleanupBtn')).toBeAttached();
  });

  test('has diagnostic result areas', async ({ page }) => {
    await expect(page.locator('#diagConnectionResult')).toBeAttached();
    await expect(page.locator('#diagSqliteResult')).toBeAttached();
    await expect(page.locator('#diagOpfsSpikeResult')).toBeAttached();
    await expect(page.locator('#diagMigrateResult')).toBeAttached();
    await expect(page.locator('#diagBackfillResult')).toBeAttached();
    await expect(page.locator('#diagCleanupResult')).toBeAttached();
  });

  test('has compile options section', async ({ page }) => {
    await expect(page.locator('#diagCompileOptionsSection')).toBeAttached();
    await expect(page.locator('#diagCompileOptionsStats')).toBeAttached();
    await expect(page.locator('#diagDivergenceWarning')).toBeAttached();
  });
});

// ========================================
// 14. Export Logs パネルテスト
// ========================================
test.describe('Dashboard - Export Logs Panel @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
  });

  test('has export logs panel with all export buttons', async ({ page }) => {
    await expect(page.locator('#panel-export-logs')).toBeAttached();
    await expect(page.locator('#export-logs-container')).toBeAttached();
    await expect(page.locator('#export-json-btn')).toBeAttached();
    await expect(page.locator('#export-markdown-btn')).toBeAttached();
    await expect(page.locator('#export-csv-btn')).toBeAttached();
    await expect(page.locator('#export-db-btn')).toBeAttached();
    await expect(page.locator('#export-status')).toBeAttached();
    await expect(page.locator('#exportLocalMarkdownBtn')).toBeAttached();
  });
});

// ========================================
// 15. Export / Import パネルテスト
// ========================================
test.describe('Dashboard - Export / Import Panel @ui', () => {
  test('panel exists in DOM', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
    await expect(page.locator('#panel-export-import')).toBeAttached();
  });
});

// ========================================
// 16. レスポンシブテスト
// ========================================
test.describe('Dashboard - Responsive Layout @ui', () => {
  test('displays correctly at mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`file://${OPTIONS_PATH}`);

    // サイドバータブが表示されること
    await expect(page.locator('.sidebar-nav-btn').first()).toBeVisible();
  });

  test('displays correctly at tablet viewport (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`file://${OPTIONS_PATH}`);

    await expect(page.locator('.sidebar-nav-btn').first()).toBeVisible();
  });

  test('displays correctly at desktop viewport (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`file://${OPTIONS_PATH}`);

    await expect(page.locator('.sidebar-nav-btn').first()).toBeVisible();
  });
});
