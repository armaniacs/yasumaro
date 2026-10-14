/**
 * confirmTokenMaxCap.test.ts
 * PBI 2026-10-14-01: the confirm-token session map must stay bounded under
 * create-spam (pruneExpired alone only runs on traffic and removes merely
 * expired entries).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logWarn: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'E1', STORAGE_WRITE_FAILURE: 'E2' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logWarn: 'fn',
  }),
);
vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import {
  createConfirmToken,
  verifyConfirmToken,
  CONFIRM_TOKENS_SESSION_KEY,
  MAX_CONFIRM_TOKENS,
} from '../confirmTokenManager.js';

/** In-memory stand-in for chrome.storage.session. */
let sessionData: Record<string, unknown> = {};

function installChromeSessionMock(): void {
  const session = {
    get: vi.fn(async (key: string | null) => {
      if (key === null) return { ...sessionData };
      return key in sessionData ? { [key]: sessionData[key] } : {};
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionData[k];
    }),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { session } };
}

function readMap(): Record<string, { expiresAt: number }> {
  return (sessionData[CONFIRM_TOKENS_SESSION_KEY] as Record<string, { expiresAt: number }>) ?? {};
}

beforeEach(() => {
  sessionData = {};
  vi.clearAllMocks();
  installChromeSessionMock();
});

describe('confirmTokenManager MAX cap', () => {
  it('keeps the live map at or below MAX_CONFIRM_TOKENS under create-spam', async () => {
    const created: string[] = [];
    for (let i = 0; i < MAX_CONFIRM_TOKENS + 5; i++) {
      created.push(await createConfirmToken('delete', i));
    }
    expect(Object.keys(readMap()).length).toBeLessThanOrEqual(MAX_CONFIRM_TOKENS);
  });

  it('evicts oldest-expiring entries first', async () => {
    const created: string[] = [];
    for (let i = 0; i < MAX_CONFIRM_TOKENS + 1; i++) {
      created.push(await createConfirmToken('delete', i));
    }
    const map = readMap();
    // Stable sort on equal expiresAt evicts the earliest-inserted entry.
    expect(map[created[0]!]).toBeUndefined();
    expect(map[created[created.length - 1]!]).toBeDefined();
  });

  it('still verifies an unconsumed token (cap does not break the happy path)', async () => {
    const token = await createConfirmToken('delete', 7);
    await expect(verifyConfirmToken(token, 'delete', 7)).resolves.toBe(true);
  });
});
