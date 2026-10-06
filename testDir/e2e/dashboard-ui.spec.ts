import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { SIDEBAR_PANELS } from '../../src/dashboard/panels/panelCatalog.js';

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
 * - サイドバー: div.sidebar-section-label (Settings/Data/Tools) + button.sidebar-nav-btn[role="tab"]
 *   （パネル数 = SIDEBAR_PANELS.length。Tools 欄末尾の「不具合を報告」ボタン
 *   (#sidebarReportBugBtn) はナビゲーションタブではなくアクションボタンのため
 *   role="tab" を持たない → role セレクタで数えることでカタログと1対1に対応）
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

  test('has one sidebar tab per catalog panel', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    // role="tab" スコープ: #sidebarReportBugBtn は見た目を .sidebar-nav-btn と
    // 共用するがナビゲーションタブではない（role/aria-controls/data-panel なし）。
    // 期待値を SIDEBAR_PANELS から取ることで、パネル追加時にテスト側の
    // ハードコードが陳腐化しない（SSOT = panelCatalog.ts）。
    const sidebarTabs = page.locator('#sidebar .sidebar-nav-btn[role="tab"]');
    await expect(sidebarTabs).toHaveCount(SIDEBAR_PANELS.length);
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
      // タブがDOMに存在すること（exact: 'Tag Cluster Compare' 等の前方一致タブと
      // 区別するため厳密一致を使う）
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeAttached();
      // パネルがDOMに存在すること
      await expect(page.locator(`#${panel}`)).toBeAttached();
    });
  }

  test('only one tab is initially selected', async ({ page }) => {
    const selectedTabs = page.locator('#sidebar .sidebar-nav-btn[role="tab"][aria-selected="true"]');
    await expect(selectedTabs).toHaveCount(1);
  });

  test('has sidebar nav buttons for diagnostics and export logs', async ({ page }) => {
    // Unified from dashboard-diagnostics.spec.ts: text assertions that the
    // tab/panel loop above does not cover.
    const sidebarLabels: Array<[string, RegExp]> = [
      ['panel-diagnostics', /Diagnostics/],
      ['panel-export-logs', /Export Logs/],
    ];
    for (const [panel, name] of sidebarLabels) {
      const btn = page.locator(`[data-panel="${panel}"]`);
      await expect(btn).toBeAttached();
      await expect(btn).toHaveText(name);
    }
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
    await expect(panel.locator('h2.panel-title')).toHaveText(/Initial Setup/);
    await expect(panel.getByRole('heading', { name: 'Obsidian Connection', exact: true })).toBeVisible();
  });

  test('has Obsidian settings details fieldset', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.locator('#obsidianSettingsDetails')).toBeAttached();
  });

  test('has local Markdown export section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('Local Markdown Export')).toBeVisible();
  });

  test('has weekly/monthly summary section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('Weekly/Monthly Review Summary')).toBeVisible();
  });

  test('has AI provider priority sections', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByRole('heading', { name: 'AI Provider', exact: true })).toBeVisible();
  });

  test('has provider settings mount point', async ({ page }) => {
    // Per-provider settings blocks (incl. #geminiApiKey) are built from the
    // catalog at panel mount; the static HTML carries only the mount point.
    await expect(page.locator('#providerSettingsMount')).toBeAttached();
  });

  test('has retention policy section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('History Retention Policy')).toBeVisible();
  });

  test('has content retention section', async ({ page }) => {
    const panel = page.locator('#panel-general');
    await expect(panel.getByText('Content Retention Settings')).toBeVisible();
  });

  test('has content storage toggle in content retention section', async ({ page }) => {
    const toggle = page.locator('#contentStorageEnabled');
    await expect(toggle).toBeAttached();
    await expect(toggle).toHaveAttribute('type', 'checkbox');
    await expect(toggle).toHaveAttribute('data-storage-key', 'content_storage_enabled');
  });

  test('has action buttons at top and bottom', async ({ page }) => {
    const panel = page.locator('#panel-general');

    // 保存するボタンが上下に2つあること
    const saveButtons = panel.getByRole('button', { name: 'Save' });
    await expect(saveButtons).toHaveCount(2);

    // Obsidian テストボタンが上下に2つあること
    const obsidianTestButtons = panel.getByRole('button', { name: 'Test Obsidian' });
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

  // Unified assertion set from dashboard-diagnostics.spec.ts (deleted).
  // OPFS spike entries must stay gone (PBI 2026-09-07-19).
  const DIAG_SECTION_IDS = [
    '#panel-diagnostics',
    '#diagStorageStats',
    '#diagSqliteStats',
    '#diagExtInfo',
    '#diagObsidianSettings',
    '#diagAiSettings',
    '#diagDeficiencyStats',
  ];
  const DIAG_BUTTON_IDS = [
    '#diagTestObsidianBtn',
    '#diagTestAiBtn',
    '#diagTestSqliteBtn',
    '#diagDebugModeToggle',
    '#diagMigrateBtn',
    '#diagBackfillBtn',
    '#diagCleanupBtn',
  ];
  const DIAG_RESULT_IDS = [
    '#diagConnectionResult',
    '#diagSqliteResult',
    '#diagMigrateResult',
    '#diagBackfillResult',
    '#diagCleanupResult',
  ];
  const DIAG_COMPILE_IDS = [
    '#diagCompileOptionsSection',
    '#diagCompileOptionsStats',
    '#diagDivergenceWarning',
  ];
  const DIAG_ABSENT_IDS = ['#diagOpfsSpikeBtn', '#diagOpfsSpikeResult'];

  test('has diagnostics panel section with all key elements', async ({ page }) => {
    for (const id of DIAG_SECTION_IDS) {
      await expect(page.locator(id)).toBeAttached();
    }
  });

  test('has diagnostic action buttons', async ({ page }) => {
    for (const id of DIAG_BUTTON_IDS) {
      await expect(page.locator(id)).toBeAttached();
    }
  });

  test('has diagnostic result areas', async ({ page }) => {
    for (const id of DIAG_RESULT_IDS) {
      await expect(page.locator(id)).toBeAttached();
    }
  });

  test('has compile options section', async ({ page }) => {
    for (const id of DIAG_COMPILE_IDS) {
      await expect(page.locator(id)).toBeAttached();
    }
    // Carried over from dashboard-diagnostics.spec.ts: migration stats and
    // its guide link live in the diagnostics panel.
    await expect(page.locator('#diagMigrationStats')).toBeAttached();
    await expect(
      page.locator('#diagMigrationStats').locator('..').locator('a[href*="MIGRATION_GUIDE"]'),
    ).toBeAttached();
  });

  test('removed OPFS spike elements stay gone', async ({ page }) => {
    for (const id of DIAG_ABSENT_IDS) {
      await expect(page.locator(id)).toHaveCount(0);
    }
  });
});

