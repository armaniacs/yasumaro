import { test, expect } from './fixtures/extension.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from './fixtures/dashboardSqliteHelpers.js';

/**
 * PBI 2026-10-22-03, BDD Scenario 2 「類似記事が束ねられる」:
 * Given 同一ニュースを複数媒体で記録した
 * When 類似クラスタ表示を開いた
 * Then 1クラスタに束ねられ、鮮度(最終更新)と多角的差分(媒体一覧)だけが見える
 *
 * BDD Scenario 1 「週次ダイジェストが生成される」は意図的に E2E に含めない:
 * 生成は AI プロバイダ設定とダウンロード先 (既存 reviewSummaryGenerator の
 * 週次経路) に依存し、E2E で固定できないため。再開・冪等・発行失敗・取消・
 * 他期間破棄の機械は src/background/__tests__/digestBatchJob.test.ts (5件) と
 * src/background/__tests__/digestBatchAlarm.test.ts /
 * digestBatchCheckpointStore.test.ts が担保する。
 *
 * 固定時間待ち禁止 (TEST_RULE): すべての待ちは条件待ち
 * (toHaveCount / toBeVisible / toBeHidden の poll)。
 */

/** Jaccard >= 0.5 (SIMILARITY_THRESHOLD) で同一クラスタになる同一ニュース対。 */
const SAME_NEWS_MEDIA_A = 'WASM embedding ships in Chrome 140';
const SAME_NEWS_MEDIA_B = 'Chrome 140 ships WASM embedding support';
const UNRELATED = 'Curry recipe with potatoes';

function makeSeedRows(): Array<Record<string, unknown>> {
  const baseMs = Date.UTC(2025, 0, 1);
  return [
    {
      url: 'https://a.example/wasm-embedding',
      title: SAME_NEWS_MEDIA_A,
      tags: null,
      created_at: baseMs,
      domain: 'a.example',
    },
    {
      url: 'https://b.example/wasm-embedding-support',
      title: SAME_NEWS_MEDIA_B,
      tags: null,
      created_at: baseMs + 1000,
      domain: 'b.example',
    },
    {
      url: 'https://c.example/curry',
      title: UNRELATED,
      tags: null,
      created_at: baseMs + 2000,
      domain: 'c.example',
    },
  ];
}

test.describe('similarity cluster @extension', () => {
  // Pin the locale so the chrome.i18n cluster-heading assertion is
  // deterministic: the heading is i18n keyed (R-06 残), so an unpinned
  // browser locale would render the ja wording and fail the English
  // assertion. chrome.i18n.getMessage() resolves against the browser UI
  // locale, which the fixture forwards as --lang + Playwright locale.
  test.use({ locale: 'en-US' });

  test('bundles same-news records across media into one cluster with freshness and media', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);

    // Given 同一ニュースを複数媒体で記録した (seed は固定 created_at で冪等).
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeSeedRows());

    // When 類似クラスタ表示を開いた.
    await page.locator('button[data-panel="panel-similarity-cluster"]').click();
    const list = page.locator('#similarityClusterList');
    await expect(list).toBeVisible();

    // Then 1クラスタに束ねられる (単独行は破棄: MIN_CLUSTER_SIZE=2).
    const clusters = list.locator('section');
    await expect(clusters).toHaveCount(1);
    const cluster = clusters.first();

    // 鮮度 (最終更新) と多角的差分 (媒体一覧) が見出しに見える: 件数 + 両媒体 +
    // 最も新しい訪問の日付 (年は全 locale で 4 桁)。見出しは i18n 鍵化 (en:
    // "{count} articles - {domains} - {date}") なので en-US pin 下で英語見出し
    // を表明する。toContainText に配列を渡すと「要素ごとに1文ずつ」の意味に
    // なるため、1 セクションに対しては個別に表明する。
    await expect(cluster).toContainText('2 articles');
    await expect(cluster).toContainText('a.example');
    await expect(cluster).toContainText('b.example');
    await expect(cluster).toContainText('2025');

    // 媒体ごとの行: 題 + リンク + 媒体。
    const links = cluster.locator('a');
    await expect(links).toHaveCount(2);
    await expect(links.filter({ hasText: SAME_NEWS_MEDIA_A }).first()).toBeVisible();
    await expect(links.filter({ hasText: SAME_NEWS_MEDIA_B }).first()).toBeVisible();

    // 無関係な単独行はどこにも現れず、空状態も非表示。
    await expect(list).not.toContainText('c.example');
    await expect(page.locator('#similarityClusterEmptyState')).toBeHidden();
  });
});
