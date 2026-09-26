/**
 * obsidianClient-failureTaxonomy.test.ts
 *
 * Boundary unit: the Obsidian error transformation paths must produce
 * structured failure metadata (PBI 2026-09-25-11) while the user-facing
 * sentences stay byte-identical.
 *
 * The real `fetchWithTimeout` runs here (only `global.fetch` is stubbed), so
 * these assertions exercise the actual production conversion chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage/types.js';
import { resolveFailure, type FailureMetadata } from '../../utils/failureTaxonomy.js';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

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
    SettingsRepository: class {
      getAll = mockGetSettings;
      get = vi.fn(async (key: string) => (await mockGetSettings())?.[key]);
      getMany = getManyFromAll;
      clearCache = vi.fn();
      set = vi.fn();
      setAll = vi.fn();
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/storage/domainFilterCache.js');
vi.mock('../../utils/storage/quota.js');

/** Response body that resolves once with the given text. */
function bodyOf(text: string) {
  let sent = false;
  return {
    getReader: () => ({
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (sent) return Promise.resolve({ done: true });
        sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(text) });
      },
      cancel: async () => {},
    }),
  };
}

type FetchCall = [string, { method?: string }];
function fetchMock() {
  return vi.mocked(global.fetch) as unknown as { mock: { calls: FetchCall[] } } & ReturnType<typeof vi.fn>;
}

function errorResponse(status: number, body = 'boom'): Response {
  return { ok: false, status, body: bodyOf(body), headers: { get: () => null } } as unknown as Response;
}

let client: ObsidianClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new ObsidianClient();
  mockGetSettings.mockResolvedValue({
    OBSIDIAN_API_KEY: 'test_key',
    OBSIDIAN_PROTOCOL: 'http',
    OBSIDIAN_PORT: '27123',
    OBSIDIAN_DAILY_PATH: '',
  });
  (storage as { StorageKeys: Record<string, string> }).StorageKeys = {
    OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
    OBSIDIAN_PORT: 'OBSIDIAN_PORT',
    OBSIDIAN_HOST: 'OBSIDIAN_HOST',
    OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
    OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH',
  };
  global.fetch = vi.fn();
});

// The body-read timeout tests drive a fake clock; a leaked one would starve the
// real retry sleeps of any later test in this file.
afterEach(() => {
  vi.useRealTimers();
});

/** Drive a full appendToDailyNote where the GET 404s and the PUT gets `status`. */
async function putFailsWith(status: number, body = 'boom'): Promise<Error> {
  const fetch = fetchMock();
  fetch.mockImplementation((_url: string, init: { method?: string }) =>
    Promise.resolve(
      init?.method === 'GET'
        ? ({ ok: false, status: 404, body: bodyOf(''), headers: { get: () => null } } as unknown as Response)
        : errorResponse(status, body),
    ),
  );
  const thrown = await client.appendToDailyNote('content').catch((e: unknown) => e);
  return thrown as Error;
}

describe('Obsidian PUT status classification', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'http'],
    [503, 'http'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const error = await putFailsWith(status);
    const failure = resolveFailure(error);

    expect(failure?.kind).toBe(kind);
    expect(failure?.status).toBe(status);
    expect(failure?.method).toBe('PUT');
  });

  it('keeps the existing user-facing wording for every status', async () => {
    // Display parity: the sanitized sentence must not leak the status either.
    for (const status of [401, 403, 429, 500]) {
      const error = await putFailsWith(status);
      expect(error.message).toBe('Error: Failed to connect to Obsidian. Please check your settings and connection.');
      expect(error.message).not.toContain(String(status));
    }
  });

  it('never re-sends a 5xx inside the same request (one PUT attempt only)', async () => {
    const fetch = fetchMock();
    fetch.mockImplementation((_url: string, init: { method?: string }) =>
      Promise.resolve(
        init?.method === 'GET'
          ? ({ ok: false, status: 404, body: bodyOf(''), headers: { get: () => null } } as unknown as Response)
          : errorResponse(503),
      ),
    );

    await client.appendToDailyNote('content').catch(() => undefined);

    const puts = fetchMock().mock.calls.filter(([, init]) => init.method === 'PUT');
    expect(puts).toHaveLength(1);
  });

  it('keeps API key and response body out of the failure metadata', async () => {
    const error = await putFailsWith(401, 'Forbidden: token sk-live-SECRET-999 rejected');
    const serialized = JSON.stringify(resolveFailure(error));

    expect(serialized).not.toContain('sk-live-SECRET-999');
    expect(serialized).not.toContain('Forbidden');
    expect(error.message).not.toContain('sk-live-SECRET-999');
  });
});

describe('Obsidian network failure', () => {
  it('classifies a transport failure as network, not timeout', async () => {
    const fetch = fetchMock();
    fetch.mockImplementation((_url: string, init: { method?: string }) =>
      init?.method === 'GET'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ ok: true } as Response),
    );

    const error = (await client.appendToDailyNote('content').catch((e: unknown) => e)) as Error;

    expect(resolveFailure(error)).toEqual({
      kind: 'network',
      cause: { name: 'TypeError' },
    });
    // Display parity (https certificate hint).
    expect(error.message).toBe(
      'Error: Failed to connect to Obsidian. Please check your settings and connection.',
    );
  });

  it('keeps the https self-signed-certificate sentence', async () => {
    mockGetSettings.mockResolvedValue({
      OBSIDIAN_API_KEY: 'test_key',
      OBSIDIAN_PROTOCOL: 'https',
      OBSIDIAN_PORT: '27124',
      OBSIDIAN_DAILY_PATH: '',
    });
    const fetch = fetchMock();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await client.appendToDailyNote('content').catch((e: unknown) => e)) as Error;

    expect(error.message).toBe(
      'Error: Failed to connect to Obsidian. Please visit the Obsidian URL in a new tab and accept the self-signed certificate.',
    );
    expect(resolveFailure(error)?.kind).toBe('network');
  });
});

describe('Obsidian body-read timeout', () => {
  /** A response whose headers arrived but whose body never does. */
  function stalledBodyResponse(): Response {
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: () => new Promise<never>(() => {}), cancel: async () => {} }) },
      headers: { get: () => null },
    } as unknown as Response;
  }

  it('classifies a body read timeout as timeout and keeps its wording', async () => {
    useTimerClock();
    fetchMock().mockResolvedValue(stalledBodyResponse());

    const pending = client.appendToDailyNote('content').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15001);
    const error = (await pending) as Error;
    const failure: FailureMetadata | null = resolveFailure(error);

    expect(failure?.kind).toBe('timeout');
    expect(error.message).toBe('Error: Request timed out. Please check your Obsidian connection.');
  });

  it('keeps the AbortError name and does not link the old Error as a cause', async () => {
    useTimerClock();

    const pending = client._readBodyWithTimeout(stalledBodyResponse()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15001);
    const raw = (await pending) as Error;

    expect(raw.name).toBe('AbortError');
    // The sanitized consumer must not re-expose a raw Error whose message could
    // carry a response body, so only the name survives into the metadata.
    expect(resolveFailure(raw)).toEqual({ kind: 'timeout', cause: { name: 'AbortError' } });
  });
});
