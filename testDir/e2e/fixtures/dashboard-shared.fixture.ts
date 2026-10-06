/**
 * Shared dashboard-launch skeleton for the dashboard E2E fixtures.
 *
 * Unifies the triplicated context / extensionId / pages()[0] / goto /
 * wait backbone previously copy-pasted across dashboard.fixture.ts,
 * dashboard-locale.fixture.ts and dashboard-issue-report.fixture.ts. Per-spec
 * differences (seed policy, locale, extra page stubs) are injected via
 * options; each caller file keeps only its seed definition.
 */
import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
  type ExtensionSeedPolicy,
} from './launchExtensionContext.js';

/** Extra per-spec browser stub injected before navigating to options.html. */
export type DashboardInitScript = {
  script: (arg: unknown) => void;
  arg?: unknown;
};

export type CreateDashboardFixtureOptions = {
  seedPolicy: ExtensionSeedPolicy;
  /**
   * Fixed browser UI locale (--lang + Playwright locale option).
   * When omitted, the Playwright `locale` fixture is forwarded instead, so
   * specs parameterized via test.use({ locale }) keep working while specs
   * without a locale pin launch exactly as before (undefined = unset).
   */
  locale?: string | undefined;
  initScript?: DashboardInitScript;
};

export type DashboardFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

export function createDashboardFixture(options: CreateDashboardFixtureOptions) {
  const { seedPolicy, initScript } = options;
  const fixedLocale = options.locale;

  const test = base.extend<DashboardFixtures>({
    context: async ({ locale }, use) => {
      const effectiveLocale = fixedLocale ?? locale ?? undefined;
      const context = await launchExtensionContext({
        ...(effectiveLocale ? { locale: effectiveLocale } : {}),
        seedPolicy,
      });
      if (!context) {
        test.fixme(true, HEADLESS_FIXME_MESSAGE);
        return;
      }
      await use(context as ChromiumBrowserContext);
      await context.close();
    },

    extensionId: async ({ context }, use) => {
      if (!context) return;
      await use(await resolveExtensionId(context));
    },

    dashboardPage: async ({ context, extensionId }, use) => {
      const pages = context.pages();
      const page: Page = pages[0] ?? (await context.newPage());

      page.on('console', msg => {
        console.log(`[Dashboard Console] ${msg.type()}: ${msg.text()}`);
      });

      if (initScript) {
        await page.addInitScript(initScript.script, initScript.arg);
      }

      await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });

      // Wait for the General panel's async mount() (getSettings() + loadGeneralSettings())
      // to finish wiring up the AI provider select listeners before tests interact with it.
      // refreshMultiVisibility() runs once during mount() and sets the default provider's
      // settings panel (Gemini) to display:block — a reliable signal that mount() completed.
      await expect(page.locator('#geminiSettings')).toBeVisible();

      await use(page);
    },
  });

  return test;
}
