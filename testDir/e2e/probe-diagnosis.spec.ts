import { test, expect } from './fixtures/extension.fixture.js';
import type { BrowserContext } from '@playwright/test';
import {
  enableE2EProbe,
  waitForE2EProbeInit,
} from './fixtures/e2eProbe.js';

/**
 * PBI 2026-11-24-20 probe init diagnosis (Outside-In RED).
 *
 * Each stage of waitForE2EProbeInit must fail with a distinct stage-named
 * error so a timeout tells which leg broke:
 *   1. service worker alive and responsive
 *   2. armed flag set
 *   3. content-script initial state published
 *
 * No fixed sleeps: every wait is the staged condition wait itself with a
 * short ceiling (fast failure, not production timing).
 */

const FAST_TIMEOUT = 2000;

test.describe('E2E probe init diagnosis @extension', () => {
  test('stage service-worker: fails distinctively when SW is stopped', async () => {
    const stopped = {
      serviceWorkers: () => [],
    } as unknown as BrowserContext;
    await expect(() => waitForE2EProbeInit(stopped, FAST_TIMEOUT)).rejects.toThrow(
      /stage.*service-worker/,
    );
  });

  test('stage armed: fails distinctively when SW runs but probe not armed', async ({
    context,
  }) => {
    await expect(() => waitForE2EProbeInit(context, FAST_TIMEOUT)).rejects.toThrow(
      /stage.*armed/,
    );
  });

  test('stage content-state: fails distinctively when armed but nothing published', async ({
    context,
  }) => {
    await enableE2EProbe(context);
    await expect(() => waitForE2EProbeInit(context, FAST_TIMEOUT)).rejects.toThrow(
      /stage.*content-state/,
    );
  });
});
