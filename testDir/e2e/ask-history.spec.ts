import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

/**
 * Ask-history E2E (PBI 2026-10-23-08).
 *
 * BDD: 質問に引用付きで答える / 根拠がないときは作らず分からないと言う.
 * The ask region lives in the SQLite history panel (`#sqlite-ask-history`):
 * a question, a target-collection select, and the answer with citation
 * links back to the original records.
 *
 * Determinism note: the no-evidence path never calls the AI seam, so it runs
 * anywhere. The answered paths need the on-device model (mode 'local_only'
 * routes to built-in-ai, never to a mockable HTTP slot), so they require a
 * headed run with the model available — same standing as the built-in-ai
 * interaction specs.
 *
 * Conventions: condition waits via expect.poll only (no fixed sleeps, no
 * page.waitForTimeout). Seeded rows carry summary text because the `import`
 * seed subtype stores no page content — the evidence snippet quotes the
 * summary fallback, exactly like records saved without extracted content.
 */

test.use({ locale: 'en-US' });

const BASE_MS = Date.UTC(2026, 8, 1); // 2026-09-01

function gardenRows(): Array<Record<string, unknown>> {
  return [
    {
      url: 'https://ask-e2e.test/garden-1',
      title: 'Garden journaling notes',
      summary: 'Morning light across the planter beds after the overnight rain.',
      created_at: BASE_MS,
      domain: 'ask-e2e.test',
    },
    {
      url: 'https://ask-e2e.test/garden-2',
      title: 'Compost and hedge trimming',
      summary: 'Trimmed the hedges and gathered the clippings into the compost bin.',
      created_at: BASE_MS + 1000,
      domain: 'ask-e2e.test',
    },
  ];
}

function wasmRows(): Array<Record<string, unknown>> {
  return [
    {
      url: 'https://ask-e2e.test/wasm-1',
      title: 'WASM検証の記録 1',
      summary: 'WASMモジュールの初期化手順と検証結果のまとめ。',
      created_at: BASE_MS,
      domain: 'ask-e2e.test',
    },
    {
      url: 'https://ask-e2e.test/wasm-2',
      title: 'WASM検証の記録 2',
      summary: 'WASMバウンダリテストの計測値と再現手順。',
      created_at: BASE_MS + 1000,
      domain: 'ask-e2e.test',
    },
    {
      url: 'https://ask-e2e.test/wasm-3',
      title: 'WASM検証の記録 3',
      summary: 'WASMハイブリッド統合の配線メモと注意点。',
      created_at: BASE_MS + 2000,
      domain: 'ask-e2e.test',
    },
  ];
}

