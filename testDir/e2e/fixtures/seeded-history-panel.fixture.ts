/**
 * seeded-history-panel.fixture.ts — seeded SQLite history panel preparation.
 *
 * Encapsulates the preparation steps the panel specs repeated per test:
 * openOptionsPage → createDashboardSqliteClient → migrationSettled → seedRows
 * → panel click, plus the entry-visible wait — the single definition behind
 * the previously per-test waitFor({state:'visible', timeout:15000}) copies.
 *
 * Per-spec differences stay explicit via the panelSeedParams object (never
 * silently unified):
 * - rows        — rows the spec seeds (required)
 * - rowText     — entry text the visible-wait targets; absent = first entry
 * - seedConsent — seed privacy consent before the options page opens
 * - onPage      — page wiring right after it opens, so console capture does
 *                 not miss the load/bootstrap window
 * - beforeSeed  — seeds between migrationSettled and seedRows; settings writes
 *                 must follow the deferred migration (it folds legacy keys
 *                 into the settings blob) and precede the rows
 *
 * WHY one object with function properties instead of function-valued fixture
 * options: test.use() accepts the fixture impl signature for every fixture, so
 * a plain function option value is type-indistinguishable from an impl and its
 * arguments resolve to the fixture args, not the hook's real parameters.
 *
 * test.use() is file/describe-scoped — it cannot run inside a test body — so
 * per-test parameters live in per-test describe scopes (empty titles keep the
 * reported test paths unchanged).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  openOptionsPage,
  createDashboardSqliteClient,
  migrationSettled,
  seedRows,
  type DashboardSqliteClient,
} from './dashboardSqliteHelpers.js';
import { seedPrivacyConsent } from './privacyConsentSeed.js';
import { test as extensionTest } from './extension.fixture.js';

const PANEL_NAV = '[data-panel="panel-sqlite-history"]';
const ENTRY_ROW = '#sqlite-entry-list .sqlite-entry';
/** The visible-wait budget the specs previously duplicated per call site. */
const ENTRY_VISIBLE_TIMEOUT_MS = 15_000;

export interface SeededHistoryPanel {
  page: Page;
  client: DashboardSqliteClient;
  /** The entry the fixture waited on (first entry, or the row matching rowText). */
  seedRow: Locator;
}

export type SeededPanelParams = {
  rows: Array<Record<string, unknown>>;
  rowText?: string | undefined;
  seedConsent?: boolean | undefined;
  onPage?: ((page: Page) => void) | undefined;
  beforeSeed?: ((page: Page) => Promise<void>) | undefined;
};

type Fixtures = {
  panelSeedParams: SeededPanelParams;
  seededHistoryPanel: SeededHistoryPanel;
};

export const test = extensionTest.extend<Fixtures>({
  panelSeedParams: [
    async () => {
      throw new Error(
        'seededHistoryPanel requires panelSeedParams — set it via test.use({ panelSeedParams: { rows: [...] } })',
      );
    },
    { option: true },
  ],

  seededHistoryPanel: async ({ context, extensionId, panelSeedParams }, use) => {
    if (panelSeedParams.seedConsent) await seedPrivacyConsent(context);
    const page = await openOptionsPage(context, extensionId);
    panelSeedParams.onPage?.(page);
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    await panelSeedParams.beforeSeed?.(page);
    await seedRows(client, panelSeedParams.rows);

    await page.locator(PANEL_NAV).click();
    const seedRow =
      panelSeedParams.rowText === undefined
        ? page.locator(ENTRY_ROW).first()
        : page.locator(ENTRY_ROW, { hasText: panelSeedParams.rowText });
    await seedRow.waitFor({ state: 'visible', timeout: ENTRY_VISIBLE_TIMEOUT_MS });

    await use({ page, client, seedRow });
  },
});

export { expect };
