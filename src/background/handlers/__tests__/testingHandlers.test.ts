import { describe, it, expect, vi } from 'vitest';
import { createTestObsidianHandler, type TestObsidianHandlerDeps } from '../testingHandlers.js';
import type { TestObsidianMessage } from '../../messageTypes.js';

function makeDeps(): { deps: TestObsidianHandlerDeps; testConnection: ReturnType<typeof vi.fn> } {
  const testConnection = vi.fn().mockResolvedValue({ success: true, message: 'OK' });
  return { deps: { testConnection }, testConnection };
}

function makeMessage(payload: TestObsidianMessage['payload']): TestObsidianMessage {
  return { type: 'TEST_OBSIDIAN', ...(payload !== undefined ? { payload } : {}) };
}

async function runHandler(deps: TestObsidianHandlerDeps, message: TestObsidianMessage): Promise<unknown> {
  const handler = createTestObsidianHandler(deps);
  const sendResponse = vi.fn();
  await handler(message, {} as chrome.runtime.MessageSender, sendResponse);
  return sendResponse.mock.calls[0]?.[0];
}

describe('createTestObsidianHandler', () => {
  describe('override construction', () => {
    it('forwards non-empty form values to testConnection', async () => {
      const { deps, testConnection } = makeDeps();
      await runHandler(deps, makeMessage({ apiKey: 'k', protocol: 'http', port: '27124', host: '127.0.0.1' }));
      expect(testConnection).toHaveBeenCalledWith({ apiKey: 'k', protocol: 'http', port: '27124', host: '127.0.0.1' });
    });

    it('drops empty and whitespace-only fields', async () => {
      const { deps, testConnection } = makeDeps();
      await runHandler(deps, makeMessage({ apiKey: 'k', protocol: '  ', port: '', host: undefined }));
      expect(testConnection).toHaveBeenCalledWith({ apiKey: 'k' });
    });

    it('passes undefined override when every field is empty (stored-settings path)', async () => {
      const { deps, testConnection } = makeDeps();
      await runHandler(deps, makeMessage({ apiKey: '', protocol: '', port: '', host: '' }));
      expect(testConnection).toHaveBeenCalledWith(undefined);
    });

    it('passes undefined override when payload is absent', async () => {
      const { deps, testConnection } = makeDeps();
      await runHandler(deps, makeMessage(undefined));
      expect(testConnection).toHaveBeenCalledWith(undefined);
    });
  });

  describe('response shape', () => {
    it('wraps the result as { success: true, obsidian }', async () => {
      const { deps } = makeDeps();
      const response = await runHandler(deps, makeMessage({ apiKey: 'k' }));
      expect(response).toEqual({ success: true, obsidian: { success: true, message: 'OK' } });
    });
  });
});
