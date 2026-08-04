/**
 * aiTestProgressNotifier.test.ts
 * Unit tests for the fire-and-forget progress push bridge
 * (src/background/aiTestProgressNotifier.ts).
 *
 * The notifier must never throw or leak unhandled rejections: the Dashboard
 * tab may be closed ("Could not establish connection" rejection) or the
 * Service Worker context may be invalidated mid-broadcast (synchronous
 * throw). Both paths are expected in production and must be swallowed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyAiTestProgress, AI_TEST_PROGRESS_MESSAGE_TYPE } from '../aiTestProgressNotifier.js';

describe('notifyAiTestProgress', () => {
  const progress = { provider: 'gemini', model: 'gemini-3.1-flash-lite', index: 0, total: 2 };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('レシーバなしで sendMessage が reject しても例外を伝播させない', async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    let thrown: unknown;
    try {
      notifyAiTestProgress(progress);
    } catch (err) {
      thrown = err;
    }

    // 同期 throw はしない
    expect(thrown).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress,
    });

    // reject が .catch(() => {}) で握りつぶされ、未処理 rejection が残らないこと
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('sendMessage が同期 throw しても例外を swallow する', () => {
    const sendMessage = vi.fn(() => {
      throw new Error('Extension context invalidated.');
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    expect(() => notifyAiTestProgress(progress)).not.toThrow();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('model 未指定の進捗も正しいペイロードで送信される', () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    notifyAiTestProgress({ provider: 'openai2', index: 1, total: 2 });

    expect(sendMessage).toHaveBeenCalledWith({
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress: { provider: 'openai2', index: 1, total: 2 },
    });
  });
});
