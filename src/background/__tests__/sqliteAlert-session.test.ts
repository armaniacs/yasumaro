/**
 * sqliteAlert-session.test.ts
 * Pins that the consecutive-failure counter survives a service worker restart.
 *
 * The SW is ephemeral (MV3): module variables are lost on every restart, so
 * sqliteAlert writes its counters through to chrome.storage.session and
 * rehydrates at module load. These tests simulate a restart with
 * vi.resetModules() + re-import and assert the counter is preserved.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
}));
vi.mock('../../utils/logger/api.js', () => ({
  logCritical: vi.fn(async () => undefined),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../../utils/logger/criticalAlertSink.js', () => ({
  ChromeNotificationCriticalSink: class {},
}));

import { logCritical } from '../../utils/logger/api.js';

async function freshAlertModule() {
  vi.resetModules();
  return import('../sqliteAlert.js');
}

/** Wait for the module's fire-and-forget session writes to land. */
async function flushSessionWrites(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const stored = (await chrome.storage.session.get('sqliteAlertState')) as Record<string, unknown>;
    if ('sqliteAlertState' in stored) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('sqliteAlert — SW restart durability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await chrome.storage.session.clear();
  });

  it('keeps the consecutive-failure count across a simulated SW restart', async () => {
    const first = await freshAlertModule();
    await first.restoreSqliteAlertState();
    first.recordSqliteFailure('sqlite', 'disk I/O error');
    first.recordSqliteFailure('sqlite', 'disk I/O error');
    await flushSessionWrites();

    // Simulate the SW teardown: drop the module instance, re-import, rehydrate.
    const second = await freshAlertModule();
    await second.restoreSqliteAlertState();

    // The restored count (2) plus one more failure reaches the threshold (3),
    // so the critical alert fires — proof the counter survived the restart.
    second.recordSqliteFailure('sqlite', 'disk I/O error');
    expect(logCritical).toHaveBeenCalledTimes(1);
  });

  it('does not fire the alert when the pre-restart count was below threshold', async () => {
    const first = await freshAlertModule();
    await first.restoreSqliteAlertState();
    first.recordSqliteFailure('sqlite', 'disk I/O error');
    await flushSessionWrites();

    const second = await freshAlertModule();
    await second.restoreSqliteAlertState();

    // Restored count (1) plus one more failure is still below threshold (3).
    second.recordSqliteFailure('sqlite', 'disk I/O error');
    expect(logCritical).not.toHaveBeenCalled();
  });

  it('a success before the restart clears the persisted counter', async () => {
    const first = await freshAlertModule();
    await first.restoreSqliteAlertState();
    first.recordSqliteFailure('sqlite', 'disk I/O error');
    first.recordSqliteFailure('sqlite', 'disk I/O error');
    first.recordSqliteSuccess();
    await flushSessionWrites();

    const second = await freshAlertModule();
    await second.restoreSqliteAlertState();

    second.recordSqliteFailure('sqlite', 'disk I/O error');
    expect(logCritical).not.toHaveBeenCalled();
  });
});
