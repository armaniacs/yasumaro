/**
 * Single launch path for every E2E extension context (8 call sites / 3 prior
 * variants unified onto the canonical extension.fixture procedure).
 *
 * Always applies, at launch time:
 * - the extension service-worker race guard (bounded), so a context whose SW
 *   never registers is closed and reported as null instead of hanging later
 *   on an unbounded `waitForEvent('serviceworker')`
 * - `serviceWorkers: 'allow'` — without it the DASHBOARD_SQLITE handler in the
 *   SW never wakes and messages time out (E2E blocker resolved 2026-09-06)
 * - `--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443` + TLS-ignore:
 *   extension-created tabs lose the Playwright interception attach race on
 *   their MAIN document request (context.route/page.route never see it →
 *   chrome-error page → no content script → GET_CONTENT "receiving end").
 *   Mapping the host to the spec's local TLS server lets tabs.create
 *   navigation resolve locally without interception. Only api.openai.com:443
 *   is remapped (no spec tests that origin); --ignore-certificate-errors only
 *   matters for TLS and every other spec talks plain http://localhost.
 *
 * Callers own the fixme: a null return means "this environment cannot run
 * extension tests" (headless CI, SSH, background processes) and the fixture
 * calls test.fixme() with HEADLESS_FIXME_MESSAGE.
 *
 * Seed drift (ai_provider_priority_list) is closed structurally: every fixture
 * declares its seed policy explicitly via LaunchExtensionContextOptions.
 */
import { chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// WXT outputs to dist/<browser>-mv3/ directory
export const EXTENSION_PATH = path.join(__dirname, '../../../dist/chromium-mv3');

const SERVICE_WORKER_POLL_INTERVAL_MS = 200;
export const SERVICE_WORKER_TIMEOUT_MS = 5000;

/** Bounded fallback timeout for the extensionId wait (canonical value). */
export const EXTENSION_ID_TIMEOUT_MS = 10000;

export const HEADLESS_FIXME_MESSAGE =
  'Extension tests require headed Chrome (Manifest V3 service workers unsupported in headless)';

/**
 * Drift knob for `ai_provider_priority_list`:
 * - 'synthesize': seed no flat priority list. The SW's deferred migration
 *   folds the legacy flat keys into the versioned `settings` blob and
 *   synthesizes the provider priority list from ai_provider — the same path a
 *   real upgrading user takes.
 * - 'empty': seed an explicit `ai_provider_priority_list: []`.
 *   applyMigrationsCore treats an explicitly empty list as "user-configured"
 *   and suppresses that synthesis, leaving every provider settings block
 *   hidden after the first settings write creates the blob (the failure that
 *   broke the domain-filter e2e on 2026-09-19). Only pick this when the spec
 *   under test actually needs a user-configured (empty) list.
 */
export type ProviderPriorityListSeed = 'synthesize' | 'empty';

export type ProviderSeedPolicy = {
  /** flat ai_provider value */
  name?: string;
  /** flat ai_provider_layout value */
  layout?: string;
  /** see ProviderPriorityListSeed */
  priorityList?: ProviderPriorityListSeed;
  /** gemini_api_key seed; also mirrors the provider flat keys into the versioned settings blob */
  apiKey?: string;
};

/**
 * Storage seeds applied to every page in the context via addInitScript before
 * any fixture navigates. Every field is explicit — no fixture-level seed
 * script can silently reintroduce the forbidden ai_provider_priority_list.
 */
export type ExtensionSeedPolicy = {
  /** seed privacyConsent as accepted (default: true) */
  consent?: boolean;
  /** legacy flat settings_migrated flag */
  settingsMigrated?: boolean;
  /** breaking_changes_v5_shown flag */
  breakingChangesShown?: boolean;
  /** provider settings seeds */
  provider?: ProviderSeedPolicy;
  /** settings.onboarding_wizard_completed via the versioned blob */
  onboardingCompleted?: boolean;
};

export type LaunchExtensionContextOptions = {
  /**
   * Browser UI locale. Sets both the Playwright `locale` context option and
   * `--lang` — chrome.i18n.getMessage() resolves against the browser UI
   * locale, which Playwright's `locale` option alone cannot set.
   * (undefined = unset; `string | undefined` so the Playwright `locale`
   * fixture can be passed through under exactOptionalPropertyTypes.)
   */
  locale?: string | undefined;
  /** storage seeds, see ExtensionSeedPolicy */
  seedPolicy?: ExtensionSeedPolicy;
};

/**
 * Runs inside the browser (serialized by Playwright): builds the storage
 * payload from the policy and seeds it before any page script runs. The
 * payload construction mirrors the pre-unification fixture seeds exactly;
 * see testDir/__tests__/launchExtensionContext.test.ts for the parity table.
 */
export function seedInitScript(policy: ExtensionSeedPolicy): void {
  const storage: Record<string, unknown> = {};
  if (policy.consent !== false) {
    storage.privacyConsent = { accepted: true, timestamp: Date.now() };
  }
  if (policy.settingsMigrated) storage.settings_migrated = true;
  if (policy.breakingChangesShown) storage.breaking_changes_v5_shown = true;

  const provider = policy.provider;
  const flat: Record<string, unknown> = {};
  if (provider?.name) flat.ai_provider = provider.name;
  if (provider?.layout) flat.ai_provider_layout = provider.layout;
  // 'synthesize' deliberately seeds no flat list — an explicit [] would be
  // treated as user-configured and suppress the SW's synthesis.
  if (provider?.priorityList === 'empty') flat.ai_provider_priority_list = [];
  if (provider?.apiKey) flat.gemini_api_key = provider.apiKey;
  Object.assign(storage, flat);
  if (provider?.apiKey) storage.settings = { ...flat };

  if (policy.onboardingCompleted) {
    storage.settings = {
      ...((storage.settings as Record<string, unknown> | undefined) ?? {}),
      onboarding_wizard_completed: true,
    };
  }

  if (Object.keys(storage).length > 0) chrome.storage.local.set(storage);
}

/** Bounded service-worker presence wait: poll, never hang (canonical logic). */
export function waitForServiceWorker(context: BrowserContext): Promise<boolean> {
  return Promise.race([
    new Promise<boolean>((resolve) => {
      const check = () => {
        if (context.serviceWorkers().length > 0) {
          resolve(true);
        } else {
          setTimeout(check, SERVICE_WORKER_POLL_INTERVAL_MS);
        }
      };
      check();
    }),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), SERVICE_WORKER_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Launch a persistent Chromium context with the extension loaded, wait for
 * its service worker (bounded), and apply the seed policy. Returns null when
 * the environment does not support extension testing (launch failure, or the
 * service worker never registered) — the caller applies test.fixme().
 */
export async function launchExtensionContext(
  options: LaunchExtensionContextOptions = {},
): Promise<BrowserContext | null> {
  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443',
    '--ignore-certificate-errors',
  ];
  if (options.locale) args.push(`--lang=${options.locale}`);

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      ...(options.locale ? { locale: options.locale } : {}),
      args,
      serviceWorkers: 'allow',
      acceptDownloads: true,
    });
  } catch {
    // Failed to launch — likely headless environment.
    return null;
  }

  if (options.seedPolicy) {
    context.addInitScript(seedInitScript, options.seedPolicy);
  }

  const started = await waitForServiceWorker(context);
  if (!started) {
    // Extension SW did not start — headed mode needed.
    await context.close().catch(() => undefined);
    return null;
  }
  return context;
}

/**
 * Bounded extensionId extraction. The launch guard normally leaves the SW
 * already registered; the waitForEvent fallback only covers the window where
 * the SW object list has not been refreshed yet, and must not hang.
 */
export async function resolveExtensionId(
  context: BrowserContext,
  timeoutMs = EXTENSION_ID_TIMEOUT_MS,
): Promise<string> {
  const serviceWorker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker', { timeout: timeoutMs }));
  return serviceWorker.url().split('/')[2] ?? '';
}
