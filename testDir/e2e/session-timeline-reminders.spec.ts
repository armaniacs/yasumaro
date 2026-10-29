/**
 * session-timeline-reminders.spec.ts
 *
 * PBI 2026-10-22-04 ― headless E2E for the closable slice: unread rows
 * (scroll_ratio < 0.9) flow through the real history panel pipeline, and
 * the reminder-state storage seam (chrome.storage.local namespaced key)
 * round-trips in the real extension context.
 *
 * The trail-grouping通し lives in the second describe: the trail columns are
 * seeded through REAL navigation (the nav-trail consent route), because the
 * DASHBOARD_SQLITE `import` subtype drops search_query / nav_source_url (see
 * maintenanceBatchHandler.ts import mapping) — seeding them would mean
 * touching shared handler code.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';
import type { BrowserContext, Page } from '@playwright/test';
import { seedPrivacyConsent } from './fixtures/privacyConsentSeed.js';
import { createDashboardSqliteClient, openOptionsPage } from './fixtures/dashboardSqliteHelpers.js';
import {
  enableE2EProbe,
  readE2EProbeState,
  waitForE2EProbeInit,
} from './fixtures/e2eProbe.js';

/** Module-owned key (SSOT: src/utils/sessionReminder/reminderStore.ts). */
const REMINDER_STORAGE_KEY = 'session_reminder_state_v1';

test.use({ locale: 'en-US' });

/** 6 unread rows (scroll_ratio 0.1-0.6, all below UNREAD_SCROLL_RATIO 0.9). */
function buildUnreadRows() {
  const rows: Array<Record<string, unknown>> = [];
  const base = Date.UTC(2026, 9, 20, 12, 0, 0);
  for (let i = 0; i < 6; i++) {
    rows.push({
      url: `https://reminder-e2e.test/page-${i + 1}`,
      title: `Reminder e2e unread row ${i + 1}`,
      summary: 'e2e seed row',
      created_at: base - i * 3_600_000,
      domain: 'reminder-e2e.test',
      scroll_ratio: 0.1 + i * 0.1,
    });
  }
  return rows;
}

test.use({ panelSeedParams: { rows: buildUnreadRows(), rowText: 'Reminder e2e unread row 1' } });

test.describe('Session timeline reminders @extension', () => {
  test('unread rows flow through the history panel pipeline', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;
    await expect(page.locator('#sqlite-entry-list .sqlite-entry').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(3);
  });

  test('reminder state key round-trips through real chrome.storage.local', async ({
    seededHistoryPanel,
  }) => {
    const { page } = seededHistoryPanel;
    const roundTripped = await page.evaluate(async (key: string) => {
      await chrome.storage.local.remove(key);
      const before = await chrome.storage.local.get(key);
      const dismissed = {
        lastFiredDay: null as string | null,
        records: { '42': { kind: 'dismissed', day: '2026-10-24' } },
      };
      await chrome.storage.local.set({ [key]: dismissed });
      const after = await chrome.storage.local.get(key);
      return { before, after };
    }, REMINDER_STORAGE_KEY);
    expect(roundTripped.before[REMINDER_STORAGE_KEY]).toBeUndefined();
    const stored = roundTripped.after[REMINDER_STORAGE_KEY] as {
      lastFiredDay: string | null;
      records: Record<string, { kind: string; day: string }>;
    };
    expect(stored.lastFiredDay).toBeNull();
    expect(stored.records['42']).toEqual({ kind: 'dismissed', day: '2026-10-24' });
  });
});

/**
 * The through-run (PBI 2026-10-22-04 O5): real navigation → trail columns →
 * unread candidate → notification. Two of the chain's links are documented
 * here instead of being driven:
 *
 * - ALARM PATH (O5 方針の要確認事項の判断): compositionManifest's alarmRegistry
 *   install only ARMS the standing hourly alarm — SessionReminderAlarms.start()
 *   clears + re-arms `session_reminder_daily` with periodInMinutes 60, so
 *   checkToday does NOT run at Service Worker startup. The spec therefore
 *   fires the alarm manually by name: the registry's chrome.alarms.onAlarm
 *   listener routes the firing to checkToday (the same dispatch path a real
 *   hourly tick takes). Calling checkToday directly from evaluate is not an
 *   option: SW module exports are not reachable from page.evaluate.
 *
 * - CLICK PATH (click→URL open, and therefore click→再訪): NOT programmatically
 *   triggerable from E2E. chrome.notifications has no click-dispatch API, and
 *   the handler module (sessionReminderClick.ts) is not reachable from
 *   evaluate. The open path is pinned by the unit tests instead
 *   (sessionReminderClick.test.ts: strict id parse → record re-read → openTab,
 *   私物/non-http(s) refusal, the Daily Note append failure that keeps the
 *   notification, and the dismiss/discard buttons persisting before the
 *   clear). The real notification click display stays owner-manual.
 *   test.fixme/skip は足さない (契約).
 */
