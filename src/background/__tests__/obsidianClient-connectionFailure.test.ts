/**
 * obsidianClient-connectionFailure.test.ts
 *
 * PBI 2026-09-26-09: the Dashboard's certificate guidance must be driven by
 * `failure.kind`, never by a `message` substring. Two levels are pinned here:
 *
 * 1. Boundary unit — `testConnection` attaches a kind to every failure it
 *    classifies, while its user-facing sentences stay byte-identical.
 * 2. Integration — the kind survives the real
 *    MessageRouter → TestObsidianValidator → testingHandlers path and lands on
 *    the response envelope, which is the payload the Dashboard actually reads.
 *
 * The previous display condition (`message.includes('Failed to fetch')`) could
 * never fire in production because this boundary rewrites that message before
 * returning it; the envelope assertions below are what make that regression
 * impossible to reintroduce silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObsidianClient } from '../obsidianClient.js';
import { createMessageRouter } from '../handlers/MessageRouter.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';
import { NoOpOfflineNetworkQueue } from '../offlineNetworkQueue.js';
import * as storage from '../../utils/storage/types.js';

const mockGetSettings = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/types.js');
vi.mock('../../utils/storage/defaults.js');
vi.mock('../../utils/storage/encryptionSession.js');
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const getManyFromAll = async (keys: readonly string[]) => {
    const all = (await mockGetSettings()) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = all?.[k];
    return out;
  };
  return {
    ...actual,
    settingsRepository: {
      ...(actual.settingsRepository as Record<string, unknown>),
      getAll: mockGetSettings,
      get: vi.fn(async (key: string) => (await mockGetSettings())?.[key]),
      getMany: getManyFromAll,
      clearCache: vi.fn(),
      set: vi.fn(),
      setAll: vi.fn(),
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/storage/domainFilterCache.js');
vi.mock('../../utils/storage/quota.js');

const OVERRIDE = { apiKey: 'test-key', protocol: 'https', port: '27124', host: '127.0.0.1' };

/** An error shaped like a browser abort: the transport sets the name only. */
function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

let client: ObsidianClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new ObsidianClient({ sleep: async () => {} });
  mockGetSettings.mockResolvedValue({});
  (storage as { StorageKeys: Record<string, string> }).StorageKeys = {
    OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
    OBSIDIAN_PORT: 'OBSIDIAN_PORT',
    OBSIDIAN_HOST: 'OBSIDIAN_HOST',
    OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
    OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH',
  };
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('testConnection failure metadata (boundary)', () => {
  it('tags a browser fetch TypeError as network while keeping the SSOT sentence', async () => {
    // Chrome raises `Failed to fetch`, Firefox raises a differently-worded
    // TypeError. Both must classify identically, which is why the Dashboard
    // branches on the kind.
    for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.']) {
      vi.mocked(global.fetch).mockRejectedValue(new TypeError(message));

      const result = await client.testConnection(OVERRIDE);

      expect(result.success).toBe(false);
      expect(result.failure).toEqual({ kind: 'network', cause: { name: 'TypeError' } });
      expect(result.message).toBe('Cannot connect. Check if Obsidian is running and Local REST API is enabled.');
    }
  });

  it('tags an AbortError as timeout, not network', async () => {
    vi.mocked(global.fetch).mockRejectedValue(abortError());

    const result = await client.testConnection(OVERRIDE);

    expect(result.failure).toEqual({ kind: 'timeout', cause: { name: 'AbortError' } });
    expect(result.message).toBe('Connection timeout. Is Obsidian running?');
  });

  it('omits failure metadata on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

    const result = await client.testConnection(OVERRIDE);

    expect(result.success).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('claims no kind for an error it cannot classify', async () => {
    // An unknown error is evidence of no specific cause; a `network` claim here
    // would make the Dashboard promise a certificate walkthrough it cannot
    // justify.
    vi.mocked(global.fetch).mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'WeirdError' }));

    const result = await client.testConnection(OVERRIDE);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection error');
    expect(result.failure).toBeUndefined();
  });

  it('tags a config-build rejection as configuration and never leaks the raw error', async () => {
    const result = await client.testConnection({ ...OVERRIDE, host: 'bad host' });

    expect(result.success).toBe(false);
    expect(result.failure?.kind).toBe('configuration');
    expect(result.message).toBe('Obsidian host contains invalid characters.');
  });

  it('keeps the failure metadata free of the message and the API key', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('Failed to fetch for https://127.0.0.1:27124/ with key test-key'));

    const result = await client.testConnection(OVERRIDE);
    const serialized = JSON.stringify(result.failure);

    expect(serialized).not.toContain('test-key');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('Failed to fetch');
  });
});

describe('TEST_OBSIDIAN envelope carries the kind (integration)', () => {
  function routerWith(client_: ObsidianClient) {
    return createMessageRouter({
      runtimeId: 'test-id',
      recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) },
      tabCache: { add: vi.fn(), update: vi.fn() },
      obsidian: client_,
      aiService: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      recordingAdmission: {},
      fetchManualContent: undefined as never,
      fetchRegenerated: undefined as never,
      setUrlContent: undefined as never,
      buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
      getSettings: vi.fn().mockResolvedValue({}),
      isDomainAllowed: vi.fn().mockResolvedValue(true),
      clearSettingsCache: vi.fn(),
      notifyAiTestProgress: vi.fn(),
      getPrivacyCache: vi.fn().mockReturnValue(null),
      updateActivity: vi.fn().mockResolvedValue(undefined),
      lockSession: vi.fn().mockResolvedValue(undefined),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
      initExportScheduler: vi.fn().mockResolvedValue(undefined),
      updateConsentBadge: vi.fn().mockResolvedValue(undefined),
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn().mockResolvedValue(true),
      dashboardSqliteHandler: vi.fn(),
      offlineNetworkQueue: new NoOpOfflineNetworkQueue(),
    } as unknown as Parameters<typeof createMessageRouter>[0]);
  }

  async function dispatchTestObsidian(): Promise<{ success: true; obsidian: { success: boolean; message: string; failure?: { kind: string } } }> {
    const router = routerWith(client);
    const sendResponse = vi.fn();
    const handled = router.dispatch(
      { type: 'TEST_OBSIDIAN', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: { ...OVERRIDE } },
      { id: 'test-id' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    return sendResponse.mock.calls[0]?.[0] as never;
  }

  it('puts kind network on the envelope for a TypeError', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const envelope = await dispatchTestObsidian();

    expect(envelope.success).toBe(true);
    expect(envelope.obsidian.failure).toEqual({ kind: 'network', cause: { name: 'TypeError' } });
    // The sentence the Dashboard renders carries no transport wording, which is
    // exactly why the old substring condition could not work.
    expect(envelope.obsidian.message).not.toContain('Failed to fetch');
  });

  it('puts kind timeout on the envelope for an AbortError', async () => {
    vi.mocked(global.fetch).mockRejectedValue(abortError());

    const envelope = await dispatchTestObsidian();

    expect(envelope.obsidian.failure).toEqual({ kind: 'timeout', cause: { name: 'AbortError' } });
  });

  it('leaves the envelope free of failure metadata on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

    const envelope = await dispatchTestObsidian();

    expect(envelope.obsidian).toEqual({ success: true, message: 'Success! Connected to Obsidian. Settings Saved.' });
  });
});
