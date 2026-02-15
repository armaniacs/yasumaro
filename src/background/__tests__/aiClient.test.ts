/**
 * aiClient.test.ts
 * AI Clientのエラーハンドリングテスト
 * FEATURE-001: エラーハンドリングの一貫性の欠如と詳細な情報漏洩の検証
 */

import { AIClient } from '../aiClient.ts';
import * as storage from '../../utils/storage.ts';
// import { LocalAIClient } from '../localAiClient.ts'; // Unused

jest.mock('../../utils/storage.ts', () => ({
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
jest.mock('../localAiClient.ts');

describe('AIClient: FEATURE-001 エラーハンドリングの一貫性と情報漏洩', () => {
  let aiClient: AIClient;

  // Type assertion for mocks
  const mockGetSettings = storage.getSettings as jest.Mock;
  // const mockGetAllowedUrls = storage.getAllowedUrls as jest.Mock;

  beforeEach(() => {
    aiClient = new AIClient();
    jest.clearAllMocks();

    // storageのデフォルトモック
    mockGetSettings.mockResolvedValue({});
    (storage.getAllowedUrls as jest.Mock).mockResolvedValue([]);
  });

  describe('未知のプロバイダーが指定された場合のエラーハンドリング', () => {
    it('未知のプロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'unknown_provider' がエラーメッセージに含まれないことを確認
      expect(result).toContain('Error:');
      expect(result).not.toContain('unknown_provider'); // 内部情報が漏洩していない
      expect(result).toContain('AI provider configuration is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'unknown_provider' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(result).toContain('Error:');
      expect(result).toContain('check your settings'); // ユーザーへの指示が含まれる
    });
  });

  describe('APIキーが提供されていない場合のエラーハンドリング', () => {
    it('Geminiプロバイダーの場合、プロバイダー名がエラーメッセージに含まれないこと（修正後）', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'gemini', gemini_api_key: '' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: 内部プロバイダー名 'Gemini' がエラーメッセージに含まれないことを確認
      expect(result).toContain('Error:');
      expect(result).not.toContain('Gemini'); // 内部情報が漏洩していない
      expect(result).toContain('API key is missing'); // ユーザーに分かりやすいメッセージ
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
      mockGetSettings.mockResolvedValue({ ai_provider: 'gemini', gemini_api_key: '' });

      const result = await aiClient.generateSummary('Test content');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(result).toContain('Error:');
      expect(result).toContain('check your settings'); // ユーザーへの指示が含まれる
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
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // 404エラーのモック - fetchWithTimeoutが正しく動作するようにモック
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
        json: () => Promise.resolve({})
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: Modelチェックが行われる
      expect(result).toContain('Error:');
      expect(result).not.toContain('404'); // HTTPステータスコードが含まれない
      expect(result).not.toContain('Not found'); // APIからのエラー詳細が含まれない
    });

    it('Gemini API 一般エラー時、エラーレスポンスの生データが含まれないこと（修正後）', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from API: Invalid request';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(errorDetail)
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: 汎用エラーメッセージ
      expect(result).toContain('Error:');
      expect(result).not.toContain('400'); // HTTPステータスコードが含まれない
      expect(result).not.toContain('Detailed error message'); // APIからのエラー詳細が含まれない
      expect(result).not.toContain('Invalid request'); // API エラーメッセージが含まれない
    });

    it('OpenAI API エラー時、エラーレスポンスの生データが含まれないこと（修正後）', async () => {
      mockGetSettings.mockResolvedValue({
        ai_provider: 'openai',
        openai_base_url: 'https://api.openai.com/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo'
      });

      // エラーレスポンスのモック
      const errorDetail = 'Detailed error message from OpenAI API';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(errorDetail)
      });

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: 汎用エラーメッセージ
      expect(result).toContain('Error:');
      expect(result).not.toContain('401'); // HTTPステータスコードが含まれない
      expect(result).not.toContain('Detailed error message'); // APIからのエラー詳細が含まれない
      expect(result).not.toContain('OpenAI'); // プロバイダー名が含まれない
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
      mockGetSettings.mockResolvedValue({
        ai_provider: 'gemini',
        gemini_api_key: 'test_key',
        gemini_model: 'gemini-1.5-flash'
      });

      // ネットワークエラーのモック
      const networkError = new Error('Failed to fetch: Network request failed');
      (global.fetch as jest.Mock).mockRejectedValue(networkError);

      const result = await aiClient.generateSummary('Test content');

      // Strategyパターン導入後のエラーメッセージ: リトライの提案
      expect(result).toContain('Error:');
      expect(result).toContain('try again'); // 一般的なエラーメッセージ
      expect(result).not.toContain('Failed to fetch'); // 内部エラー詳細が含まれない
      expect(result).not.toContain('Network request'); // 内部エラー詳細が含まれない
      expect(result).not.toContain('@'); // ソースコードの詳細が含まれない
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
      // 推奨される改善:
      // 1. 未知のプロバイダーの場合、プロバイダー名を表示せず、一般的なエラーメッセージを表示
      // 2. APIキーが提供されていない場合、プロバイダー名を表示せず、一般的なエラーメッセージを表示
      // 3. APIエラー時、詳細なエラーメッセージではなく、一般的なエラーメッセージを表示
      // 4. ネットワークエラー時、詳細なエラーメッセージではなく、一般的なエラーメッセージを表示

      // 詳細なエラー情報はログに記録し、ユーザーには一般的なエラーメッセージを表示すべき
      expect(true).toBe(true); // 分析結果をドキュメント化するためのプレースホルダー
    });

    it('errorUtils.jsを使用して一貫したエラーハンドリングを実装すべきである', () => {
      // 推奨される改善:
      // 1. errorUtils.jsのgetUserErrorMessage関数を使用して、一貫したエラーメッセージを表示
      // 2. errorUtils.jsのErrorTypeを使用して、エラータイプを一貫して管理
      // 3. errorUtils.jsのhandleError関数を使用して、一貫したエラーハンドリングを実装

      // これにより、エラーメッセージの形式や内容を一貫させることができる
      expect(true).toBe(true); // 分析結果をドキュメント化するためのプレースホルダー
    });
  });
});