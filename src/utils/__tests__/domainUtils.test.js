/**
 * domainUtils.test.js
 * ドメインユーティリティ関数のテスト
 * 【テスト対象】: src/utils/domainUtils.js
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  extractDomain,
  matchesPattern,
  isDomainInList,
  isValidDomain,
  isDomainAllowed,
  parseDomainList,
  validateDomainList
} from '../domainUtils.ts';
import { isUrlBlocked } from '../ublockMatcher.ts';
import { getSettings } from '../storage.ts';

// Mock ublockMatcher.js
jest.mock('../ublockMatcher.ts', () => ({
  __esModule: true,
  isUrlBlocked: jest.fn()
}));

// Mock storage.js
jest.mock('../storage.ts', () => ({
  __esModule: true,
  StorageKeys: {
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    UBLOCK_RULES: 'ublock_rules',
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled',
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled'
  },
  getSettings: jest.fn()
}));

describe('domainUtils', () => {
  // 【テスト前準備】: 各テスト実行前にChrome APIのモックをクリア
  // 【環境初期化】: 前のテストの影響を受けないよう、モックの呼び出し履歴をリセット
  // 【テスト前準備】: 各テスト実行前にChrome APIのモックをクリア
  // 【環境初期化】: 前のテストの影響を受けないよう、モックの呼び出し履歴をリセット
  beforeEach(() => {
    jest.clearAllMocks();
    isUrlBlocked.mockReset();
    isUrlBlocked.mockResolvedValue(false);
    getSettings.mockReset();
    getSettings.mockResolvedValue({});
  });

  describe('extractDomain', () => {
    test('標準的なHTTP URLからドメインを正しく抽出できる', () => {
      // 【テスト目的】: extractDomain関数の基本動作を確認
      // 【テスト内容】: 標準的なHTTP URLからホスト名のみを抽出する処理をテスト
      // 【期待される動作】: URLオブジェクトのhostnameプロパティが正しく取得される
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 13-27行目）を直接参照

      // 【テストデータ準備】: 最も一般的なHTTP URLの形式を用意
      // 【初期条件設定】: プロトコル、ドメイン、パスがすべて含まれていることを確認
      const url = 'http://example.com/path/to/page';

      // 【実際の処理実行】: extractDomain関数を呼び出し
      // 【処理内容】: URLをパースし、ホスト名部分を抽出する
      const result = extractDomain(url);

      // 【結果検証】: 期待値との一致を確認
      // 【期待値確認】: プロトコルとパスが除外され、ドメインのみが返されることを確認
      expect(result).toBe('example.com'); // 【確認内容】: ホスト名のみが正しく抽出されることを確認 🟢
    });

    test('www付きドメインからwwwを除去して抽出できる', () => {
      // 【テスト目的】: www正規化機能の確認
      // 【テスト内容】: www.example.comがexample.comに正規化されることをテスト
      // 【期待される動作】: hostnameからwww.プレフィックスが削除される
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 18-21行目）を直接参照

      // 【テストデータ準備】: wwwサブドメイン付きのURLを用意
      const url = 'https://www.example.com/';

      // 【実際の処理実行】: extractDomain関数を呼び出し
      const result = extractDomain(url);

      // 【結果検証】: wwwが除去されていることを確認
      expect(result).toBe('example.com'); // 【確認内容】: wwwプレフィックスが正しく削除されることを確認 🟢
    });

    test('不正なURL文字列からドメイン抽出を試みた場合nullを返す', () => {
      // 【テスト目的】: 不正入力に対する堅牢性の確認
      // 【テスト内容】: URLコンストラクタがTypeErrorをthrowするケースのエラーハンドリングをテスト
      // 【期待される動作】: try-catchでエラーをキャッチし、nullを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 23-25行目）を直接参照

      // 【テストデータ準備】: プロトコルが無く、URLオブジェクトとして解析不可能な文字列を用意
      // 【初期条件設定】: 不正なURL形式であることを前提とする
      const invalidUrl = 'not-a-valid-url';

      // 【実際の処理実行】: extractDomain関数を呼び出し
      // 【処理内容】: URLコンストラクタがエラーをthrowし、catchブロックでnullを返す
      const result = extractDomain(invalidUrl);

      // 【結果検証】: nullが返されることを確認
      // 【期待値確認】: 例外をthrowせず、nullを返すことでシステムの安定性を保つ
      expect(result).toBeNull(); // 【確認内容】: 不正なURLに対してnullが返されることを確認 🟢
    });
  });

  describe('matchesPattern', () => {
    test('ワイルドカード無しパターンで完全一致を検出できる', () => {
      // 【テスト目的】: 基本的なパターンマッチング機能の確認
      // 【テスト内容】: ワイルドカード無しの場合の大文字小文字を区別しない完全一致をテスト
      // 【期待される動作】: 文字列の大文字小文字を無視して完全一致を判定
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 46-47行目）を直接参照

      // 【テストデータ準備】: シンプルな完全一致ケースを用意
      const domain = 'example.com';
      const pattern = 'example.com';

      // 【実際の処理実行】: matchesPattern関数を呼び出し
      // 【処理内容】: toLowerCase()による正規化と === による比較を実行
      const result = matchesPattern(domain, pattern);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: 完全一致するドメインがtrueを返すことを確認 🟢
    });

    test('ワイルドカードパターンでサブドメインをマッチできる', () => {
      // 【テスト目的】: ワイルドカード機能の基本動作確認
      // 【テスト内容】: *.example.com パターンで sub.example.com をマッチさせる処理をテスト
      // 【期待される動作】: ワイルドカードを正規表現に変換してマッチング
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 36-44行目）を直接参照

      // 【テストデータ準備】: サブドメインを含むドメインとワイルドカードパターンを用意
      const domain = 'sub.example.com';
      const pattern = '*.example.com';

      // 【実際の処理実行】: matchesPattern関数を呼び出し
      // 【処理内容】: replace(/\*/g, '.*')による変換とRegExpマッチングを実行
      const result = matchesPattern(domain, pattern);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: ワイルドカードパターンが正しくマッチすることを確認 🟢
    });

    test('空文字列パターンでのマッチング動作を確認', () => {
      // 【テスト目的】: エッジケースでの安定動作確認
      // 【テスト内容】: パターンが空文字列の場合の挙動をテスト
      // 【期待される動作】: 空パターンは何にもマッチしないと定義
      // 🟡 信頼性レベル: 既存実装では明示的な空文字列ハンドリングなし、実装挙動を確認する必要あり

      // 【テストデータ準備】: 通常のドメインと空文字列パターンを用意
      const domain = 'example.com';
      const pattern = '';

      // 【実際の処理実行】: matchesPattern関数を呼び出し
      const result = matchesPattern(domain, pattern);

      // 【結果検証】: falseが返されることを確認
      // 【期待値確認】: 空パターンは何にもマッチしないべき
      expect(result).toBe(false); // 【確認内容】: 空文字列パターンがfalseを返すことを確認 🟡
    });

    test('複数のワイルドカードを含むパターンを正しく処理できる', () => {
      // 【テスト目的】: 複雑なパターンマッチングの確認
      // 【テスト内容】: 複数階層のサブドメインを表現するパターンをテスト
      // 【期待される動作】: 各ワイルドカードが独立して .* に変換され、正しくマッチ
      // 🟡 信頼性レベル: 既存実装では複数ワイルドカードの明示的なテストなし、動作確認が必要

      // 【テストデータ準備】: 複数階層のサブドメインとワイルドカードパターンを用意
      const domain = 'sub.api.example.com';
      const pattern = '*.*.example.com';

      // 【実際の処理実行】: matchesPattern関数を呼び出し
      const result = matchesPattern(domain, pattern);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: 複数ワイルドカードが正しく動作することを確認 🟡
    });
  });

  describe('isDomainInList', () => {
    test('ドメインリストに含まれるドメインを正しく検出できる', () => {
      // 【テスト目的】: リストマッチング機能の基本確認
      // 【テスト内容】: 配列内のパターンと照合して含まれているかを判定する処理をテスト
      // 【期待される動作】: someメソッドでいずれかのパターンにマッチすればtrueを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 56-62行目）を直接参照

      // 【テストデータ準備】: ホワイトリスト/ブラックリストの典型的な使用ケースを用意
      const domain = 'example.com';
      const domainList = ['example.com', 'test.com'];

      // 【実際の処理実行】: isDomainInList関数を呼び出し
      const result = isDomainInList(domain, domainList);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: リスト内のドメインが正しく検出されることを確認 🟢
    });

    test('ドメインリストが空配列の場合は常にfalseを返す', () => {
      // 【テスト目的】: 空コレクションに対する堅牢性確認
      // 【テスト内容】: リストが空の場合の早期リターンをテスト
      // 【期待される動作】: 空配列でも例外が発生せず、falseを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 57-59行目）を直接参照

      // 【テストデータ準備】: 通常のドメインと空配列を用意
      const domain = 'example.com';
      const domainList = [];

      // 【実際の処理実行】: isDomainInList関数を呼び出し
      const result = isDomainInList(domain, domainList);

      // 【結果検証】: falseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: 空配列に対してfalseが返されることを確認 🟢
    });
  });

  describe('isValidDomain', () => {
    test('標準的なドメイン形式を有効と判定できる', () => {
      // 【テスト目的】: ドメインバリデーションの基本機能確認
      // 【テスト内容】: 正規表現による基本的なドメイン形式の検証をテスト
      // 【期待される動作】: [a-z0-9.-]の組み合わせで構成されたドメインを有効と判定
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 69-79行目）を直接参照

      // 【テストデータ準備】: 最も標準的なドメイン形式を用意
      const domain = 'example.com';

      // 【実際の処理実行】: isValidDomain関数を呼び出し
      const result = isValidDomain(domain);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: RFC準拠の有効なドメイン形式がtrueを返すことを確認 🟢
    });

    test('特殊文字を含む不正なドメインを検出できる', () => {
      // 【テスト目的】: セキュリティバリデーションの確認
      // 【テスト内容】: ドメイン名に使用不可能な文字が含まれるケースをテスト
      // 【期待される動作】: 不正なドメインを拒否し、後続処理に渡さない
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 75行目の正規表現）を直接参照

      // 【テストデータ準備】: XSS攻撃を想定した不正なドメインを用意
      const domain = 'example<script>.com';

      // 【実際の処理実行】: isValidDomain関数を呼び出し
      const result = isValidDomain(domain);

      // 【結果検証】: falseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: 特殊文字を含むドメインがfalseを返すことを確認 🟢
    });

    test('RFC準拠の最大長ドメイン（253文字）を有効と判定できる', () => {
      // 【テスト目的】: パフォーマンスと仕様準拠の確認
      // 【テスト内容】: RFC 1035で規定された最大長のドメインをテスト
      // 【期待される動作】: 正規表現が長大な入力でもパフォーマンス劣化しない
      // 🟡 信頼性レベル: 既存実装では最大長チェックなし、RFCとの整合性要確認

      // 【テストデータ準備】: RFC 1035準拠の最大長ドメインを用意（63文字ラベル x 複数）
      // 各ラベルは最大63文字、全体で最大253文字
      const longDomain = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);

      // 【実際の処理実行】: isValidDomain関数を呼び出し
      const result = isValidDomain(longDomain);

      // 【結果検証】: trueが返されることを確認
      // 【期待値確認】: RFC準拠の長大なドメインも有効と判定されるべき
      expect(result).toBe(true); // 【確認内容】: 最大長ドメインが正しく処理されることを確認 🟡
    });
  });

  describe('isDomainAllowed', () => {
    test('ドメインフィルターが無効な場合は全てのドメインを許可する', async () => {
      // 【テスト目的】: フィルター無効時の動作確認
      // 【テスト内容】: mode === 'disabled' の場合の早期リターンをテスト
      // 【期待される動作】: 設定がdisabledの場合、ドメインチェックをスキップしてtrueを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 91-93行目）を直接参照、chrome.storage.localのmock化が必要

      // 【テストデータ準備】: フィルター機能を使用しないケースのモックデータを用意
      // 【初期条件設定】: chrome.storage.localのgetメソッドをモック
      getSettings.mockResolvedValue({ domain_filter_mode: 'disabled' });

      const url = 'https://any-domain.com';

      // 【実際の処理実行】: isDomainAllowed関数を呼び出し
      // 【処理内容】: getSettings経由でchrome.storage.localから設定を取得し、mode判定を実行
      const result = await isDomainAllowed(url);

      // 【結果検証】: trueが返されることを確認
      // 【期待値確認】: フィルター無効時は全てのドメインを許可する仕様
      expect(result).toBe(true); // 【確認内容】: フィルター無効時に全ドメインが許可されることを確認 🟢
    });

    test('ホワイトリストモードで登録済みドメインを許可する', async () => {
      // 【テスト目的】: ホワイトリストフィルタリング機能の確認
      // 【テスト内容】: ホワイトリストに含まれるドメインのみtrueを返す機能をテスト
      // 【期待される動作】: isDomainInListでホワイトリストと照合し、含まれていればtrueを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 103-105行目）を直接参照、chrome.storage.localのmock化が必要

      // 【テストデータ準備】: ホワイトリストモードの設定をモック
      getSettings.mockResolvedValue({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['allowed.com']
      });

      const url = 'https://allowed.com/page';

      // 【実際の処理実行】: isDomainAllowed関数を呼び出し
      const result = await isDomainAllowed(url);

      // 【結果検証】: trueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: ホワイトリスト登録ドメインが許可されることを確認 🟢
    });

    test('ブラックリストモードで登録済みドメインを拒否する', async () => {
      // 【テスト目的】: ブラックリストフィルタリング機能の確認
      // 【テスト内容】: ブラックリストに含まれるドメインのみfalseを返す機能をテスト
      // 【期待される動作】: isDomainInListでブラックリストと照合し、含まれていればfalseを返す
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 106-108行目）を直接参照、chrome.storage.localのmock化が必要

      // 【テストデータ準備】: ブラックリストモードの設定をモック
      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        domain_blacklist: ['blocked.com']
      });

      const url = 'https://blocked.com/page';

      // 【実際の処理実行】: isDomainAllowed関数を呼び出し
      const result = await isDomainAllowed(url);

      // 【結果検証】: falseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: ブラックリスト登録ドメインが拒否されることを確認 🟢
    });

    test('ドメイン抽出に失敗した場合はfalseを返す', async () => {
      // 【テスト目的】: エラーハンドリングの確認
      // 【テスト内容】: extractDomainがnullを返した場合の処理をテスト
      // 【期待される動作】: 不正なURLは許可しない
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 95-98行目）を直接参照

      // 【テストデータ準備】: フィルター設定をモック（モード問わず）
      getSettings.mockResolvedValue({ domain_filter_mode: 'whitelist' });

      const invalidUrl = 'invalid-url';

      // 【実際の処理実行】: isDomainAllowed関数を呼び出し
      const result = await isDomainAllowed(invalidUrl);

      // 【結果検証】: falseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: 不正なURLに対してfalse?が返されることを確認 🟢
    });

    test('シンプル形式とuBlock形式の両方が有効な場合の併用動作を確認', async () => {
      // both enabled, blacklisted in simple
      isUrlBlocked.mockResolvedValue(true); // Default to blocked for mocked ublock check

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ domain: 'blocked-ublock.com', type: 'block' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      // Override isUrlBlocked behavior for specific test cases
      isUrlBlocked.mockImplementation(async (url) => {
        if (url.includes('blocked-ublock.com')) return true;
        return false;
      });

      // cases
      expect(await isDomainAllowed('https://allowed.com')).toBe(true);
      expect(await isDomainAllowed('https://blocked-simple.com')).toBe(false);
      expect(await isDomainAllowed('https://blocked-ublock.com')).toBe(false);
    });

    test('片方のみ有効な場合の動作を確認', async () => {
      // simple enabled, ublock disabled
      // uBlock mocked to block generally to prove it's ignored
      isUrlBlocked.mockResolvedValue(true);

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked.com'],
        ublock_format_enabled: false,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'allowed-because-disabled.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      expect(await isDomainAllowed('https://blocked.com')).toBe(false);
      expect(await isDomainAllowed('https://allowed-because-disabled.com')).toBe(true);
    });
  });

  // UF-501: Additional tests for simultaneous Simple and uBlock filtering
  describe('LOG-006: uBlock block rule - blocked', () => {
    test('Verify uBlock block rule blocks URL', async () => {
      // 【テスト目的】: uBlockブロックルールがURLをブロックすることを確認
      // 【テスト内容】: uBlock形式のブロックルールが正しく動作することを確認
      // 【期待される動作】: uBlockルールに一致するURLがブロックされる

      // 【テストデータ準備】: isUrlBlockedをモックしてブロックを返す
      isUrlBlocked.mockResolvedValue(true);

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      const result = await isDomainAllowed('https://blocked.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-007: uBlock exception rule - allowed', () => {
    test('Verify uBlock exception rule allows URL', async () => {
      // 【テスト目的】: uBlock例外ルールがURLを許可することを確認
      // 【テスト内容】: uBlock形式の例外ルールが正しく動作することを確認
      // 【期待される動作】: uBlock例外ルールに一致するURLが許可される

      isUrlBlocked.mockResolvedValue(false); // Exception rule means NOT blocked

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', pattern: '*.com' }],
          exceptionRules: [{ type: 'hostname', domain: 'allowed.com' }],
          ruleCount: 2
        }
      });

      const result = await isDomainAllowed('https://allowed.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-008: Both enabled - Simple blocks', () => {
    test('Verify Simple blocks when both enabled', async () => {
      // 【テスト目的】: 両方有効時、Simpleがブロックすることを確認
      // 【テスト内容】: Simpleブラックリストに含まれるドメインがブロックされることを確認
      // 【期待される動作】: Simpleルールが優先され、URLがブロックされる

      isUrlBlocked.mockResolvedValue(false); // uBlock allows

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      });

      const result = await isDomainAllowed('https://blocked-simple.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-009: Both enabled - uBlock blocks', () => {
    test('Verify uBlock blocks when both enabled', async () => {
      // 【テスト目的】: 両方有効時、uBlockがブロックすることを確認
      // 【テスト内容】: uBlockルールに一致するURLがブロックされることを確認
      // 【期待される動作】: uBlockルールが評価され、URLがブロックされる

      // 【テストデータ準備】: isUrlBlockedをモックしてブロックを返す
      isUrlBlocked.mockResolvedValue(true);

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist', // Simple filter disabled or empty
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-ublock.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      const result = await isDomainAllowed('https://blocked-ublock.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-010: Both enabled - both block', () => {
    test('Verify both block when both enabled', async () => {
      // 【テスト目的】: 両方有効時、両方がブロックすることを確認
      // 【テスト内容】: SimpleとuBlockの両方に一致するURLがブロックされることを確認
      // 【期待される動作】: 両方のルールが評価され、URLがブロックされる

      isUrlBlocked.mockResolvedValue(true);

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-both.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-both.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      const result = await isDomainAllowed('https://blocked-both.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-011: Both enabled - both allow', () => {
    test('Verify both allow when both enabled', async () => {
      // 【テスト目的】: 両方有効時、両方が許可することを確認
      // 【テスト内容】: どちらのルールにも一致しないURLが許可されることを確認
      // 【期待される動作】: 両方のルールが評価され、URLが許可される

      isUrlBlocked.mockResolvedValue(false);

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      });

      const result = await isDomainAllowed('https://allowed.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-012: Simple only - uBlock ignored', () => {
    test('Verify uBlock ignored when Simple only', async () => {
      // 【テスト目的】: Simpleのみ有効時、uBlockが無視されることを確認
      // 【テスト内容】: uBlockルールが存在しても評価されないことを確認
      // 【期待される動作】: uBlockルールが無視され、Simpleルールのみが評価される

      isUrlBlocked.mockResolvedValue(true); // Should be ignored

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: false,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-by-ublock.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      });

      const result = await isDomainAllowed('https://blocked-by-ublock.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-013: uBlock only - Simple ignored', () => {
    test('Verify Simple ignored when uBlock only', async () => {
      // 【テスト目的】: uBlockのみ有効時、Simpleが無視されることを確認
      // 【テスト内容】: Simpleルールが存在しても評価されないことを確認
      // 【期待される動作】: Simpleルールが無視され、uBlockルールのみが評価される

      isUrlBlocked.mockResolvedValue(false); // uBlock allows

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        domain_blacklist: ['blocked-by-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      });

      const result = await isDomainAllowed('https://blocked-by-simple.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-015: Empty rules - all allowed', () => {
    test('Verify empty rules allow all', async () => {
      // 【テスト目的】: 空のルールですべてが許可されることを確認
      // 【テスト内容】: 両方のルールが空の場合、すべてのURLが許可されることを確認
      // 【期待される動作】: 空のルールでtrueが返される

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      });

      const result = await isDomainAllowed('https://any-domain.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-016: Wildcard in Simple list', () => {
    test('Verify wildcard patterns work', async () => {
      // 【テスト目的】: Simpleリストのワイルドカードパターンが動作することを確認
      // 【テスト内容】: *.example.comパターンがサブドメインにマッチすることを確認
      // 【期待される動作】: ワイルドカードパターンが正しくマッチする

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['*.example.com'],
        ublock_format_enabled: false
      });

      const result1 = await isDomainAllowed('https://sub.example.com/page');
      const result2 = await isDomainAllowed('https://another.example.com/page');
      const result3 = await isDomainAllowed('https://other.com/page');

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });

  describe('LOG-018: uBlock exception overrides block', () => {
    test('Verify exception overrides block', async () => {
      // 【テスト目的】: uBlock例外ルールがブロックルールを上書きすることを確認
      // 【テスト内容】: ブロックルールと例外ルールが両方存在する場合、例外が優先されることを確認
      // 【期待される動作】: 例外ルールが優先され、URLが許可される

      getSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'example.com' }],
          exceptionRules: [{ type: 'hostname', domain: 'example.com' }],
          ruleCount: 2
        }
      });

      const result = await isDomainAllowed('https://example.com/page');
      expect(result).toBe(true);
    });
  });

  describe('parseDomainList', () => {
    test('大量のドメインリスト（1000行）を正しくパースできる', () => {
      // 【テスト目的】: スケーラビリティの確認
      // 【テスト内容】: 企業の大規模ブラックリストを想定した大量データのパース処理をテスト
      // 【期待される動作】: すべての行が正しくパースされ、1000要素の配列が返される
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 120-129行目）を直接参照、パフォーマンステストとして実施

      // 【テストデータ準備】: 1000行のドメインリスト文字列を生成
      const domainLines = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`);
      const text = domainLines.join('\n');

      // 【実際の処理実行】: parseDomainList関数を呼び出し
      // 【処理内容】: 改行区切りの文字列を配列に変換し、空行を除外
      const result = parseDomainList(text);

      // 【結果検証】: 1000要素の配列が返されることを確認
      expect(result).toHaveLength(1000); // 【確認内容】: すべての行が正しくパースされることを確認 🟢
      expect(result[0]).toBe('domain0.com'); // 【確認内容】: 1行目が正しくパースされることを確認 🟢
      expect(result[999]).toBe('domain999.com'); // 【確認内容】: 最終行が正しくパースされることを確認 🟢
    });
  });

  describe('validateDomainList', () => {
    test('有効と無効なドメインが混在するリストのエラーを正しく報告できる', () => {
      // 【テスト目的】: 包括的なバリデーションの確認
      // 【テスト内容】: 実際のユーザー入力で発生しうる混在ケースのバリデーションをテスト
      // 【期待される動作】: すべての無効ドメインがエラーとして報告される
      // 🟢 信頼性レベル: 既存実装（domainUtils.js 136-151行目）を直接参照

      // 【テストデータ準備】: 有効・無効ドメインが混在するリストを用意
      const domainList = ['valid.com', 'invalid<>.com', 'another-valid.com', 'bad domain'];

      // 【実際の処理実行】: validateDomainList関数を呼び出し
      // 【処理内容】: 各ドメインのバリデーションを実行し、エラー配列を生成
      const errors = validateDomainList(domainList);

      // 【結果検証】: エラー配列に2つのエラーメッセージが含まれることを確認
      expect(errors).toHaveLength(2); // 【確認内容】: 無効なドメインが2つ検出されることを確認 🟢
      expect(errors[0]).toContain('2行目'); // 【確認内容】: 2行目のエラーが報告されることを確認 🟢
      expect(errors[0]).toContain('invalid<>.com'); // 【確認内容】: 無効なドメイン名がエラーメッセージに含まれることを確認 🟢
      expect(errors[1]).toContain('4行目'); // 【確認内容】: 4行目のエラーが報告されることを確認 🟢
      expect(errors[1]).toContain('bad domain'); // 【確認内容】: 無効なドメイン名がエラーメッセージに含まれることを確認 🟢
    });
  });
});
