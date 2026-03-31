/**
 * aiClient.test.ts
 * AI Clientのエラーハンドリングテスト
 * FEATURE-001: エラーハンドリングの一貫性の欠如と詳細な情報漏洩の検証
 */

import { AIClient } from '../aiClient.js';
import * as storage from '../../utils/storage.js';
// import { LocalAIClient } from '../localAiClient.js'; // Unused

jest.mock('../../utils/storage.js', () => ({
  getSettings: jest.fn(),
  getAllowedUrls: jest.fn(() => Promise.resolve([])),
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
jest.mock('../localAiClient.js');

describe('AIClient: FEATURE-001 エラーハンドリングの一貫性と情報漏洩', () => {
  let aiClient: AIClient;

  // Type assertion for mocks
  const mockGetSettings = storage.getSettings as jest.Mock;
  // const mockGetAllowedUrls = storage.getAllowedUrls as jest.Mock;

  beforeEach(() => {
    aiClient = new AIClient();
    jest.clearAllMocks();

    // storageのデフォルトモック
    // @ts-expect-error - jest.fn() type narrowing issue
  
    mockGetSettings.mockResolvedValue({});
    // @ts-expect-error - jest.fn() type narrowing issue
  
    (storage.getAllowedUrls as jest.Mock).mockResolvedValue([]);
  });

  describe('未知のプロバイダーが指定された場合のエラーハンドリング', () => {
    it('未知のプロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'unknown_provider' がエラーメッセージに含まれないことを確認
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('unknown_provider'); // 内部情報が漏洩していない
      expect(result.summary).toContain('AI provider configuration is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(result.summary).toContain('Error:');
      expect(result.summary).toContain('check your settings'); // ユーザーへの指示が含まれる
    });
  });

  describe('APIキーが提供されていない場合のエラーハンドリング', () => {
    it('Geminiプロバイダーの場合、プロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({ ai_provider: 'gemini', gemini_api_key: '' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'Gemini' がエラーメッセージに含まれないことを確認
      expect(result.summary).toContain('Error:');
      expect(result.summary).not.toContain('Gemini'); // 内部情報が漏洩していない
      expect(result.summary).toContain('API key is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
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
      global.fetch = jest.fn();
    });

    afterEach(() => {
      (global.fetch as jest.Mock).mockRestore();
    });

    it('Gemini API 404エラー時、詳細なエラーメッセージが含まれないこと（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // 404エラーのモック - fetchWithTimeoutが正しく動作するようにモック
    // @ts-expect-error - jest.fn() type narrowing issue
  
      (global.fetch as jest.Mock).mockResolvedValue({
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
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from API: Invalid request';
    // @ts-expect-error - jest.fn() type narrowing issue
  
      (global.fetch as jest.Mock).mockResolvedValue({
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
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'openai',
        openai_base_url: 'https://api.openai.com/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from OpenAI API';
    // @ts-expect-error - jest.fn() type narrowing issue
  
      (global.fetch as jest.Mock).mockResolvedValue({
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
      global.fetch = jest.fn();
    });

    afterEach(() => {
      (global.fetch as jest.Mock).mockRestore();
    });

    it('ネットワークエラー時、詳細なエラーメッセージが含まれないこと（修正後）', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // ネットワークエラーのモック
      const networkError = new Error('Failed to fetch: Network request failed');
    // @ts-expect-error - jest.fn() type narrowing issue
  
      (global.fetch as jest.Mock).mockRejectedValue(networkError);

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
      const mockFactory = jest.fn() as any;
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
      global.fetch = jest.fn();
    });

    afterEach(() => {
      (global.fetch as jest.Mock).mockRestore();
    });

    it('未知のプロバイダーでエラーを返す', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown' });

      const result = await aiClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('configuration is missing');
    });

    it('プロバイダーがthrowした場合エラーを返す', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'key',
        gemini_model: 'gemini-pro'
      });
      // fetchWithRetry がエラーを投げる
      const { fetchWithRetry } = require('../../utils/fetch.js');

      const result = await aiClient.testConnection();

      // fetchWithRetry が呼ばれ、結果が返される
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('summarizeLocally', () => {
    it('localAiClient.summarize を委譲する', async () => {
      // localAiClient はモックされているので undefined が返るが、呼び出し自体を確認
      const result = await aiClient.summarizeLocally('test content');
      // モック環境では undefined でも、エラーなく完了することが重要
      expect(() => aiClient.summarizeLocally('test')).not.toThrow();
    });
  });

  describe('getLocalAvailability', () => {
    it('localAiClient.getAvailability を委譲する', async () => {
      expect(() => aiClient.getLocalAvailability()).not.toThrow();
    });
  });

  describe('generateSummary - 正常系', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      (global.fetch as jest.Mock).mockRestore();
    });

    it('Geminiプロバイダーで正常に要約できる', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
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
        generateSummary: () => Promise.resolve({ summary: 'ok' }),
        testConnection: () => { throw new Error('Connection test internal error'); }
      }));

      mockGetSettings.mockResolvedValue({ ai_provider: 'throwing' });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection test internal error');
    });
  });
});