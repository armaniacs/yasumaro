/**
 * Unit tests for the unified E2E launch helper (launchExtensionContext).
 *
 * No real browser is launched: chromium.launchPersistentContext is mocked, the
 * service-worker race guard is driven on a fake setTimeout clock, and the seed
 * init script is invoked directly against a stubbed chrome.storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromium } from '@playwright/test';
import {
  EXTENSION_PATH,
  EXTENSION_ID_TIMEOUT_MS,
  SERVICE_WORKER_TIMEOUT_MS,
  HEADLESS_FIXME_MESSAGE,
  launchExtensionContext,
  resolveExtensionId,
  seedInitScript,
  type ExtensionSeedPolicy,
} from '../e2e/fixtures/launchExtensionContext.js';

vi.mock('@playwright/test', () => ({
  chromium: { launchPersistentContext: vi.fn() },
}));

const mockLaunch = vi.mocked(chromium.launchPersistentContext);

type FakeContext = {
  serviceWorkers: ReturnType<typeof vi.fn>;
  waitForEvent: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeFakeContext(serviceWorkers: unknown[] = []): FakeContext {
  return {
    serviceWorkers: vi.fn().mockReturnValue(serviceWorkers),
    waitForEvent: vi.fn().mockResolvedValue({
      url: () => 'chrome-extension://eventid/background.js',
    }),
    addInitScript: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function captureSeeds(): { set: ReturnType<typeof vi.fn>; payloads: Array<Record<string, unknown>> } {
  const payloads: Array<Record<string, unknown>> = [];
  const set = vi.fn((payload: Record<string, unknown>) => payloads.push(payload));
  vi.stubGlobal('chrome', { storage: { local: { set } } });
  return { set, payloads };
}

const FIXED_NOW = 1759468800000;

describe('seedInitScript (explicit seed policy)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('popup.fixture policy seeds only privacyConsent + settings_migrated', () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({ consent: true, settingsMigrated: true });
    expect(set).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
      settings_migrated: true,
    });
  });

  it('dashboard.fixture policy seeds no priority list (synthesize path)', () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({
      consent: true,
      breakingChangesShown: true,
      provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
      breaking_changes_v5_shown: true,
      ai_provider: 'gemini',
      ai_provider_layout: 'a',
    });
    expect(payloads[0]).not.toHaveProperty('ai_provider_priority_list');
    expect(payloads[0]).not.toHaveProperty('settings_migrated');
    expect(payloads[0]).not.toHaveProperty('settings');
  });

  it('popup-pbi27 / cleansing-preview policy seeds the onboarding blob', () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({ consent: true, settingsMigrated: true, onboardingCompleted: true });
    expect(set).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
      settings_migrated: true,
      settings: { onboarding_wizard_completed: true },
    });
  });

  it('dashboard-issue-report policy mirrors flat seeds into the settings blob', () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({
      consent: true,
      settingsMigrated: true,
      breakingChangesShown: true,
      provider: {
        name: 'gemini',
        layout: 'a',
        priorityList: 'empty',
        apiKey: 'test-secret-key-should-never-leak',
      },
    });
    expect(set).toHaveBeenCalledTimes(1);
    const seedSettings = {
      ai_provider: 'gemini',
      ai_provider_priority_list: [],
      ai_provider_layout: 'a',
      gemini_api_key: 'test-secret-key-should-never-leak',
    };
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
      settings_migrated: true,
      breaking_changes_v5_shown: true,
      ...seedSettings,
      settings: seedSettings,
    });
  });

  it("dashboard-locale policy seeds an explicit empty priority list (drift knob)", () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({
      consent: true,
      settingsMigrated: true,
      breakingChangesShown: true,
      provider: { name: 'gemini', layout: 'a', priorityList: 'empty' },
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
      settings_migrated: true,
      breaking_changes_v5_shown: true,
      ai_provider: 'gemini',
      ai_provider_priority_list: [],
      ai_provider_layout: 'a',
    });
    expect(payloads[0]).not.toHaveProperty('settings');
  });

  it('empty policy seeds only the default privacyConsent', () => {
    const { set, payloads } = captureSeeds();
    seedInitScript({});
    expect(set).toHaveBeenCalledTimes(1);
    expect(payloads[0]).toEqual({
      privacyConsent: { accepted: true, timestamp: FIXED_NOW },
    });
  });

  it('consent: false opts out of every seed', () => {
    const { set } = captureSeeds();
    seedInitScript({ consent: false });
    expect(set).not.toHaveBeenCalled();
  });
});

describe('launchExtensionContext', () => {
  beforeEach(() => {
    mockLaunch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the canonical launch args (SW allow, host-resolver-rules, extension path)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([{ url: () => 'chrome-extension://id/sw.js' }]);
    mockLaunch.mockResolvedValue(context as never);

    const result = await launchExtensionContext();

    expect(result).toBe(context);
    expect(context.close).not.toHaveBeenCalled();
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    const options = mockLaunch.mock.calls[0]![1]!;
    expect(options.serviceWorkers).toBe('allow');
    expect(options.acceptDownloads).toBe(true);
    expect(options.channel).toBe('chromium');
    expect(options.args).toContain(
      `--disable-extensions-except=${EXTENSION_PATH}`,
    );
    expect(options.args).toContain(`--load-extension=${EXTENSION_PATH}`);
    expect(options.args).toContain(
      '--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443',
    );
    expect(options.args).toContain('--ignore-certificate-errors');
    vi.clearAllTimers();
  });

  it('applies the seed policy via context.addInitScript', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([{ url: () => 'chrome-extension://id/sw.js' }]);
    mockLaunch.mockResolvedValue(context as never);
    const policy: ExtensionSeedPolicy = {
      consent: true,
      settingsMigrated: true,
    };

    await launchExtensionContext({ seedPolicy: policy });

    expect(context.addInitScript).toHaveBeenCalledTimes(1);
    expect(context.addInitScript).toHaveBeenCalledWith(seedInitScript, policy);
    vi.clearAllTimers();
  });

  it('sets the locale option and --lang arg together when a locale is given', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([{ url: () => 'chrome-extension://id/sw.js' }]);
    mockLaunch.mockResolvedValue(context as never);

    await launchExtensionContext({ locale: 'ja' });

    const options = mockLaunch.mock.calls[0]![1]!;
    expect(options.locale).toBe('ja');
    expect(options.args).toContain('--lang=ja');
    vi.clearAllTimers();
  });

  it('sets no locale option or --lang arg by default', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([{ url: () => 'chrome-extension://id/sw.js' }]);
    mockLaunch.mockResolvedValue(context as never);

    await launchExtensionContext();

    const options = mockLaunch.mock.calls[0]![1]!;
    expect(options.locale).toBeUndefined();
    expect(options.args?.some((arg) => arg.startsWith('--lang='))).toBe(false);
    vi.clearAllTimers();
  });

  it('returns null when launch throws (headless skip contract)', async () => {
    mockLaunch.mockRejectedValue(new Error('headless environment'));

    const result = await launchExtensionContext();

    expect(result).toBeNull();
    expect(HEADLESS_FIXME_MESSAGE.length).toBeGreaterThan(0);
  });

  it('closes the context and returns null when the service worker never starts (bounded race guard)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([]);
    mockLaunch.mockResolvedValue(context as never);

    const pending = launchExtensionContext();
    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_TIMEOUT_MS + 1000);

    expect(await pending).toBeNull();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.waitForEvent).not.toHaveBeenCalled();
  });

  it('resolves as soon as the service worker registers, before the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const context = makeFakeContext([]);
    mockLaunch.mockResolvedValue(context as never);

    const pending = launchExtensionContext();
    // The guard polls every 200ms; make the SW appear after the first poll.
    await vi.advanceTimersByTimeAsync(400);
    context.serviceWorkers.mockReturnValue([{ url: () => 'chrome-extension://id/sw.js' }]);
    await vi.advanceTimersByTimeAsync(400);

    expect(await pending).toBe(context);
    expect(context.close).not.toHaveBeenCalled();
    vi.clearAllTimers();
  });
});

describe('resolveExtensionId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses an already-registered service worker without waiting', async () => {
    const context = makeFakeContext([{ url: () => 'chrome-extension://id123/sw.js' }]);

    const id = await resolveExtensionId(context as never);

    expect(id).toBe('id123');
    expect(context.waitForEvent).not.toHaveBeenCalled();
  });

  it('waits for the serviceworker event with a bounded timeout (never unbounded)', async () => {
    const context = makeFakeContext([]);

    const id = await resolveExtensionId(context as never);

    expect(id).toBe('eventid');
    expect(context.waitForEvent).toHaveBeenCalledTimes(1);
    const [, options] = context.waitForEvent.mock.calls[0]!;
    expect(options).toEqual({ timeout: EXTENSION_ID_TIMEOUT_MS });
    expect(typeof options.timeout).toBe('number');
  });

  it('honors a custom timeout override', async () => {
    const context = makeFakeContext([]);

    await resolveExtensionId(context as never, 15000);

    expect(context.waitForEvent).toHaveBeenCalledWith('serviceworker', {
      timeout: 15000,
    });
  });
});