// ========================================
// 14. Export Logs パネルテスト
// ========================================
test.describe('Dashboard - Export Logs Panel @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);
  });

  const EXPORT_LOGS_IDS = [
    '#panel-export-logs',
    '#export-logs-container',
    '#export-json-btn',
    '#export-markdown-btn',
    '#export-csv-btn',
    '#export-db-btn',
    '#export-status',
    '#exportLocalMarkdownBtn',
  ];

  test('has export logs panel with all export buttons', async ({ page }) => {
    for (const id of EXPORT_LOGS_IDS) {
      await expect(page.locator(id)).toBeAttached();
    }
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

test.describe('Archive panel (PBI 2026-09-06-02)', () => {
  // NOTE: the dashboard-ui spec loads dist/options.html via file://, where
  // module scripts are CORS-blocked — only static markup is verifiable here.
  // Panel behavior (date defaults, preview/create flow) is covered by
  // archivePanel.test.ts (jsdom unit) and the @extension e2e suite.
  test('has archive nav entry and panel elements', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const navBtn = page.locator('[data-panel="panel-archive"]');
    await expect(navBtn).toBeAttached();
    await expect(navBtn).toContainText('Archive');

    const panel = page.locator('#panel-archive');
    await expect(panel).toBeAttached();

    const dateInput = page.locator('#archive-date');
    await expect(dateInput).toBeAttached();
    await expect(dateInput).toHaveAttribute('type', 'date');
    await expect(dateInput).toHaveAttribute('min', '2000-01-01');

    await expect(page.locator('#archive-include-deleted')).toBeAttached();
    await expect(page.locator('#archive-preview-btn')).toBeAttached();
    await expect(page.locator('#archive-create-btn')).toBeAttached();
    // download/cleanup appear only after an archive is created
    await expect(page.locator('#archive-download-btn')).toBeHidden();
    await expect(page.locator('#archive-cleanup-btn')).toBeHidden();
  });
});
