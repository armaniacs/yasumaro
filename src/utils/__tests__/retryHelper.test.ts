/**
 * retryHelper.test.ts
 * Unit tests for retry helper module
 */

import {
    ChromeMessageSender,
    sendMessageWithRetry as sendMessageWithRetry,
    createSender,
    type RetryOptions,
    type MessagePayload
} from '../retryHelper.js';

// Mock chrome.runtime.sendMessage
global.chrome = {
    runtime: {
        sendMessage: jest.fn(),
        lastError: null
    }
} as any;

describe('ChromeMessageSender', () => {
    let sender: ChromeMessageSender;

    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
        sender = new ChromeMessageSender();
    });

    describe('constructor', () => {
        it('デフォルトオプションでインスタンスを作成できる', () => {
            expect(sender.options).toEqual({
                maxRetries: 5,
                initialDelay: 300,
                backoffMultiplier: 2,
                maxDelay: 10000
            });
        });

        it('カスタムオプションでインスタンスを作成できる', () => {
            const customSender = new ChromeMessageSender({
                maxRetries: 5,
                initialDelay: 200
            });
            expect(customSender.options.maxRetries).toBe(5);
            expect(customSender.options.initialDelay).toBe(200);
        });

        it('デフォルト値の一部を拡張したカスタムオプション', () => {
            const customSender = new ChromeMessageSender({
                maxRetries: 10
            });
            expect(customSender.options.maxRetries).toBe(10);
            expect(customSender.options.initialDelay).toBe(300); // デフォルト値が維持
        });
    });

    describe('sendMessageWithRetry', () => {
        it('成功時はすぐにレスポンスを返す', async () => {
            const mockResponse = { success: true, data: 'test' };
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback(mockResponse as any);
            });

            const result = await sender.sendMessageWithRetry({
                type: 'TEST',
                payload: {}
            } as MessagePayload<unknown>);

            expect(result).toEqual(mockResponse);
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        });

        it('ビジネスロジックエラー（success: false）でもレスポンスを返す', async () => {
            const mockResponse = { success: false, error: 'Domain blocked' };
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback(mockResponse as any);
            });

            const result = await sender.sendMessageWithRetry({
                type: 'TEST',
                payload: {}
            } as MessagePayload<unknown>);

            expect(result).toEqual(mockResponse);
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        });

        it('リトライ可能なエラーでリトライする', async () => {
            let callCount = 0;
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callCount++;
                if (callCount === 1) {
                    global.chrome.runtime.lastError = { message: 'Could not establish connection' };
                    callback();
                } else {
                    global.chrome.runtime.lastError = null;
                    callback({ success: true });
                }
            });

            const result = await sender.sendMessageWithRetry(
                { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                { initialDelay: 0 }
            );

            expect(result.success).toBe(true);
            expect(callCount).toBe(2); // 1回目失敗 + 1回目リトライ成功
        });

        it('最大リトライ回数を超えるとエラーをスローする', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                global.chrome.runtime.lastError = { message: 'Could not establish connection' };
                callback();
            });

            await expect(
                sender.sendMessageWithRetry(
                    { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                    { initialDelay: 0 }
                )
            ).rejects.toThrow('Could not establish connection');

            // 初期 + 5回リトライ = 6回
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(6);
        });

        it('非リトライ可能なエラーで即座に失敗する', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                global.chrome.runtime.lastError = { message: 'Invalid message format' };
                callback();
            });

            await expect(
                sender.sendMessageWithRetry({ type: 'TEST', payload: {} } as MessagePayload<unknown>)
            ).rejects.toThrow('Invalid message format');

            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        });

        it('レスポンス未受信エラーでリトライする', async () => {
            let callCount = 0;
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callCount++;
                if (callCount === 1) {
                    callback(); // No response - これは "No response received" エラーになる
                } else {
                    callback({ success: true });
                }
            });

            // No response receivedはリトライ可能なエラーとして扱うよう修正
            await expect(
                sender.sendMessageWithRetry(
                    { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                    { initialDelay: 0 }
                )
            ).resolves.toEqual({ success: true });

            expect(callCount).toBe(2);
        });

        it('No response receivedエラーが最大リトライ後に失敗する', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback(); // Always no response - リトライ可能エラーとして扱う
            });

            await expect(
                sender.sendMessageWithRetry(
                    { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                    { initialDelay: 0 }
                )
            ).rejects.toThrow('No response received');

            // 初期 + 5回リトライ = 6回
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(6);
        });

        it('カスタムリトライオプションを上書きできる', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                global.chrome.runtime.lastError = { message: 'Could not establish connection' };
                callback();
            });

            // maxRetries: 1 で total callCount が 2 になる（初期 + 1回リトライ）
            const promise = sender.sendMessageWithRetry(
                { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                { maxRetries: 1, initialDelay: 0 }
            );

            await expect(promise).rejects.toThrow();

            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        });
    });

    describe('isRetryableError', () => {
        it('リトライ可能なエラーを正しく判定する', () => {
            expect(ChromeMessageSender.isRetryableError(
                new Error('Could not establish connection')
            )).toBe(true);

            expect(ChromeMessageSender.isRetryableError(
                new Error('Extension context invalidated')
            )).toBe(true);

            expect(ChromeMessageSender.isRetryableError(
                new Error('Receiving end does not exist')
            )).toBe(true);

            expect(ChromeMessageSender.isRetryableError(
                new Error('Message port closed')
            )).toBe(true);
        });

        it('リトライ不可能なエラーを正しく判定する', () => {
            expect(ChromeMessageSender.isRetryableError(
                new Error('Invalid message format')
            )).toBe(false);

            expect(ChromeMessageSender.isRetryableError(
                new Error('Some other error')
            )).toBe(false);

            expect(ChromeMessageSender.isRetryableError(
                new Error('Failed to parse')
            )).toBe(false);
        });

        it('null/undefinedを安全に処理する', () => {
            expect(ChromeMessageSender.isRetryableError(null)).toBe(false);
            expect(ChromeMessageSender.isRetryableError(undefined)).toBe(false);

            expect(ChromeMessageSender.isRetryableError({ message: null } as any)).toBe(false);
            expect(ChromeMessageSender.isRetryableError({} as any)).toBe(false);
        });
    });

    describe('exponential backoff', () => {
        it('リトライが指数バックオフで動作することを確認（基本）', async () => {
            // リトライオプションの確認テスト
            const senderWithBackoff = createSender({
                maxRetries: 3,
                initialDelay: 100,
                backoffMultiplier: 2,
                maxDelay: 10000
            });

            expect(senderWithBackoff.options).toEqual({
                maxRetries: 3,
                initialDelay: 100,
                backoffMultiplier: 2,
                maxDelay: 10000
            });

            // リトライの発生自体を確認（正確な遅延時間はプライベート実装なのでテストしない）
            let callCount = 0;
    // @ts-expect-error - jest.fn() type narrowing issue
  
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callCount++;
                if (callCount <= 3) {
                    // 最初の3回は失敗させる
                    global.chrome.runtime.lastError = { message: 'Could not establish connection' };
                    callback();
                } else {
                    // 4回目で成功
                    global.chrome.runtime.lastError = null;
                    callback({ success: true });
                }
            });

            await expect(
                senderWithBackoff.sendMessageWithRetry(
                    { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                    { initialDelay: 0 }
                )
            ).resolves.toEqual({ success: true });

            // 初回 + 3回リトライ = 4回
            expect(callCount).toBe(4);
        });

        it('maxDelayオプションが正しく設定される', async () => {
            const senderWithMaxDelay = createSender({
                maxRetries: 5,
                initialDelay: 5000,
                backoffMultiplier: 2,
                maxDelay: 5000 // カップ設定
            });

            expect(senderWithMaxDelay.options.maxDelay).toBe(5000);
        });
    });
});