test.describe('Session reminder through-run @extension', () => {
  /** The test-pages server serves long-page.html at `/`; the query string makes the two visits distinct URLs (same-day duplicate gate). */
  const SOURCE_URL = 'http://localhost:8080/?e2e=source';
  const TARGET_URL = 'http://localhost:8080/?e2e=target';
  /** Module-owned key (SSOT: src/utils/sessionReminder/reminderStore.ts). */
  const REMINDER_STORAGE_KEY = 'session_reminder_state_v1';
  /** Module-owned alarm name (SSOT: src/background/sessionReminderAlarms.ts). */
  const REMINDER_ALARM_NAME = 'session_reminder_daily';
  /** Module-owned notification prefix (SSOT: src/utils/sessionReminder/reminderNotify.ts). */
  const REMINDER_NOTIFICATION_PREFIX = 'session-reminder-';

  /**
   * One real visit: scroll to 70% of the scrollable range and wait for the
   * valid-visit report (condition waits only, no fixed sleep). 70% of the
   * range (not of the document height) keeps the visit readable-but-unread:
   * the candidate rule needs scroll_ratio < 0.9, and scrolling 70% of the
   * document height on a 300vh page clamps to the bottom (ratio 1 = read).
   */
  async function visitAndReport(context: BrowserContext, page: Page): Promise<void> {
    await page.evaluate(() => {
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * 0.7);
    });
    await expect(async () => {
      const state = await readE2EProbeState(context);
      expect(state).not.toBeNull();
      expect(state!.isValidVisitReported).toBe(true);
    }).toPass({ timeout: 20_000, intervals: [500] });
  }

  test('trail from real navigation lands the unread candidate and the notification', async ({
    context,
    extensionId,
  }) => {
    await test.step('Grant privacy + nav-trail consent and enable the E2E probe', async () => {
      // The nav-trail consent rides the same local seed: {enabled, consentedAt}
      // is the active shape (src/utils/storage/navTrailConsent.ts), and
      // localhost is allowed by the default blacklist filter.
      await seedPrivacyConsent(context, {
        nav_trail_consent: { enabled: true, consentedAt: Date.now() },
      });
      await enableE2EProbe(context);
    });

    await test.step('When: the source page and then the target page are visited in the same tab', async () => {
      const page = await context.newPage();
      await page.goto(SOURCE_URL);
      await waitForE2EProbeInit(context);
      await visitAndReport(context, page);
      // The source's valid visit is what stores the tab's previous URL in the
      // trail map; the target's valid visit is what reads it (NN18: the trail
      // map is no longer supplied from tabs.onUpdated changeInfo.url).
      await page.goto(TARGET_URL);
      await waitForE2EProbeInit(context);
      await visitAndReport(context, page);
    });

    await test.step('Then: the target record carries the real navigation trail', async () => {
      const optionsPage = await openOptionsPage(context, extensionId);
      try {
        const client = createDashboardSqliteClient(optionsPage);
        await expect(async () => {
          const res = await client.dashboardMsg({
            subtype: 'query',
            domain: 'localhost',
            limit: 100,
          } as never);
          const rows = (res?.rows ?? []) as Array<Record<string, unknown>>;
          const target = rows.find((row) => String(row['url']) === TARGET_URL);
          expect(target, `stored rows: ${JSON.stringify(rows.map((r) => r['url']))}`).toBeDefined();
          // The trail column the import seed cannot set: the tab's previous
          // URL at the moment of the target's valid visit.
          expect(String(target!['nav_source_url'] ?? '')).toBe(SOURCE_URL);
          // The candidate rules hold on the same row (non-private + unread),
          // so the reminder provider can pick it. A NULL ratio is not a
          // candidate (fail-closed): the metrics wire must be in the build.
          // masked_count is not in this query's projection - the private
          // exclusion (masked_count > 0) is pinned by the candidate provider's
          // fail-closed unit tests and the panel's isPlaybackExcluded tests.
          expect(target!['scroll_ratio'], `target row: ${JSON.stringify(target)}`).not.toBeNull();
          expect(Number(target!['scroll_ratio'])).toBeLessThan(0.9);
        }).toPass({ timeout: 15_000, intervals: [500] });
      } finally {
        await optionsPage.close();
      }
    });

    await test.step('And: the playback panel opens through its sidebar button (O1 wiring)', async () => {
      const optionsPage = await openOptionsPage(context, extensionId);
      try {
        await optionsPage.locator('button[data-panel="panel-session-timeline"]').click();
        await expect(optionsPage.locator('#panel-session-timeline')).toBeVisible({ timeout: 10_000 });
        // The panel fetches and renders (this fixture forms no 2-record
        // session — MIN_SESSION_SIZE=2 — so the empty reason is the render the
        // wiring proves; the session render is pinned by the jsdom factory
        // test with mocked rows).
        await expect(
          optionsPage.locator(
            '#sessionPlaybackList .session-playback-empty, #sessionPlaybackList .session-playback-sessions',
          ).first(),
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await optionsPage.close();
      }
    });

    await test.step('And: the manual alarm firing sends the reminder notification', async () => {
      const optionsPage = await openOptionsPage(context, extensionId);
      try {
        // Deterministic day gate: a previous run's fired day would hold the
        // surface to one notification per day.
        await optionsPage.evaluate((key: string) => chrome.storage.local.remove(key), REMINDER_STORAGE_KEY);
        await optionsPage.evaluate((name: string) => {
          chrome.alarms.create(name, { when: Date.now() + 250 });
        }, REMINDER_ALARM_NAME);
        // The registry routes the firing to checkToday → candidate query →
        // the single notification write point (NotificationHelper.show).
        await expect(async () => {
          const all = (await optionsPage.evaluate(async () => chrome.notifications.getAll())) as unknown as Record<
            string,
            Record<string, unknown>
          >;
          const reminderIds = Object.keys(all).filter((id) => id.startsWith(REMINDER_NOTIFICATION_PREFIX));
          expect(
            reminderIds.length,
            `notifications: ${JSON.stringify(Object.keys(all))}`,
          ).toBeGreaterThanOrEqual(1);
        }).toPass({ timeout: 15_000, intervals: [500] });
      } finally {
        await optionsPage.close();
      }
    });
  });
});
