import { expect, type Page } from '@playwright/test';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';

/**
 * Session-lock receiver through the real message bus @extension
 * (PBI 2026-10-21-12 / VULN-017)
 *
 * Pins the cross-context lock transition that unit tests cannot exercise (they
 * mock chrome.runtime, and the delivery is real only across contexts):
 *
 * 1. The message contract: SESSION_LOCK_REQUEST sent from one extension page
 *    reaches BOTH other contexts — the service worker's MessageRouter
 *    (extension-only trust level, VULN-020) and the dashboard page's receiver
 *    (main.ts). The sender-not-self platform fact (privacyConsent.ts) is why
 *    the sender must be a different page than the receiver.
 *
 * 2. The lock persists: the SW handler's lockSession (compositionManifest
 *    wires it to the page-local encryptionSession.lockSession — no fan-out;
 *    the fan-out lives in the alarm path) writes IS_LOCKED.
 *
 * 3. The receiver's locked transition: the dashboard receiver re-reads
 *    authGuard's lock state on every received message (the message carries no
 *    payload, so the re-read is the only source of truth), drops the cached
 *    encryption key (VULN-017's extension-page half), and reloads the
 *    master-password panel. The reload is the only boot-independent path that
 *    reveals #masterPasswordOptions, so its reveal is the DOM proof the
 *    receiver applied the transition.
 *
 * WHY the seed is locked BEFORE the send: the real fan-out is sent by
 * SessionAlarmService.lockSession on the alarm path only (check_session_timeout,
 * a 5-minute chrome.alarms that cannot be waited in a test — that trigger and
 * its retry-until-confirmed send stay unit-tested via the injected
 * AlarmPort/Clock/SendMessage seam). The receiver's behavior is identical for
 * every delivery that finds the lock flag already set, so the e2e drives the
 * same state through the real bus: seed locked, deliver, observe the
 * transition. The observed count also pins the bus itself (the popup's send
 * reaches the dashboard page — cross-context delivery works).
 *
 * WHY the migration is forced first: the seed writes the flat
 * master_password_enabled / is_locked keys, and the first message through the
 * envelope pipeline runs the deferred startup migration, which folds flat keys
 * into the versioned `settings` blob and REMOVES them (observed on 2026-10-21
 * as a seed that vanished before the send). A real upgrading user's
 * post-migration writes stay top-level, so the e2e mirrors that order.
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

// StorageKeys.MASTER_PASSWORD_ENABLED / IS_LOCKED (utils/storage/types.ts) —
// e2e specs keep the string literals (no src imports, see the other specs).
const MASTER_PASSWORD_ENABLED_KEY = 'master_password_enabled';
const IS_LOCKED_KEY = 'is_locked';
// CURRENT_PROTOCOL_VERSION (messaging/protocol.ts)
const PROTOCOL_VERSION = 1;

test.describe('Session lock fan-out @extension', () => {
  test('SESSION_LOCK_REQUEST reaches the dashboard receiver and applies the locked transition', async ({ context, extensionId, dashboardPage: dashboard }) => {
    // Force the deferred startup migration to complete BEFORE seeding: the
    // one-time upgrade folds flat keys into the `settings` blob and removes
    // them, so a seed written earlier would be folded away. A PING through the
    // envelope pipeline runs it; the completion flag is the settled signal.
    await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'PING' }));
    await expect.poll(async () => {
      const state = await dashboard.evaluate(async () => {
        const got = await chrome.storage.local.get(['settings_migrated']);
        return got['settings_migrated'];
      });
      return (state as { stage?: string } | null)?.stage;
    }, { timeout: 15_000 }).toBe('completed');

    // Seed a master-password user whose session is ALREADY locked — the state
    // every fan-out delivery finds on the real alarm path. Written after the
    // migration so the flat keys stay top-level. The read-back pins the seed
    // itself so a storage failure is diagnosed here, not downstream.
    const seeded = await dashboard.evaluate(async ({ enabledKey, lockedKey }) => {
      await chrome.storage.local.set({ [enabledKey]: true, [lockedKey]: true });
      return chrome.storage.local.get([enabledKey, lockedKey]);
    }, { enabledKey: MASTER_PASSWORD_ENABLED_KEY, lockedKey: IS_LOCKED_KEY });
    expect(seeded).toMatchObject({ [MASTER_PASSWORD_ENABLED_KEY]: true, [IS_LOCKED_KEY]: true });

    // Precondition: #masterPasswordOptions carries the 'hidden' class on boot —
    // the static HTML default, and nothing loads the master-password settings
    // at boot (privacySettingsPanel mounts only on navigation). Its only
    // remaining removal path is the receiver's onLocked reload, so the class
    // removal below is the DOM proof the receiver applied the locked
    // transition. (The class is asserted, not visibility: the options block
    // sits in the privacy panel, which is display:none while the dashboard
    // shows the Initial Setup panel.)
    const masterPasswordOptions = dashboard.locator('#masterPasswordOptions');
    await expect(masterPasswordOptions).toHaveClass(/hidden/);

    // The probe counts deliveries so a missing cross-context delivery is
    // diagnosed here instead of silently asserting on a no-op.
    await dashboard.evaluate(() => {
      const win = window as unknown as { __lockDeliveries: number };
      win.__lockDeliveries = 0;
      chrome.runtime.onMessage.addListener((msg: unknown) => {
        if ((msg as { type?: string })?.type === 'SESSION_LOCK_REQUEST') {
          win.__lockDeliveries += 1;
        }
      });
    });

    // The sender must be a DIFFERENT extension context (sender-not-self
    // delivery): the popup page sends, the dashboard receives.
    const sender: Page = await context.newPage();
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);

    const response = await sender.evaluate(
      (protocolVersion) =>
        chrome.runtime.sendMessage({ type: 'SESSION_LOCK_REQUEST', protocolVersion }),
      PROTOCOL_VERSION,
    );

    // Both responders answer the success body: the SW handler after its
    // lockSession, the dashboard receiver after its lock-state re-read settles.
    expect(response).toMatchObject({ success: true });

    // The bus delivered cross-context: the popup's send reached the dashboard
    // page (sender-not-self excluded the popup's own receiver).
    await expect.poll(async () => {
      const count = await dashboard.evaluate(
        () => (window as unknown as { __lockDeliveries: number }).__lockDeliveries,
      );
      return count;
    }, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);

    // The receiver's re-read saw the locked flag and applied the transition:
    // onLocked reloaded the master-password panel and loadSettings() removed
    // the 'hidden' class.
    await expect(masterPasswordOptions).not.toHaveClass(/hidden/);

    // The lock flag survived the round trip.
    const stored = await dashboard.evaluate(async (lockedKey) => {
      const got = await chrome.storage.local.get([lockedKey]);
      return got;
    }, IS_LOCKED_KEY);
    expect(stored).toMatchObject({ [IS_LOCKED_KEY]: true });

    await sender.close();
  });
});
