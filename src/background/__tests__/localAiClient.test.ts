/**
 * localAiClient.test.ts
 * localAiClient.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
Object.defineProperty(global, 'crypto', { value: crypto });

// chrome API モック
const mockChrome = {
    offscreen: {
        hasDocument: vi.fn(async () => false),
        createDocument: vi.fn(async () => {}),
        Reason: { WORKERS: 'WORKERS' }
    },
    runtime: {
        sendMessage: vi.fn(),
        lastError: null as any
    }
};
(global as any).chrome = mockChrome;

// logger モック
vi.mock('../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' }
}));

// promptSanitizer モック
vi.mock('../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: vi.fn((content: string) => ({
        sanitized: content,
        warnings: [],
        dangerLevel: 'low'
    })),
    DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }
}));

import { LocalAIClient } from '../localAiClient.js';
import * as promptSanitizerModule from '../../utils/promptSanitizer.js';

const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);

describe('LocalAIClient', () => {
    let client: LocalAIClient;

    beforeEach(() => {
        client = new LocalAIClient();
        vi.clearAllMocks();
        mockChrome.runtime.lastError = null;
    });

    describe('constructor', () => {
        test('インスタンスを作成できる', () => {
            expect(client).toBeInstanceOf(LocalAIClient);
        });
    });

    describe('getAvailability', () => {
        test('利用可能な場合 readily を返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ status: 'readily' });
            });

            const result = await client.getAvailability();
            expect(result).toBe('readily');
        });

        test('after-download の場合を返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ status: 'after-download' });
            });

            const result = await client.getAvailability();
            expect(result).toBe('after-download');
        });

        test('エラー時は unsupported を返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                mockChrome.runtime.lastError = { message: 'error' };
                cb(null);
            });

            const result = await client.getAvailability();
            expect(result).toBe('unsupported');
        });

        test('レスポンスが undefined の場合は unsupported を返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb(undefined);
            });

            const result = await client.getAvailability();
            expect(result).toBe('unsupported');
        });
    });

    describe('isAvailable', () => {
        test('readily の場合は true', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ status: 'readily' });
            });

            const result = await client.isAvailable();
            expect(result).toBe(true);
        });

        test('readily 以外の場合は false', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ status: 'after-download' });
            });

            const result = await client.isAvailable();
            expect(result).toBe(false);
        });
    });

    describe('summarize', () => {
        test('空コンテンツでエラーを返す', async () => {
            const result = await client.summarize('');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid content');
        });

        test('成功時にサマリーを返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ success: true, summary: 'Test summary' });
            });

            const result = await client.summarize('Some content to summarize');

            expect(result.success).toBe(true);
            expect(result.summary).toBe('Test summary');
            expect(result.sentTokens).toBeGreaterThan(0);
            expect(result.receivedTokens).toBeGreaterThan(0);
        });

        test('エラーレスポンスでエラーを返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                cb({ error: 'Something went wrong' });
            });

            const result = await client.summarize('Content');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Something went wrong');
        });

        test('chrome.runtime.lastError でエラーを返す', async () => {
            mockChrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Function) => {
                mockChrome.runtime.lastError = { message: 'Connection failed' };
                cb(null);
            });

            const result = await client.summarize('Content');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Connection failed');
        });

        test('プロンプトインジェクション HIGH でブロックする', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'blocked',
                warnings: ['injection detected'],
                dangerLevel: 'high'
            });

            const result = await client.summarize('malicious content');
            expect(result.success).toBe(false);
            expect(result.error).toContain('dangerous patterns');
        });
    });

    describe('ensureOffscreenDocument', () => {
        test('既にドキュメントがある場合はスキップ', async () => {
            mockChrome.offscreen.hasDocument.mockResolvedValueOnce(true);

            await client.ensureOffscreenDocument();

            expect(mockChrome.offscreen.createDocument).not.toHaveBeenCalled();
        });

        test('ドキュメントがない場合は作成する', async () => {
          mockChrome.offscreen.hasDocument.mockResolvedValueOnce(false);

          await client.ensureOffscreenDocument();

          expect(mockChrome.offscreen.createDocument).toHaveBeenCalled();
        });

        test('既に作成中の場合は作成プロミスを待機して完了する', async () => {
          mockChrome.offscreen.hasDocument.mockResolvedValueOnce(false);
          let creationResolve: () => void;
          const creationPromise = new Promise<void>(resolve => { creationResolve = resolve; });
          mockChrome.offscreen.createDocument = vi.fn(() => creationPromise);

          // First call starts creation
          const firstPromise = client.ensureOffscreenDocument();
          // Second call should await the existing promise
          const secondPromise = client.ensureOffscreenDocument();

          // Resolve the creation
          creationResolve();

          await expect(firstPromise).resolves.toBeUndefined();
          await expect(secondPromise).resolves.toBeUndefined();

          expect(mockChrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
        });
      });
});
