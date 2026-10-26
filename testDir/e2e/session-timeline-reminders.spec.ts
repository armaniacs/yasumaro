/**
 * session-timeline-reminders.spec.ts
 *
 * PBI 2026-10-22-04 ― headless E2E for the closable slice: unread rows
 * (scroll_ratio < 0.9) flow through the real history panel pipeline, and
 * the reminder-state storage seam (chrome.storage.local namespaced key)
 * round-trips in the real extension context.
 *
 * Deferred (see PBI): the full trail-grouping通し. The DASHBOARD_SQLITE
 * `import` subtype drops search_query / nav_source_url (see
 * maintenanceBatchHandler.ts import mapping), so trail columns cannot be
 * seeded without touching shared handler code — the timeline-grouping E2E
 * waits for the playback panel registry wiring.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

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

test.use({ panelSeedParams: { rows: buildUnreadRows(), rowText: 'Reminder e2e unread row' } });

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
