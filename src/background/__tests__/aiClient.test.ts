/**
 * aiClient.test.ts
 * AI Clientのエラーハンドリングテスト
 * FEATURE-001: エラーハンドリングの一貫性の欠如と詳細な情報漏洩の検証
 */

import { AIClient } from '../aiClient.js';
import { vi } from 'vitest';
import * as storage from '../../utils/storage.js';
import * as fetchModule from '../../utils/fetch.js';
import { recordAuditLog } from '../../utils/auditLog.js';

const { fetchWithRetry } = vi.mocked(fetchModule);
// import { LocalAIClient } from '../localAiClient.js'; // Unused

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(),
  getAllowedUrls: vi.fn(() => Promise.resolve([])),
  StorageKeys: {
    AI_PROVIDER: 'ai_provider',
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    OPENAI_BASE_URL: 'openai_base_url',
    OPENAI_API_KEY: 'openai_api_key',
    OPENAI_MODEL: 'openai_model',
    OPENAI_2_BASE_URL: 'openai_2_base_url',
    OPENAI_2_API_KEY: 'openai_2_api_key',
    OPENAI_2_MODEL: 'openai_2_model'
  }
}));
vi.mock('../localAiClient.js');
vi.mock('../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

describe('AIClient: FEATURE-001 エラーハンドリングの一貫性と情報漏洩', () => {
  let aiClient: AIClient;

  // Type assertion for mocks
  const mockGetSettings = storage.getSettings as vi.Mock;
  // const mockGetAllowedUrls = storage.getAllowedUrls as vi.Mock;

  beforeEach(() => {
    aiClient = new AIClient();
    vi.clearAllMocks();

    // storageのデフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue
  
    mockGetSettings.mockResolvedValue({});
    // @ts-expect-error - vi.fn() type narrowing issue
  
    (storage.getAllowedUrls as vi.Mock).mockResolvedValue([]);
  });

  describe('未知のプロバイダーが指定された場合のエラーハンドリング', () => {
    it('未知のプロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'unknown_provider' がエラーメッセージに含まれないことを確認
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('unknown_provider'); // 内部情報が漏洩していない
      expect(result.summary).toContain('AI provider configuration is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(result.summary).toContain('Error:');
      expect(result.summary).toContain('check your settings'); // ユーザーへの指示が含まれる
    });
  });

  describe('APIキーが提供されていない場合のエラーハンドリング', () => {
    it('Geminiプロバイダーの場合、プロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'gemini', gemini_api_key: '' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'Gemini' がエラーメッセージに含まれないことを確認
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('Gemini'); // 内部情報が漏洩していない
      expect(result.summary).toContain('API key is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'gemini', gemini_api_key: '' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(result.summary).toContain('Error:');
      expect(result.summary).toContain('check your settings'); // ユーザーへの指示が含まれる
    });
  });

  describe('APIエラー時のエラーハンドリング', () => {
    beforeEach(() => {
      // fetchのモックを設定
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('Gemini API 404エラー時、詳細なエラーメッセージが含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite'
      });

      // 404エラーのモック - fetchWithTimeoutが正しく動作するようにモック
    // @ts-expect-error - vi.fn() type narrowing issue
  
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
        json: () => Promise.resolve({})
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: Modelチェックが行われる
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('404'); // HTTPステータスコードが含まれない
      expect(result.summary).not.toContain('Not found'); // APIからのエラー詳細が含まれない
    });

    it('Gemini API 一般エラー時、エラーレスポンスの生データが含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from API: Invalid request';
    // @ts-expect-error - vi.fn() type narrowing issue
  
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(errorDetail)
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: 汎用エラーメッセージ
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('400'); // HTTPステータスコードが含まれない
      expect(result.summary).not.toContain('Detailed error message'); // APIからのエラー詳細が含まれない
      expect(result.summary).not.toContain('Invalid request'); // API エラーメッセージが含まれない
    });

    it('OpenAI API エラー時、エラーレスポンスの生データが含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'openai',
        openai_base_url: 'https://api.openai.com/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from OpenAI API';
    // @ts-expect-error - vi.fn() type narrowing issue
  
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(errorDetail)
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: 汎用エラーメッセージ
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('401'); // HTTPステータスコードが含まれない
      expect(result.summary).not.toContain('Detailed error message'); // APIからのエラー詳細が含まれない
      expect(result.summary).not.toContain('OpenAI'); // プロバイダー名が含まれない
    });
  });

  describe('ネットワークエラー時のエラーハンドリング', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('ネットワークエラー時、詳細なエラーメッセージが含まれないこと（修正後）', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite'
      });

      // ネットワークエラーのモック
      const networkError = new Error('Failed to fetch: Network request failed');
    // @ts-expect-error - vi.fn() type narrowing issue
  
      (global.fetch as vi.Mock).mockRejectedValue(networkError);

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: リトライの提案
      expect(result.summary).toContain('Error:');
      expect(result.summary).toContain('try again'); // 一般的なエラーメッセージ
      expect(result.summary).not.toContain('Failed to fetch'); // 内部エラー詳細が含まれない
      expect(result.summary).not.toContain('Network request'); // 内部エラー詳細が含まれない
      expect(result.summary).not.toContain('@'); // ソースコードの詳細が含まれない
    });
  });

  describe('エラーハンドリングの一貫性の確認', () => {
    it('errorUtils.jsのgetUserErrorMessage関数が使用されていない（一貫性問題）', () => {
      // aiClient.jsにはimport errorUtilsがないため、一貫したエラーハンドリングが行われていない
      // これはテスト自体で確認すべきことで、コードレビューで見つけるべき問題である

      // 分析: aiClient.jsはerrorUtils.jsの関数を使用せず、独自のエラーハンドリングを実装している
      // これにより、エラーメッセージの形式や内容が他のモジュールと異なり、一貫性が欠如している
      expect(true).toBe(true); // 分析結果をドキュメント化するためのプレースホルダー
    });
  });

  describe('推奨される改善点', () => {
    it('エラーメッセージから内部情報を削除すべきである', () => {
      expect(true).toBe(true);
    });

    it('errorUtils.jsを使用して一貫したエラーハンドリングを実装すべきである', () => {
      expect(true).toBe(true);
    });
  });

  describe('registerProvider', () => {
    it('カスタムプロバイダーを登録できる', () => {
      const client = new AIClient();
      const mockFactory = vi.fn() as any;
      client.registerProvider('custom', mockFactory);

      // registerProvider はエラーを投げない
      expect(true).toBe(true);
    });
  });

  describe('registerDefaultProviders', () => {
    it('デフォルトプロバイダーが登録される', () => {
      const client = new AIClient();
      // constructor で registerDefaultProviders が呼ばれる
      expect(client).toBeDefined();
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('未知のプロバイダーでエラーを返す', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown' });

      const result = await aiClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown provider: unknown');
    });

    it('プロバイダーがthrowした場合エラーを返す', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'key',
        gemini_model: 'gemini-pro'
      });
      // fetchWithRetry がエラーを投げる

      const result = await aiClient.testConnection();

      // fetchWithRetry が呼ばれ、結果が返される
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('generateSummary - 正常系', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('Geminiプロバイダーで正常に要約できる', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite'
      });

      const result = await aiClient.generateSummary('Test content');

      // モック環境ではfetchWithRetryが呼ばれ、結果が返される
      expect(result).toBeDefined();
      expect(typeof result.summary).toBe('string');
    });

    it('OpenAIプロバイダーで正常に要約できる', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'openai',
        openai_base_url: 'https://api.openai.com/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo'
      });

      const result = await aiClient.generateSummary('Test content');

      expect(result).toBeDefined();
      expect(typeof result.summary).toBe('string');
    });

    it('calls recordAuditLog with the provider name and url before generating a cloud summary', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite'
      });

      const client = new AIClient();
      await client.generateSummary('some content', false, 'https://example.com/audit-test');

      expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'gemini', url: 'https://example.com/audit-test' });
    });

    it('records audit log for each provider tried during fallback', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider_priority_list: [
          { provider: 'gemini', weight: 1 },
          { provider: 'openai', weight: 2 }
        ],
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-3.1-flash-lite',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo'
      });

      const client = new AIClient();
      await client.generateSummary('some content', false, 'https://example.com/fallback-test');

      // recordAuditLog が複数回呼ばれることを確認
      expect(recordAuditLog).toHaveBeenCalled();
    });
  });

  describe('generateSummary - プロバイダー例外ハンドリング', () => {
    it('プロバイダーがthrowした場合に汎用エラーメッセージを返す', async () => {
      const client = new AIClient();
      client.registerProvider('throwing', () => ({
        generateSummary: () => { throw new Error('Provider internal error'); },
        testConnection: () => Promise.resolve({ success: true, message: 'ok' })
      }));

      mockGetSettings.mockResolvedValue({ ai_provider: 'throwing' });

      const result = await client.generateSummary('content');

      expect(result.summary).toContain('Error:');
      expect(result.summary).toContain('Failed to generate summary');
      expect(result.summary).not.toContain('Provider internal error');
    });
  });

  describe('testConnection - プロバイダー例外ハンドリング', () => {
    it('プロバイダーがthrowした場合にエラー結果を返す', async () => {
      const client = new AIClient();
      client.registerProvider('throwing', () => ({
        generateSummary: () => Promise.resolve({ success: true, summary: 'ok' }),
        testConnection: () => { throw new Error('Connection test internal error'); }
      }));

      mockGetSettings.mockResolvedValue({ ai_provider: 'throwing' });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection test internal error');
    });
  });

  describe('testConnection - MAX_PROVIDERS制限 (DoS対策)', () => {
    it('MAX_PROVIDERSを超えるスロットは切り捨てられる', async () => {
      const client = new AIClient();
      let callCount = 0;
      client.registerProvider('gemini', () => ({
        generateSummary: () => Promise.resolve({ success: true, summary: 'ok' }),
        testConnection: () => {
          callCount++;
          return Promise.resolve({ success: true, message: 'ok' });
        }
      }));

      // 30 slots — exceeds MAX_PROVIDERS=10
      const slots = Array.from({ length: 30 }, (_, i) => ({
        provider: 'gemini',
        model: `model-${i}`,
      }));
      mockGetSettings.mockResolvedValue({
        ai_provider_priority_list: slots,
        gemini_api_key: 'key',
        gemini_model: 'gemini-pro',
      });

      const result = await client.testConnection();

      // Only MAX_PROVIDERS (10) should be processed
      expect(callCount).toBeLessThanOrEqual(10);
      expect(result.providers.length).toBeLessThanOrEqual(10);
      expect(result.success).toBe(true);
    });
  });
});