describe('sendMessageWithRetry (factory)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
    });

    it('ファクトリー関数が動作する', async () => {
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue
  
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback(mockResponse as any);
        });

        const result = await sendMessageWithRetry({
            type: 'FACTORY_TEST',
            payload: {}
        } as MessagePayload<unknown>);

        expect(result).toEqual(mockResponse);
    });

    it('ファクトリー関数にカスタムオプションを渡せる', async () => {
        const mockResponse = { success: true };
        let callCount = 0;
    // @ts-expect-error - jest.fn() type narrowing issue
  
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount <= 2) {
                global.chrome.runtime.lastError = { message: 'Could not establish connection' };
            } else {
                global.chrome.runtime.lastError = null;
            }
            callback(mockResponse as any);
        });

        const result = await sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { maxRetries: 5, initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3); // 初期 + 2回リトライ
    });
});

describe('createSender (factory)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
    });

    it('設定されたインスタンスを作成する', () => {
        const customSender = createSender({ maxRetries: 10 });
        expect(customSender.options.maxRetries).toBe(10);
    });

    it('作成したインスタンスでメッセージを送信できる', async () => {
        const customSender = createSender({ maxRetries: 2 });
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue
  
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback(mockResponse as any);
        });

        const result = await customSender.sendMessageWithRetry({
            type: 'SENDER_TEST',
            payload: {}
        } as MessagePayload<unknown>);

        expect(result).toEqual(mockResponse);
    });
});

