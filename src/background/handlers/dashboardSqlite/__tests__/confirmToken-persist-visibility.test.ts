import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/logger/api.js', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { createConfirmToken, verifyConfirmToken, __resetConfirmTokensForTesting } from '../../../confirmTokenManager.js';
import { logWarn } from '../../../../utils/logger/api.js';

describe('confirmToken persist visibility (PBI 06)', () => {
  const session = () => (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.session;

  beforeEach(async () => {
    vi.clearAllMocks();
    await __resetConfirmTokensForTesting();
  });
  afterEach(async () => {
    await __resetConfirmTokensForTesting();
  });

  it('logs (instead of swallowing) when the consume-save fails, still returning true', async () => {
    const token = await createConfirmToken('delete', 1);
    const realSet = session().set;
    (session() as unknown as Record<string, unknown>).set = vi.fn().mockRejectedValue(new Error('quota'));
    try {
      expect(await verifyConfirmToken(token, 'delete', 1)).toBe(true);
    } finally {
      (session() as unknown as Record<string, unknown>).set = realSet;
    }
    expect(logWarn).toHaveBeenCalledWith(
      'Confirm token map save after consume failed',
      expect.objectContaining({ error: 'quota' }),
      expect.anything(),
      'confirmTokenManager',
    );
  });

  it('logs (instead of swallowing) when the test-reset remove fails, still resolving', async () => {
    const realRemove = session().remove;
    (session() as unknown as Record<string, unknown>).remove = vi.fn().mockRejectedValue(new Error('gone'));
    try {
      await expect(__resetConfirmTokensForTesting()).resolves.toBeUndefined();
    } finally {
      (session() as unknown as Record<string, unknown>).remove = realRemove;
    }
    expect(logWarn).toHaveBeenCalledWith(
      'Confirm token map reset failed',
      expect.objectContaining({ error: 'gone' }),
      expect.anything(),
      'confirmTokenManager',
    );
  });
});
