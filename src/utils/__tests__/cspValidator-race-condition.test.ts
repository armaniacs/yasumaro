/**
 * @jest-environment jsdom
 */

/**
 * cspValidator-race-condition.test.ts
 * Unit tests for CSP Validator Race Condition Fix
 * TDD Red phase: Tests for request queuing during initialization
 */

import { jest } from '@jest/globals';

describe('CSPValidator - Race Condition Fix - Request Queuing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { CSPValidator } = require('../cspValidator.js');
    CSPValidator.reset();
  });

  describe('Pre-initialization request handling', () => {
    it('should queue requests before initialization', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      // 重いモックfetch（初期化中にリクエストが即時実行されないことを確認）
      global.fetch = jest.fn().mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 1000)
        )
      );

      // 初期化準備を開始
      CSPValidator.prepareInitialization();

      // 初期化前にリクエストを発行（キューイングされるべき）
      const requestPromise = safeFetch('https://api.openai.com/v1/models');

      // リクエストはまだ実行されていないはず
      expect(fetch).not.toHaveBeenCalled();

      // 初期化を実行
      const settings = { conditional_csp_providers: [] };
      CSPValidator.initializeFromSettings(settings);

      // リクエストは初期化後に実行される
      await requestPromise;
      expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', undefined);
    });

    it('should queue multiple requests before initialization and execute after', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      // 初期化準備を開始
      CSPValidator.prepareInitialization();

      // 初期化前に複数のリクエストを発行
      const promises = [
        safeFetch('https://api.openai.com/v1/models'),
        safeFetch('https://api.anthropic.com/v1/messages'),
        safeFetch('https://api.groq.com/openai/v1/chat/completions')
      ];

      // リクエストはまだ実行されていないはず
      expect(fetch).not.toHaveBeenCalled();

      // 初期化を実行
      CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });

      // 全リクエストが実行される
      await Promise.all(promises);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', undefined);
      expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', undefined);
      expect(fetch).toHaveBeenCalledWith('https://api.groq.com/openai/v1/chat/completions', undefined);
    });

    it('should execute queued requests with CSP settings applied', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      // 初期化準備を開始
      CSPValidator.prepareInitialization();

      // 初期化前にhuggingfaceドメインへのリクエスト（ブロックされているはず）
      const huggingfacePromise = safeFetch('https://api-inference.huggingface.co/models');

      // 初期化時にhuggingfaceを追加
      CSPValidator.initializeFromSettings({ conditional_csp_providers: ['huggingface'] });

      // リクエストが成功する（初期化後に設定が適用されるため）
      await huggingfacePromise;
      expect(fetch).toHaveBeenCalledWith('https://api-inference.huggingface.co/models', undefined);
    });

    it('should block non-provider URLs even when queued', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      // 初期化準備を開始
      CSPValidator.prepareInitialization();

      // 初期化前に悪意あるドメインへのリクエスト
      const evilPromise = safeFetch('https://evil-api.com/v1/models');

      // 初期化を実行（evil-api.comは許可されない）
      CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });

      // リクエストはブロックされる
      await expect(evilPromise).rejects.toThrow('URL blocked by CSP policy');
    });
  });

  describe('Post-initialization request handling', () => {
    it('should execute requests immediately after initialization', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      // 先に初期化
      CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });

      // 初期化後のリクエストは即時実行
      await safeFetch('https://api.openai.com/v1/models');
      expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', undefined);
    });

    it('should not queue requests after initialization', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      // 先に初期化
      CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });

      // 複数のリクエストを並列で発行
      await Promise.all([
        safeFetch('https://api.openai.com/v1/models'),
        safeFetch('https://api.anthropic.com/v1/messages'),
        safeFetch('https://api.groq.com/openai/v1/chat/completions')
      ]);

      // リクエスト数は呼び出し数と一致（キューイングされていない）
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Queue limit and overflow', () => {
    it('should limit queue size and reject overflow requests', async () => {
      const { safeFetch, CSPValidator } = await import('../cspValidator.js');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      // 初期化準備を開始
      CSPValidator.prepareInitialization();

      // キュー上限を超える数のリクエストを発行（例: 150件）
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 150; i++) {
        promises.push(
          safeFetch(`https://api.openai.com/v1/models?test=${i}`)
            .catch(err => ({ error: err }))
        );
      }

      // 初期化を実行
      CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });

      // 結果を確認
      const results = await Promise.all(promises);
      const errors = results.filter(r => (r as any).error);

      // キュー上限超過分はエラーになっているはず（REQUEST_QUEUE_LIMIT=100、50件超過）
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.length).toBeLessThan(promises.length);
    });
  });
});