test.describe('Ask history (PBI 2026-10-23-08)', () => {
  test.describe('no evidence @extension (BDD: 作らず分からないと言う)', () => {
    test.use({
      panelSeedParams: {
        rows: gardenRows(),
        rowText: 'Garden journaling notes',
        seedConsent: true,
        clearBeforeSeed: true,
      },
    });

    test('an unrelated question shows the widening suggestion and no answer', async ({
      seededHistoryPanel,
    }) => {
      test.setTimeout(120_000); // gateway budget 60s + search + panel headroom
      const { page } = seededHistoryPanel;
      const region = page.locator('#sqlite-ask-history');

      await region.locator('.ask-history-question').fill('量子コンピュータの仕様を教えてください');
      await region.locator('[data-ask-action="ask"]').click();

      // The handler answers no_evidence without calling the AI seam: the
      // status carries the widening suggestion (hardcoded wording, locale-
      // independent) and no answer is painted.
      await expect
        .poll(async () => ((await region.locator('.ask-history-status').textContent()) ?? '').trim(), {
          timeout: 90_000,
        })
        .toContain('検索語を短く');
      await expect(region.locator('.ask-answer-text')).toHaveCount(0);
    });
  });

  test.describe('answered with citations @interaction (BDD: 引用付きで答える)', () => {
    // Requires the on-device model (headed run with built-in AI available).
    test.use({
      panelSeedParams: {
        rows: wasmRows(),
        rowText: 'WASM検証の記録 1',
        seedConsent: true,
        clearBeforeSeed: true,
      },
    });

    test('a matching question paints the answer with links back to the records', async ({
      seededHistoryPanel,
    }) => {
      test.setTimeout(120_000);
      const { page } = seededHistoryPanel;
      const region = page.locator('#sqlite-ask-history');

      await region.locator('.ask-history-question').fill('WASMの検証結果を教えてください');
      await region.locator('[data-ask-action="ask"]').click();

      // The local model round-trip lands within the 60s gateway budget.
      await expect
        .poll(async () => ((await region.locator('.ask-answer-text').textContent()) ?? '').trim(), {
          timeout: 90_000,
        })
        .not.toBe('');
      // Three matching rows → three citations, each a new-tab noopener link
      // back to its record (BDD: 元記録に飛べる).
      const links = region.locator('.ask-citation-link');
      await expect.poll(async () => links.count(), { timeout: 15_000 }).toBe(3);
      await expect(links.first()).toHaveAttribute('target', '_blank');
      await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(links.nth(0)).toHaveAttribute('href', 'https://ask-e2e.test/wasm-1');
      await expect(links.nth(1)).toHaveAttribute('href', 'https://ask-e2e.test/wasm-2');
      await expect(links.nth(2)).toHaveAttribute('href', 'https://ask-e2e.test/wasm-3');
    });
  });

  test.describe('collection target @interaction (BDD: 対象コレクションを選んだ)', () => {
    // Requires the on-device model (headed run with built-in AI available).
    test.use({
      panelSeedParams: {
        rows: [
          {
            url: 'https://ask-e2e.test/scoped-1',
            title: '対象コレクションの記録 1',
            summary: 'スコープ対象のWASM検証メモ、その1。',
            tags: 'e2eAsk',
            created_at: BASE_MS,
            domain: 'ask-e2e.test',
          },
          {
            url: 'https://ask-e2e.test/scoped-2',
            title: '対象コレクションの記録 2',
            summary: 'スコープ対象のWASM検証メモ、その2。',
            tags: 'e2eAsk',
            created_at: BASE_MS + 1000,
            domain: 'ask-e2e.test',
          },
          {
            url: 'https://ask-e2e.test/unscoped-1',
            title: '対象外の記録',
            summary: '別タグのWASM検証メモ。対象に選ばれていない。',
            tags: 'other',
            created_at: BASE_MS + 2000,
            domain: 'ask-e2e.test',
          },
        ],
        rowText: '対象コレクションの記録 1',
        seedConsent: true,
        clearBeforeSeed: true,
        beforeSeed: async (page) => {
          await page.evaluate(async () => {
            const res = await chrome.storage.local.get('settings');
            const current = (res.settings as Record<string, unknown>) ?? {};
            await chrome.storage.local.set({
              settings: {
                ...current,
                saved_collections: {
                  'col-e2e-ask': {
                    id: 'col-e2e-ask',
                    name: 'E2E Ask collection',
                    query: { tag: 'e2eAsk' },
                    createdAt: 1,
                    updatedAt: 2,
                  },
                },
              },
            });
          });
        },
      },
    });

    test('the chosen collection scopes the citations to its tagged rows', async ({
      seededHistoryPanel,
    }) => {
      test.setTimeout(120_000);
      const { page } = seededHistoryPanel;
      const region = page.locator('#sqlite-ask-history');

      // The saved collection is offered as a target (loaded before the ask
      // region renders, not raced by it).
      const target = region.locator('.ask-history-target');
      await expect
        .poll(async () => target.locator('option[value="col-e2e-ask"]').count(), { timeout: 15_000 })
        .toBe(1);
      await target.selectOption('col-e2e-ask');

      await region.locator('.ask-history-question').fill('WASM検証メモの内容を教えてください');
      await region.locator('[data-ask-action="ask"]').click();

      await expect
        .poll(async () => ((await region.locator('.ask-answer-text').textContent()) ?? '').trim(), {
          timeout: 90_000,
        })
        .not.toBe('');
      // Only the two tagged rows survive the collection scope.
      const links = region.locator('.ask-citation-link');
      await expect.poll(async () => links.count(), { timeout: 15_000 }).toBe(2);
      await expect(links.nth(0)).toHaveAttribute('href', 'https://ask-e2e.test/scoped-1');
      await expect(links.nth(1)).toHaveAttribute('href', 'https://ask-e2e.test/scoped-2');
    });
  });
});