describe('chrome.runtime.lastError patterns', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
    });

    it('Receiving end does not existでリトライ', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue
  
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount === 1) {
                global.chrome.runtime.lastError = { message: 'Receiving end does not exist' };
            } else {
                global.chrome.runtime.lastError = null;
            }
            callback(mockResponse as any);
        });

        const result = await sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(2);
    });

    it('Extension context invalidatedでリトライ', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount <= 2) {
                global.chrome.runtime.lastError = { message: 'Extension context invalidated' };
            } else {
                global.chrome.runtime.lastError = null;
            }
            callback(mockResponse as any);
        });

        const result = await sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result.success).toBe(true);
        expect(callCount).toBe(3);
    });

    it('The message port closed before a response was receivedでリトライ', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount === 1) {
                global.chrome.runtime.lastError = { message: 'The message port closed before a response was received' };
                callback();
            } else {
                global.chrome.runtime.lastError = null;
                callback(mockResponse as any);
            }
        });

        const result = await sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(2);
    });

    it('The extension context has been invalidでリトライ', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount === 1) {
                global.chrome.runtime.lastError = { message: 'The extension context has been invalid' };
                callback();
            } else {
                global.chrome.runtime.lastError = null;
                callback(mockResponse as any);
            }
        });

        const result = await sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(2);
    });
});

describe('exponential backoff timing', () => {
    let sender: ChromeMessageSender;

    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
        jest.useFakeTimers();
        sender = new ChromeMessageSender();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('指数バックオフの遅延時間が正しく計算される', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount <= 3) {
                global.chrome.runtime.lastError = { message: 'Could not establish connection' };
                callback();
            } else {
                global.chrome.runtime.lastError = null;
                callback(mockResponse as any);
            }
        });

        const promise = sender.sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 100, backoffMultiplier: 2, maxRetries: 5 }
        );

        // Fast-forward through all retries
        await jest.advanceTimersByTimeAsync(100);  // 1st retry delay: 100ms
        await jest.advanceTimersByTimeAsync(200);  // 2nd retry delay: 200ms
        await jest.advanceTimersByTimeAsync(400);  // 3rd retry delay: 400ms

        const result = await promise;
        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(4); // initial + 3 retries
    });

    it('maxDelayで遅延時間がキャップされる', async () => {
        jest.useRealTimers();

        const delays: number[] = [];
        const originalSetTimeout = global.setTimeout;
        // Track actual delay values passed to setTimeout
        global.setTimeout = jest.fn((fn: Function, ms?: number) => {
            if (ms !== undefined && ms > 0) {
                delays.push(ms);
            }
            return originalSetTimeout(fn, 0); // Execute immediately
        }) as any;

        let callCount = 0;
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            global.chrome.runtime.lastError = { message: 'Could not establish connection' };
            callback();
        });

        try {
            await sender.sendMessageWithRetry(
                { type: 'TEST', payload: {} } as MessagePayload<unknown>,
                { initialDelay: 1000, backoffMultiplier: 3, maxDelay: 2000, maxRetries: 3 }
            );
        } catch (e) {
            // Expected: max retries exceeded
        }

        global.setTimeout = originalSetTimeout;
        jest.useFakeTimers();

        expect(callCount).toBe(4); // initial + 3 retries
        // Delays: min(1000*3^0, 2000)=1000, min(1000*3^1, 2000)=2000, min(1000*3^2, 2000)=2000
        expect(delays).toEqual([1000, 2000, 2000]);
    });
});

describe('edge cases', () => {
    let sender: ChromeMessageSender;

    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
        sender = new ChromeMessageSender();
    });

    it('sendMessageが直接例外をスローした場合もリトライする', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount === 1) {
                throw new Error('Could not establish connection');
            }
            callback(mockResponse as any);
        });

        const result = await sender.sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(2);
    });

    it('リトライ中にエラーパターンが変わってもリトライ継続', async () => {
        let callCount = 0;
        const mockResponse = { success: true };
        const errors = [
            'Could not establish connection',
            'Message port closed',
            'Receiving end does not exist'
        ];
    // @ts-expect-error - jest.fn() type narrowing issue

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callCount++;
            if (callCount <= 3) {
                global.chrome.runtime.lastError = { message: errors[callCount - 1] };
                callback();
            } else {
                global.chrome.runtime.lastError = null;
                callback(mockResponse as any);
            }
        });

        const result = await sender.sendMessageWithRetry(
            { type: 'TEST', payload: {} } as MessagePayload<unknown>,
            { initialDelay: 0 }
        );

        expect(result).toEqual(mockResponse);
        expect(callCount).toBe(4);
    });

    it('chrome.runtime.sendMessageが利用不可の場合は即座にエラー', async () => {
        const originalSendMessage = chrome.runtime.sendMessage;
        (chrome.runtime as any).sendMessage = undefined;

        await expect(
            sender.sendMessageWithRetry({ type: 'TEST', payload: {} } as MessagePayload<unknown>)
        ).rejects.toThrow('Extension context invalidated');

        chrome.runtime.sendMessage = originalSendMessage;
    });
});