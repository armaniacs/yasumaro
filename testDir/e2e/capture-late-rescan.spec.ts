import { test, expect } from './fixtures/extension.fixture.js';
import type { BrowserContext, Page } from '@playwright/test';
import {
  enableE2EProbe,
  readE2EProbeState,
  waitForE2EProbeInit,
} from './fixtures/e2eProbe.js';
import { seedPrivacyConsent } from './fixtures/privacyConsentSeed.js';
import { pickLoopbackPort, listenHttp } from './fixtures/localServers.js';
import { openOptionsPage } from './fixtures/dashboardSqliteHelpers.js';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/**
 * PBI 2026-10-22-06 E2E through-run: the SPA late-content re-scan (scenario A)
 * and the excluded-page reason display (scenario B), both against the real
 * content script (headed Chromium via launchExtensionContext).
 *
 * Why the wheel, not the clock: after the first report the kernel stops the
 * periodic check and the untrusted-scroll path is gated off by
 * isValidVisitReported, so checkVisitConditions only re-runs on a TRUSTED
 * scroll event. page.mouse.wheel dispatches real input (isTrusted=true);
 * page.evaluate(scrollTo) does not. Trusted wheels are therefore the only
 * remaining trigger for the re-arm check, and every settle wait below
 * alternates real wheel input with a bounded poll on production state -
 * no fixed-time wait anywhere.
 *
 * Why the settle condition is LAST_CAPTURE_OUTCOME, not the probe state:
 * the probe (E2EProbeState) carries the visit-gate state but no rescan
 * fields (reportedContentChars / lateRescanCount live on PageState, and the
 * only producer that could publish them, buildProbeState, receives no
 * PageState from its callers). The content script persists one
 * { code, at } record per settled send (captureOutcome.ts), so "at
 * advanced past the first commit" is the production signal that the
 * re-record settled; the visit-gate side of the same event is observed
 * through the probe. Publishing the rescan fields would need edits in
 * contentKernel.ts (the two buildProbeState call sites) plus the OW_PROBE_STATE
 * wire gate (src/messaging/validators.ts + messageTypes.ts) - production
 * recording-path files outside this task's edit scope.
 */

// testDir/e2e/test-pages -> served fixture pages.
const PAGES_DIR = join(process.cwd(), 'testDir/e2e/test-pages');

// Mirrors StorageKeys.LAST_CAPTURE_OUTCOME (src/utils/storage/types.ts).
// The E2E runtime cannot import from src/, so the literal is repeated here
// (same policy as the privacyConsentSeed fixture's version literal).
const LAST_CAPTURE_OUTCOME_KEY = 'last_capture_outcome';

// Mirrors LATE_RESCAN_MIN_GROWTH_CHARS (src/content/lateContentRescan.ts):
// the re-arm contract threshold this spec pins from both sides.
const LATE_RESCAN_MIN_GROWTH_CHARS = 2000;

/**
 * Shipped translations of captureFailure_domainBlocked (PBI 2026-10-22-05
 * wired the key into both locale bundles). The diagnostics panel renders the
 * locale message via getMessageOr(entry.i18nKey, last.code), and the browser
 * UI locale is environment-dependent (ja on this machine, en elsewhere), so
 * the pin accepts whichever translation the browser actually uses instead of
 * hardcoding one locale.
 */
