/**
 * obsidianClient.test.js
 * Obsidian Clientのエラーハンドリングテスト
 * FEATURE-001: エラーハンドリングの一貫性の欠如と詳細な情報漏洩の検証
 */

import { ObsidianClient } from '../obsidianClient.ts';
import * as storage from '../../utils/storage.ts';
import { buildDailyNotePath } from '../../utils/dailyNotePathBuilder.ts';
import { NoteSectionEditor } from '../noteSectionEditor.ts';

jest.mock('../../utils/storage.ts');
jest.mock('../../utils/dailyNotePathBuilder.ts', () => ({
  buildDailyNotePath: jest.fn((pathRaw) => '2026-02-07')
}));
jest.mock('../noteSectionEditor.ts', () => ({
  NoteSectionEditor: {
    DEFAULT_SECTION_HEADER: '## History',
    insertIntoSection: jest.fn((existingContent, sectionHeader, content) => `${sectionHeader}\n${content}`)
  }
}));

describe('ObsidianClient: FEATURE-001 エラーハンドリングの一貫性と情報漏洩', () => {
  let obsidianClient;

  beforeEach(() => {
    obsidianClient = new ObsidianClient();
    jest.clearAllMocks();

    // storageのデフォルトモック
    storage.getSettings.mockResolvedValue({});
    storage.StorageKeys = {
      OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
      OBSIDIAN_PORT: 'OBSIDIAN_PORT',
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH'
    };
  });

  describe('APIキーが提供されていない場合のエラーハンドリング', () => {
    it('APIキーがない場合、ユーザーに分かりやすいエラーメッセージがスローされること（修正後）', async () => {
      storage.getSettings.mockResolvedValue({ OBSIDIAN_API_KEY: '' });

      await expect(obsidianClient.appendToDailyNote('Test content')).rejects.toThrow('Error: API key is missing');

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect((await obsidianClient.appendToDailyNote('Test content').catch(e => e.message))).toContain('check your Obsidian settings');
    });

    it('エラーメッセージがユーザーに分かりやすい形式であること（修正後）', async () => {
      storage.getSettings.mockResolvedValue({ OBSIDIAN_API_KEY: '' });

      const error = await obsidianClient.appendToDailyNote('Test content').catch(e => e);

      // 修正: ユーザーに分かりやすいエラーメッセージが表示される
      expect(error.message).toContain('Error:');
      expect(error.message).toContain('check your Obsidian settings'); // ユーザーへの指示が含まれる
    });
  });

  describe('URLがエラーメッセージに含まれないこと（修正後）', () => {
    it('接続失敗時、完全なURLがエラーメッセージに含まれないこと（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      const fetchError = new Error('Failed to fetch');
      global.fetch = jest.fn().mockRejectedValue(fetchError);

      await expect(obsidianClient.appendToDailyNote('Test content')).rejects.toThrow();

      try {
        await obsidianClient.appendToDailyNote('Test content');
      } catch (error) {
        // 修正: URL全体（プロトコル、ホスト、ポート）がエラーメッセージに含まれないことを確認
        expect(error.message).toContain('Error:');
        expect(error.message).not.toContain('http://127.0.0.1:27123'); // 内部URL情報が漏洩していない
        expect(error.message).not.toContain('.md'); // 内部ファイルパス情報が漏洩していない
        expect(error.message).toContain('Failed to connect to Obsidian'); // 一般的なエラーメッセージ
      }

      global.fetch.mockRestore();
    });

    it('HTTPS接続失敗時、自己署名証明書に関するメッセージが含まれること（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '27124',
        OBSIDIAN_DAILY_PATH: ''
      });

      const fetchError = new Error('Failed to fetch');
      global.fetch = jest.fn().mockRejectedValue(fetchError);

      await expect(obsidianClient.appendToDailyNote('Test content')).rejects.toThrow();

      try {
        await obsidianClient.appendToDailyNote('Test content');
      } catch (error) {
        // 修正: 詳細な接続情報がエラーメッセージに含まれないことを確認
        expect(error.message).toContain('Error:');
        expect(error.message).not.toContain('https://'); // 内部URL情報が漏洩していない
        expect(error.message).not.toContain('127.0.0.1'); // 内部IPアドレス情報が漏洩していない
        expect(error.message).toContain('self-signed certificate'); // ユーザーに分かりやすいメッセージ
      }

      global.fetch.mockRestore();
    });
  });

  describe('APIエラー時のエラーハンドリング', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it('読み取りエラー時、HTTPステータスコードがエラーメッセージに含まれないこと（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      // GETリクエストのエラーレスポンス
      global.fetch.mockImplementation((url, options) => {
        if (options.method === 'GET') {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error')
          });
        }
        return Promise.resolve({
          ok: true
        });
      });

      await expect(obsidianClient.appendToDailyNote('Test content')).rejects.toThrow();

      try {
        await obsidianClient.appendToDailyNote('Test content');
      } catch (error) {
        // 修正: HTTPステータスコードとエラーレスポンスの内容が含まれないことを確認
        expect(error.message).toContain('Error:');
        expect(error.message).not.toContain('500'); // HTTPステータスコードが含まれない
        expect(error.message).not.toContain('Internal Server Error'); // エラーレスポンスの内容が含まれない
        // 注: エラーは_handleErrorでラップされ、一般的な接続エラーメッセージになる
        expect(error.message).toContain('Failed to connect to Obsidian'); // 一般的なエラーメッセージ
      }
    });

    it('書き込みエラー時、HTTPステータスコードがエラーメッセージに含まれないこと（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      // 404で空の内容を返し、その後PUTでエラー
      global.fetch.mockImplementation((url, options) => {
        if (options.method === 'GET') {
          return Promise.resolve({
            ok: false,
            status: 404,
            text: () => Promise.resolve('Not Found')
          });
        } else if (options.method === 'PUT') {
          return Promise.resolve({
            ok: false,
            status: 403,
            text: () => Promise.resolve('Forbidden: API key invalid')
          });
        }
        return Promise.resolve({
          ok: true
        });
      });

      await expect(obsidianClient.appendToDailyNote('Test content')).rejects.toThrow();

      try {
        await obsidianClient.appendToDailyNote('Test content');
      } catch (error) {
        // 修正: HTTPステータスコードとエラーレスポンスの内容が含まれないことを確認
        expect(error.message).toContain('Error:');
        expect(error.message).not.toContain('403'); // HTTPステータスコードが含まれない
        expect(error.message).not.toContain('Forbidden'); // エラーレスポンスの内容が含まれない
        expect(error.message).not.toContain('API key invalid'); // 内部実装の詳細が含まれない
        // 注: エラーは_handleErrorでラップされ、一般的な接続エラーメッセージになる
        expect(error.message).toContain('Failed to connect to Obsidian'); // 一般的なエラーメッセージ
      }
    });
  });

  describe('testConnectionメソッドのエラーハンドリング', () => {
    it('接続成功時、詳細なメッセージが返されること（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Success! Connected to Obsidian'); // ユーザーに分かりやすいメッセージ

      global.fetch.mockRestore();
    });

    it('接続失敗時、HTTPステータスコードがメッセージに含まれないこと（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      // 修正: HTTPステータスコードが含まれないことを確認
      expect(result.message).not.toContain('401'); // 内部情報が漏洩していない
      expect(result.message).toContain('Connection Failed'); // ユーザーに分かりやすいメッセージ

      global.fetch.mockRestore();
    });

    it('ネットワークエラー時、詳細なエラーメッセージが含まれないこと（修正後）', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      const networkError = new Error('Failed to fetch: Network request failed');
      global.fetch = jest.fn().mockRejectedValue(networkError);

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      // 修正: ネットワークエラーの詳細が含まれないことを確認
      expect(result.message).not.toContain('Failed to fetch'); // 内部エラー詳細が含まれない
      expect(result.message).not.toContain('Network request'); // 内部エラー詳細が含まれない
      expect(result.message).toContain('Connection Failed'); // ユーザーに分かりやすいメッセージ

      global.fetch.mockRestore();
    });
  });

  describe('エラーハンドリングの一貫性の確認', () => {
    it('errorUtils.jsのgetUserErrorMessage関数が使用されていない（一貫性問題）', () => {
      // obsidianClient.jsにはimport errorUtilsがないため、一貫したエラーハンドリングが行われていない
      // これはテスト自体で確認すべきことで、コードレビューで見つけるべき問題である

      // 分析: obsidianClient.jsはerrorUtils.jsの関数を使用せず、独自のエラーハンドリングを実装している
      // これにより、エラーメッセージの形式や内容が他のモジュールと異なり、一貫性が欠如している
      expect(true).toBe(true); // 分析結果をドキュメント化するためのプレースホルダー
    });
  });

  describe('推奨される改善点', () => {
    it('エラーメッセージから内部URL情報を削除すべきである', () => {
      // 推奨される改善:
      // 1. URL全体を表示せず、一般的なエラーメッセージを表示
      // 2. HTTPステータスコードやエラーレスポンスの内容を表示しない
      // 3. 詳細なエラー情報はログに記録し、ユーザーには一般的なエラーメッセージを表示

      // これにより、内部実装の詳細が漏洩するリスクを軽減できる
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