const DOMAIN_BLOCKED_REASON_PATTERN = new RegExp(
  (['en', 'ja'] as const)
    .map((locale) => JSON.parse(
      readFileSync(join(process.cwd(), 'public/_locales', locale, 'messages.json'), 'utf-8'),
    ) as Record<string, { message?: string }>)
    .map((bundle) => bundle['captureFailure_domainBlocked']?.message)
    .filter((message): message is string => typeof message === 'string' && message !== '')
    .map((message) => message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
);

// Permitted port + static server (same pattern as the overcut spec): the
// manifest host_permissions only cover the four AI/obsidian loopback ports,
// so a page served there keeps sender.tab.url visible to the SW and the
// production manifest untouched.
let FIXTURE_PORT: number;
let FIXTURE_URL: string;
let fixtureServer: Server | undefined;

test.beforeAll(async () => {
  FIXTURE_PORT = await pickLoopbackPort();
  FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/late-rescan-page.html`;
  fixtureServer = createServer((req, res) => {
    const pathOnly = (req.url || '/').split('?')[0] || '/';
    const resolved = normalize(join(PAGES_DIR, pathOnly === '/' ? 'late-rescan-page.html' : pathOnly));
    if (!resolved.startsWith(PAGES_DIR + sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
    try {
      const body = readFileSync(resolved);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  // Await the bind: a fire-and-forget listen() races the first goto.
  await listenHttp(fixtureServer, FIXTURE_PORT);
});

test.afterAll(() => {
  fixtureServer?.close();
  fixtureServer = undefined;
});

/** Persisted last-capture record shape (captureOutcome.ts, E2E mirror). */
interface LastCaptureOutcomeView {
  code?: unknown;
  at?: unknown;
}

/** Read the persisted last-capture record from an extension page. */
function readLastCaptureOutcome(optionsPage: Page): Promise<LastCaptureOutcomeView | undefined> {
  return optionsPage.evaluate(async (key: string) => {
    const res = await chrome.storage.local.get(key);
    return res[key] as LastCaptureOutcomeView | undefined;
  }, LAST_CAPTURE_OUTCOME_KEY);
}

function commitAtOf(outcome: LastCaptureOutcomeView | undefined): number {
  return typeof outcome?.at === 'number' && Number.isFinite(outcome.at) ? outcome.at : 0;
}

/**
 * Fire one trusted wheel and wait for the check tick it drives. The probe
 * republishes the wall-clock duration on every check tick, so a strictly
 * greater value proves the tick (and its re-arm verdict) ran. Bounded poll,
 * no fixed wait.
 */
async function trustedScrollTick(page: Page, context: BrowserContext): Promise<void> {
  const durationBefore = (await readE2EProbeState(context))?.duration ?? 0;
  await page.mouse.wheel(0, 600);
  await expect(async () => {
    const state = await readE2EProbeState(context);
    expect(state, 'probe state must stay published after the first report').not.toBeNull();
    expect(state!.duration, 'the trusted wheel must drive a check tick').toBeGreaterThan(durationBefore);
  }).toPass({ timeout: 5000, intervals: [250] });
}

/**
 * Drive the gate with real wheel input until `accept` holds on the persisted
 * outcome. Each cycle fires a trusted wheel (the only post-report trigger for
 * the re-arm check) then polls with an upper bound; a cycle that does not
 * settle fires the next wheel. Bounded on both axes.
 */
async function waitForSettledCommit(
  page: Page,
  optionsPage: Page,
  accept: (outcome: LastCaptureOutcomeView) => boolean,
  cycles = 4,
): Promise<LastCaptureOutcomeView> {
  for (let cycle = 0; cycle < cycles; cycle++) {
    await page.mouse.wheel(0, 600);
    try {
      await expect(async () => {
        const outcome = await readLastCaptureOutcome(optionsPage);
        expect(accept(outcome ?? {}), `settled commit expected, got ${JSON.stringify(outcome)}`).toBe(true);
      }).toPass({ timeout: 2500, intervals: [250] });
      const settled = await readLastCaptureOutcome(optionsPage);
      if (settled !== undefined) return settled;
    } catch {
      // The gate check is trusted-scroll-driven; fire the next wheel and retry.
    }
  }
  const last = await readLastCaptureOutcome(optionsPage);
  return last ?? {};
}

test.describe('Capture Late Rescan @extension', () => {
  test('A: late-content re-scan re-records after the body grows past the contract', async ({ context, extensionId }) => {
    await test.step('Grant privacy consent so the SW processes the recording', async () => {
      await seedPrivacyConsent(context);
    });

    const page = await context.newPage();
    // Probe is armed extension-side (session flag) - must precede navigation.
    await enableE2EProbe(context);
    await page.goto(FIXTURE_URL);
    await waitForE2EProbeInit(context);

    await test.step('Initial recording: scroll + stay closes the gate', async () => {
      // 70% of the max scrollable distance (not of scrollHeight, which clamps
      // to the bottom): the wheel-driven ticks below need room to scroll.
      await page.evaluate(() => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.max(0, maxScroll) * 0.7);
      });
      await expect(async () => {
        const state = await readE2EProbeState(context);
        expect(state).not.toBeNull();
        expect(state!.isValidVisitReported).toBe(true);
      }).toPass({ timeout: 20000, intervals: [500] });
    });

    const optionsPage = await openOptionsPage(context, extensionId);
    try {
      let firstCommitAt = 0;
      await test.step('Initial recording landed: legacy row + recorded outcome', async () => {
        await expect(async () => {
          const stored = await optionsPage.evaluate(async () => {
            const res = await chrome.storage.local.get('savedUrlsWithTimestamps');
            return (res.savedUrlsWithTimestamps as Array<Record<string, unknown>>) ?? [];
          });
          expect(
            stored.some((entry) => entry['url'] === FIXTURE_URL),
            'the initial VALID_VISIT must be recorded before the growth step',
          ).toBe(true);
        }).toPass({ timeout: 20000, intervals: [500] });

        await expect(async () => {
          const outcome = await readLastCaptureOutcome(optionsPage);
          expect(outcome?.code).toBe('recorded');
        }).toPass({ timeout: 10000, intervals: [500] });
        firstCommitAt = commitAtOf(await readLastCaptureOutcome(optionsPage));
        expect(firstCommitAt).toBeGreaterThan(0);
      });

      await test.step('Sub-threshold growth does not re-open the gate', async () => {
        // A growth below max(2000, full text) must never qualify: this pins
        // the threshold from the negative side, so "at advanced" below can
        // only mean the contract growth re-opened the gate. The paragraph is
        // appended to the body (outside the fixed-height main) so the page
        // actually grows and the wheel below fires a real scroll event.
        await page.evaluate((chars) => {
          const filler = 'SPA short append. ';
          const p = document.createElement('p');
          p.textContent = filler.repeat(Math.ceil(chars / filler.length) + 1);
          document.body.appendChild(p);
        }, Math.floor(LATE_RESCAN_MIN_GROWTH_CHARS / 5));
        // Drive at least one check tick over the grown page, then assert the
        // outcome did not settle again inside that window.
        await trustedScrollTick(page, context);
        const afterSmallGrowth = await readLastCaptureOutcome(optionsPage);
        expect(
          commitAtOf(afterSmallGrowth),
          `sub-threshold growth must not re-record: ${JSON.stringify(afterSmallGrowth)}`,
        ).toBe(firstCommitAt);
      });

      await test.step('Flood-guard window clears before the re-send', async () => {
        // The per-origin VALID_VISIT flood guard (visitRateLimiter, 5s window)
        // is a production gate the re-send must clear. Real time is what the
        // code is about here (AGENTS.md exception: rate-limited gate), so the
        // wait is a bounded poll on the elapsed wall clock, not a fixed sleep.
        await expect
          .poll(async () => Date.now() - firstCommitAt, { timeout: 6000, intervals: [250] })
          .toBeGreaterThanOrEqual(5000);
      });

      await test.step('Contract growth re-arms the gate and re-records', async () => {
        // Grow the body past max(2000, full text) + margin via real DOM
        // append: the growth contract this spec pins, measured on the same
        // visible text the re-arm verdict reads (document.body.innerText).
        // Appended to the body, outside the fixed-height main, so the page
        // grows and the trusted wheel below has room to scroll.
        await page.evaluate((chars) => {
          const full = (document.body.innerText ?? '').length;
          const target = Math.max(chars, full) + 1000;
          const filler = 'SPA late-loaded batch paragraph. ';
          const p = document.createElement('p');
          p.textContent = filler.repeat(Math.ceil(target / filler.length) + 1);
          document.body.appendChild(p);
        }, LATE_RESCAN_MIN_GROWTH_CHARS);

        const settled = await waitForSettledCommit(page, optionsPage, (outcome) => {
          return commitAtOf(outcome) > firstCommitAt && outcome.code === 'recorded';
        });
        expect(
          commitAtOf(settled),
          `the re-record never settled after the contract growth: ${JSON.stringify(settled)}`,
        ).toBeGreaterThan(firstCommitAt);
        expect(settled.code).toBe('recorded');
      });

      await test.step('The saved row keeps the first excerpt (finding-1 bug behavior)', async () => {
        // Negation-only observation, not a pinned contract: the re-send
        // clears the flood guard but the SW's same-day duplicate gate
        // answers success + skip, so the late batch reaches the pipeline yet
        // the stored row still carries the first excerpt (reported as a
        // contract gap).
        // Review note: this assert pins the CURRENT behavior of review
        // finding 1 - the stored row is NOT updated on a same-day duplicate.
        // Implementing the finding-1 fix (row update) BREAKS this assert;
        // rewrite it to the post-fix contract (the row carries the late
        // batch) at that point.
        const stored = await optionsPage.evaluate(async () => {
          const res = await chrome.storage.local.get('savedUrlsWithTimestamps');
          return (res.savedUrlsWithTimestamps as Array<Record<string, unknown>>) ?? [];
        });
        const entry = stored.find((e) => e['url'] === FIXTURE_URL);
        expect(entry, 'the initial row must still exist').toBeDefined();
        expect(String(entry!['content'] ?? '')).not.toContain('SPA late-loaded batch paragraph.');
      });
    } finally {
      await optionsPage.close();
    }
    await page.close();
  });

  test('B: excluded page explains its reason in the diagnostic display', async ({ context, extensionId }) => {
    await test.step('Grant privacy consent so the recording reaches the pipeline gates', async () => {
      await seedPrivacyConsent(context);
    });

    const page = await context.newPage();
    await enableE2EProbe(context);
    await page.goto(FIXTURE_URL);
    await waitForE2EProbeInit(context);

    await test.step('Seed the denial after injection', async () => {
      // The loader's admission already ran with an empty blacklist (the page
      // was recorded-eligible at load), so the content script is live and the
      // pipeline's domainFilter gate is what rejects the visit. Seeding
      // before navigation would instead keep the loader from injecting the
      // extractor at all: no content script, no probe, no settled verdict.
      // The page is served on a permitted loopback port so sender.tab.url is
      // real and the user's domain filter is the actual trigger.
      await seedPrivacyConsent(context, { domain_blacklist: ['127.0.0.1'] });
    });

    await test.step('When: the excluded page is opened and its recording state settles', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
      await expect(async () => {
        const state = await readE2EProbeState(context);
        expect(state).not.toBeNull();
        expect(state!.isValidVisitReported).toBe(true);
      }).toPass({ timeout: 20000, intervals: [500] });
    });

    const optionsPage = await openOptionsPage(context, extensionId);
    try {
      await test.step('Then: the settled verdict persisted the exclusion reason', async () => {
        await expect(async () => {
          const outcome = await readLastCaptureOutcome(optionsPage);
          expect(
            outcome?.code,
            `expected the domain-filter denial to persist, got ${JSON.stringify(outcome)}`,
          ).toBe('DOMAIN_BLOCKED');
        }).toPass({ timeout: 10000, intervals: [500] });
      });

      await test.step('Then: the diagnostics display shows the reason', async () => {
        // Settings children (Diagnostics included) stay collapsed until the
        // Initial Setup button is pressed (DashboardBootstrapper
        // #setSettingsExpanded(false) on wire) - the same pattern the other
        // dashboard specs use.
        await optionsPage.locator('button[data-panel="panel-general"]').click();
        await optionsPage.locator('button[data-panel="panel-diagnostics"]').click();
        const captureSection = optionsPage.locator('#diagCaptureStats');
        // PBI 2026-10-22-05 wired the captureFailure_domainBlocked i18n key,
        // so the panel renders the locale message through
        // getMessageOr(entry.i18nKey, last.code) - the pin expects the
        // translated text, and the raw code is the fallback only while the
        // key is unwired (this spec ran green against the raw code before
        // the wiring landed). The refusal itself is still pinned upstream
        // through the persisted outcome (code === 'DOMAIN_BLOCKED').
        await expect(captureSection).toContainText(DOMAIN_BLOCKED_REASON_PATTERN, { timeout: 15000 });
        // The unwired fallback (raw code) must not surface now that the
        // translation exists in both locale bundles.
        await expect(captureSection).not.toContainText('DOMAIN_BLOCKED', { timeout: 5000 });
        await expect(captureSection).toContainText('excluded (', { timeout: 5000 });
        await expect(captureSection).not.toContainText('unlisted reason', { timeout: 5000 });
      });
    } finally {
      await optionsPage.close();
    }
    await page.close();
  });
});
