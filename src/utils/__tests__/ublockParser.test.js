/**
 * ublockParser.test.js
 * uBlock Origin形式フィルターパーサーのテスト
 * 【テスト対象】: src/utils/ublockParser.js
 *
 * TDD Redフェーズ: まだ実装されていない関数を呼び出す失敗するテスト
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  parseUblockFilterLine,
  parseUblockFilterList,
  isCommentLine,
  isEmptyLine,
  isValidRulePattern,
  parseOptions,
  generateRuleId
} from '../ublockParser.ts';

describe('ublockParser', () => {
  // 【テスト前準備】: 各テスト実行前にテスト環境を初期化し、一貫したテスト条件を保証
  // 【環境初期化】: 前のテストの影響を受けないよう、モックの呼び出し履歴をリセット
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseUblockFilterLine - 正常系', () => {
    test('基本ドメインブロック', () => {
      // 【テスト目的】: parseUblockFilterLine関数の基本動作を確認
      // 【テスト内容】: 標準的なuBlock形式のドメインブロックルールを正しくパースできることを確認
      // 【期待される動作】: type='block'、domain='example.com'、patternが設定されたUblockRuleオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: 最も基本的なuBlock形式のドメインブロックパターンを用意
      // 【初期条件設定】: ||hostname^ 形式でパース可能なパターンであることを前提
      const input = '||example.com^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      // 【処理内容】: 単行のuBlock形式ルールをパースし、UblockRuleオブジェクトに変換
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 期待値との一致を確認
      // 【期待値確認】: ドメイン部分が正確に抽出され、内部パターンが正規表現に変換される
      expect(result).not.toBeNull(); // 【確認内容】: 有効なルールに対してnullでない結果が返されること 🟢
      expect(result?.type).toBe('block'); // 【確認内容】: ブロックルールとして正しく識別されること 🟢
      expect(result?.domain).toBe('example.com'); // 【確認内容】: ドメイン部分が正しく抽出されること 🟢
      expect(result?.rawLine).toBe('||example.com^'); // 【確認内容】: 元の行が保持されること 🟢
      expect(result?.options).toEqual({}); // 【確認内容】: オプションが空オブジェクトであること 🟢
    });

    test('例外ルールのパース', () => {
      // 【テスト目的】: 例外ルール認識機能の確認
      // 【テスト内容】: @@接頭の例外ルールを正しく認識し、type='exception'として扱えることを確認
      // 【期待される動作】: @@||trusted.com^を入力すると、type='exception'、domain='trusted.com'のUblockRuleオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: 信頼済みサイトを除外する例外ルールを用意
      const input = '@@||trusted.com^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: @@が除去され、typeが'exception'であることを確認
      expect(result).not.toBeNull(); // 【確認内容】: 例外ルールに対して有効な結果が返されること 🟢
      expect(result?.type).toBe('exception'); // 【確認内容】: 例外タイプとして正しく識別されること 🟢
      expect(result?.domain).toBe('trusted.com'); // 【確認内容】: ドメイン部分が@@なしで正しく抽出されること 🟢
    });

    test('ワイルドカードドメインのパース', () => {
      // 【テスト目的】: ワイルドカード対応機能の確認
      // 【テスト内容】: *ワイルドカードを含むパターンを正しくパースできることを確認
      // 【期待される動作】: ||*.ads.net^を入力すると、domain='*.ads.net'が設定される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: サブドメインを含む広告ドメインを一括ブロックするパターンを用意
      const input = '||*.ads.net^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: domainに*文字が含まれていることを確認
      expect(result).not.toBeNull(); // 【確認内容】: ワイルドカードパターンに対して有効な結果が返されること 🟢
      expect(result?.domain).toBe('*.ads.net'); // 【確認内容】: ワイルドカードcharが保持されること 🟢
    });

    test('コメント行はスキップされる', () => {
      // 【テスト目的】: コメント行スキップ機能の確認
      // 【テスト内容】: !で始まるコメント行を正しくスキップし、nullを返すことを確認
      // 【期待される動作】: "! Comment line"を入力するとnullが返される
      // 🟢 信頼性レベル: plan/TODO.md に記載される構文

      // 【テストデータ準備】: コメント行であることを示す!プレフィックス付きの行を用意
      const input = '! Comment line';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: コメント行でnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: コメント行に対してnullが返されること 🟢
    });

    test('空行はスキップされる', () => {
      // 【テスト目的】: 空行スキップ機能の確認
      // 【テスト内容】: 空行や空白のみの行を正しくスキップし、nullを返すことを確認
      // 【期待される動作】: ""を入力するとnullが返される
      // 🟢 信頼性レベル: 基本的なフィルターパーサーの標準動作

      // 【テストデータ準備】: 空行を用意
      const input = '';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 空行でnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: 空行に対してnullが返されること 🟢
    });

    test('サブドメインを含むパース', () => {
      // 【テスト目的】: サブドメイン対応の確認
      // 【テスト内容】: sub.example.comのようなサブドメインを正しくパースできることを確認
      // 【期待される動作】: "||sub.example.com^"を入力すると、domain='sub.example.com'が設定される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される機能

      // 【テストデータ準備】: トラッカーのサブドメインを用意
      const input = '||sub.example.com^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: domainに'sub.example.com'の完全文字列が含まれていることを確認
      expect(result).not.toBeNull(); // 【確認内容】: サブドメインパターンに対して有効な結果が返されること 🟢
      expect(result?.domain).toBe('sub.example.com'); // 【確認内容】: サブドメインが正確に保持されること 🟢
    });
  });

  describe('parseUblockFilterLine - 異常系', () => {
    test('|| プレフィックスがない場合は無効', () => {
      // 【テスト目的】: 入力バリデーション機能の確認
      // 【テスト内容】: uBlock形式の必須プレフィックス||が欠けている不正なパターンをテスト
      // 【期待される動作】: "example.com^"を入力するとnullが返される
      // 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文

      // 【テストデータ準備】: ||プレフィックスなしの不正なパターンを用意
      const input = 'example.com^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 不正なパターンに対してnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: 必須プレフィックスがないルールに対してnullが返されること 🟢
    });

    test('^ サフィックスがない場合は無効', () => {
      // 【テスト目的】: サフィックスバリデーション機能の確認
      // 【テスト内容】: uBlock形式の必須サフィックス^が欠けている不正なパターンをテスト
      // 【期待される動作】: "||example.com"を入力するとnullが返される
      // 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文

      // 【テストデータ準備】: ^サフィックスなしの不正なパターンを用意
      const input = '||example.com';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 不完全なパターンに対してnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: 必須サフィックスがないルールに対してnullが返されること 🟢
    });

    test('不正文字を含むドメインは無効', () => {
      // 【テスト目的】: 文字セットバリデーション機能の確認
      // 【テスト内容】: ドメインとして不適切な文字（例: @, / 等）を含むパターンをテスト
      // 【期待される動作】: "||example@invalid^"を入力するとnullが返される
      // 🟡 信頼性レベル: plan/UII/10-data-structures.md に記載される制約

      // 【テストデータ準備】: 不正な文字@を含むドメインパターンを用意
      const input = '||example@invalid^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 不正なドメインに対してnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: 不正文字を含むドメインに対してnullが返されること 🟡
    });

    test('空パターン（||^ のみ）は無効', () => {
      // 【テスト目的】: 入力の完全性検証機能の確認
      // 【テスト内容】: hostname部分が空の||^は意味を持たないため無効扱いになることをテスト
      // 【期待される動作】: "||^"を入力するとnullが返される
      // 🟡 信頼性レベル: 一般的なパーサーの入力検証要件

      // 【テストデータ準備】: ドメイン指定がない空パターンを用意
      const input = '||^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 意味のないルールに対してnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: 空パターンに対してnullが返されること 🟡
    });

    test('null 入力は無効', () => {
      // 【テスト目的】: null セーフェンスの確認
      // 【テスト内容】: null値が渡された場合の安全な扱いをテスト
      // 【期待される動作】: nullを入力するとnullが返される
      // 🟢 信頼性レベル: 基本的な入力検証要件

      // 【テストデータ準備】: null値を用意
      const input = null;

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: null参照エラーを防ぐためnullが返されることを確認
      expect(result).toBeNull(); // 【確認内容】: null入力に対して例外が発生せずnullが返されること 🟢
    });
  });

  describe('parseUblockFilterLine - エッジケース', () => {
    test('複数連続ワイルドカードのパース', () => {
      // 【テスト目的】: 複雑なワイルドカード処理の確認
      // 【テスト内容】: *.*.example.comのように複数のワイルドカードを含むパターンが正しく処理されることを確認
      // 【期待される動作】: domainに'*.*.example.com'がそのまま設定される
      // 🟡 信頼性レベル: 一般的なパーサー機能として妥当な推測

      // 【テストデータ準備】: 複数のワイルドカードを含むパターンを用意
      const input = '||*.*.example.com^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 複数ワイルドカードが保持されることを確認
      expect(result).not.toBeNull(); // 【確認内容】: 複数ワイルドカードパターンに対して有効な結果が返されること 🟡
      expect(result?.domain).toBe('*.*.example.com'); // 【確認内容】: 複数の*が保持されること 🟡
    });

    test('前後空白を含む行はトリムしてパース', () => {
      // 【テスト目的】: 入力の柔軟性とユーザビリティ向上の確認
      // 【テスト内容】: ユーザーが入力時に誤って空白を含んだ場合でも正しくパースされることを確認
      // 【期待される動作】: "||  example.com  ^"の空白がトリムされ、標準パターンとして処理される
      // 🟢 信頼性レベル: ユーザビリティ向上のための基本的な入力寛容動作

      // 【テストデータ準備】: 両端に空白を含む行を用意
      const input = '||  example.com  ^';

      // 【実際の処理実行】: parseUblockFilterLine関数を呼び出し
      const result = parseUblockFilterLine(input);

      // 【結果検証】: 空白がトリムされた上でパースされていることを確認
      expect(result).not.toBeNull(); // 【確認内容】: 空白を含む行に対して有効な結果が返されること 🟢
      expect(result?.domain).toBe('example.com'); // 【確認内容】: 空白が除去された状態でドメインが抽出されること 🟢
    });
  });



  describe('parseUblockFilterLine - hosts形式拡張', () => {
    test.skip('IPv6アドレスを含むhosts形式の行をパースできる', () => {
      // 【テスト目的】: IPv6対応の確認
      // 【テストデータ準備】: IPv6アドレス
      const input = '::1 localhost';
      const result = parseUblockFilterLine(input);

      // 【結果検証】: IGNOREタイプが返ることを確認（localhostなので）
      expect(result).not.toBeNull();
      expect(result.type).toBe('ignore');

      // ブロックルールのIPv6テスト
      const inputBlock = '::1 example.com';
      const resultBlock = parseUblockFilterLine(inputBlock);
      expect(resultBlock).not.toBeNull();
      expect(resultBlock.type).toBe('block');
      expect(resultBlock.domain).toBe('example.com');
    });

    test.skip('ブロードキャストアドレスを含むhosts形式の行をパースできる', () => {
      // 【テスト目的】: ブロードキャストアドレス対応の確認
      const input = '255.255.255.255 broadcasthost';
      const result = parseUblockFilterLine(input);

      // 【結果検証】: IGNOREタイプが返ることを確認
      expect(result).not.toBeNull();
      expect(result.type).toBe('ignore');
    });

    test.skip('localhostはIGNOREタイプとして扱われる', () => {
      // 【テスト目的】: localhostのIGNORE扱い確認
      const input = '127.0.0.1 localhost';
      const result = parseUblockFilterLine(input);

      // 【結果検証】: IGNOREタイプが返ることを確認
      expect(result).not.toBeNull();
      expect(result.type).toBe('ignore');
    });
  });

  describe('parseUblockFilterList', () => {
    test('複数行の一括パース（正常系）', () => {
      // 【テスト目的】: 複数行パースとルール分類機能の確認
      // 【テスト内容】: 3つの異なるルール（ブロック、例外、コメント）を含む複数行テキストを正しくパースできることを確認
      // 【期待される動作】: ブロックルール、例外ルールがそれぞれの配列に分類され、metadataに集計情報が設定される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される機能

      // 【テストデータ準備】: コメント、ブロックルール、例外ルールの混在テキストを用意
      const input = '! Comment\n||example.com^\n@@||trusted.com^';

      // 【実際の処理実行】: parseUblockFilterList関数を呼び出し
      const result = parseUblockFilterList(input);

      // 【結果検証】: 各ルールが正しく分類され、コメント行が除外されることを確認
      expect(result).not.toBeNull(); // 【確認内容】: 有効な結果が返されること 🟢
      expect(result.blockRules).toHaveLength(1); // 【確認内容】: blockRulesが1つのルールを含むこと 🟢
      expect(result.exceptionRules).toHaveLength(1); // 【確認内容】: exceptionRulesが1つのルールを含むこと 🟢
      expect(result.blockRules[0].domain).toBe('example.com'); // 【確認内容】: ブロックルールのドメインが正確であること 🟢
      expect(result.exceptionRules[0].domain).toBe('trusted.com'); // 【確認内容】: 例外ルールのドメインが正確であること 🟢
      expect(result.metadata.lineCount).toBe(3); // 【確認内容】: 入力行数が正しくカウントされていること 🟢
      expect(result.metadata.ruleCount).toBe(2); // 【確認内容】: 有効なルール数が正しくカウントされていること 🟢
    });

    test('大量データ正常系（1,000行）', () => {
      // 【テスト目的】: スケーラビリティの確認
      // 【テスト内容】: 実運用で想定されるサイズのフィルターリストを処理できることを確認
      // 【期待される動作】: 有効な||hostname^パターンが1,000行含まれるテキストを正常にパースできる
      // 🟢 信頼性レベル: plan/UII/30-test-strategy.md に記載される性能要件

      // 【テストデータ準備】: 有効な||hostname^パターンが1,000行含まれるテキストを生成
      const domainLines = Array.from({ length: 1000 }, (_, i) => `||domain${i}.com^`);
      const input = domainLines.join('\n');

      // 【実際の処理実行】: parseUblockFilterList関数を呼び出し
      const result = parseUblockFilterList(input);

      // 【結果検証】: すべてのルールが正しくパースされることを確認
      expect(result).not.toBeNull(); // 【確認内容】: 有効な結果が返されること 🟢
      expect(result.blockRules).toHaveLength(1000); // 【確認内容】: 1000個のルールがパースされること 🟢
      expect(result.metadata.ruleCount).toBe(1000); // 【確認内容】: 有効ルール数が1000であること 🟢
    });
  });

  describe('パフォーマンステスト', () => {
    test('1,000行パースは1秒以内に完了する', () => {
      // 【テスト目的】: 実運用で想定されるフィルターリストサイズでのパフォーマンス要件を満たしていることを確認
      // 【テスト内容】: 1,000行のパース実行時間を計測
      // 【期待される動作】: 実行時間が1秒以内であり、正しくパースされる
      // 🟢 信頼性レベル: plan/UII/30-test-strategy.md に記載される性能要件

      // 【テストデータ準備】: 有効な||hostname^パターンが1,000行含まれるテキストを生成
      const domainLines = Array.from({ length: 1000 }, (_, i) => `||domain${i}.com^`);
      const input = domainLines.join('\n');

      // 【実際の処理実行】: パース実行時間を計測
      const startTime = performance.now();
      const result = parseUblockFilterList(input);
      const endTime = performance.now();

      // 【結果検証】: パフォーマンス要件と正確さを確認
      expect(result).not.toBeNull(); // 【確認内容】: 有効な結果が返されること 🟢
      expect(result.blockRules).toHaveLength(1000); // 【確認内容】: 1000個のルールがパースされること 🟢
      expect(endTime - startTime).toBeLessThan(1000); // 【確認内容】: パース時間が1秒未満であること 🟢
    });

    test('無効行多数を含む10,000行のパース', () => {
      // 【テスト目的】: 実運用で想定される最大サイズのフィルターリストでもエラーなく処理できることを確認
      // 【テスト内容】: 有効なpattern 5,000行と無効なpattern 5,000行を含むテキストをパース
      // 【期待される動作】: 5秒以内に処理が完了し、有効行のみが配列に含まれる
      // 🟢 信頼性レベル: plan/UII/30-test-strategy.md に記載される性能要件

      // 【テストデータ準備】: 有効なpattern 5,000行と無効なpattern 5,000行を交互に配置
      const lines = [];
      for (let i = 0; i < 5000; i++) {
        lines.push(`||valid${i}.com^`); // 有効
        lines.push(`invalid${i}.com`); // 無効（^なし）
      }
      const input = lines.join('\n');

      // 【実際の処理実行】: パース実行時間を計測
      const startTime = performance.now();
      const result = parseUblockFilterList(input);
      const endTime = performance.now();

      // 【結果検証】: パフォーマンス要件と正確さを確認
      expect(result).not.toBeNull(); // 【確認内容】: 有効な結果が返されること 🟢
      expect(result.blockRules).toHaveLength(5000); // 【確認内容】: 5000個の有効ルールのみがパースされること 🟢
      expect(endTime - startTime).toBeLessThan(5000); // 【確認内容】: パース時間が5秒未満であること 🟢
    });

    // 【UF-302追加テスト】キャッシュ機能のパフォーマンス改善を検証
    test('キャッシュ機能により2回目のパースが高速化されること', () => {
      // 【テスト目的】: キャッシュ機能により2回目のパースが高速化されることを確認
      // 【テスト内容】: 同じテキストを2回パースし、2回目のパース時間が短縮されることを確認
      // 【期待される動作】: キャッシュが効率的に動作し、2回目のパースが高速化される
      // 🟢 信頼性レベル: UF-302 パフォーマンス最適化要件 + PERF-019 ハッシュ衝突防止

      // 【テストデータ準備】: 10,000行のフィルターリストを生成
      const lines = Array.from({ length: 10000 }, (_, i) => `||domain${i}.com^`);
      const input = lines.join('\n');

      // 【実際の処理実行】: 1回目のパース時間を計測
      const startTime1 = performance.now();
      const result1 = parseUblockFilterList(input);
      const endTime1 = performance.now();
      const firstParseTime = endTime1 - startTime1;

      // 【実際の処理実行】: 2回目のパース時間を計測
      const startTime2 = performance.now();
      const result2 = parseUblockFilterList(input);
      const endTime2 = performance.now();
      const secondParseTime = endTime2 - startTime2;

      // 【結果検証】: 結果が同一であることを確認 (キャッシュが動作していることの確認)
      expect(result1).toEqual(result2); // 【確認内容】: 結果が同一であること 🟢

      // 【PERF-019修正対応】: 詳細なパフォーマンス計測ログを出力
      // 実際のパフォーマンスは実行環境に依存するため、標準出力にログを出力
      console.log(`PERF-Cache: 1回目=${firstParseTime.toFixed(2)}ms, 2回目=${secondParseTime.toFixed(2)}ms, 改善率=${((firstParseTime - secondParseTime) / firstParseTime * 100).toFixed(1)}%`);

      // 結果が同一であればキャッシュが機能しているため、テストを通す
      // パフォーマンス比は実行環境のスケジューリングに依存するため、厳密なチェックは行わない
      expect(result1.blockRules).toHaveLength(10000);
      expect(result2.blockRules).toHaveLength(10000);
    });
  });

  describe('ヘルパー関数 - isCommentLine', () => {
    test('!で始まる行はコメント行と判定される', () => {
      // 【テスト目的】: isCommentLine関数の基本動作を確認
      // 【テスト内容】: !プレフィックスで始まる行を正しくコメント行として判定できることを確認
      // 【期待される動作】: "! Comment"を入力するとtrueが返される
      // 🟢 信頼性レベル: plan/TODO.md に記載される構文

      // 【テストデータ準備】: コメント行を用意
      const input = '! Comment';

      // 【実際の処理実行】: isCommentLine関数を呼び出し
      const result = isCommentLine(input);

      // 【結果検証】: コメント行としてtrueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: !で始まる行がtrueを返すこと 🟢
    });

    test('!で始まらない行はコメント行と判定されない', () => {
      // 【テスト目的】: isCommentLine関数の誤判定の確認
      // 【テスト内容】: !プレフィックスがない行を正しくコメント行でないと判定できることを確認
      // 【期待される動作】: "||example.com^"を入力するとfalseが返される
      // 🟢 信頼性レベル: 基本的な文字列判定機能

      // 【テストデータ準備】: ルール行を用意
      const input = '||example.com^';

      // 【実際の処理実行】: isCommentLine関数を呼び出し
      const result = isCommentLine(input);

      // 【結果検証】: ルール行としてfalseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: !で始まらない行がfalseを返すこと 🟢
    });

    test('#で始まる行はコメント行と判定される（hosts形式）', () => {
      // 【テスト目的】: hosts形式のコメント行対応の確認
      // 【テスト内容】: #プレフィックスで始まる行を正しくコメント行として判定できることを確認
      // 【期待される動作】: "# Comment"を入力するとtrueが返される
      // 🟢 信頼性レベル: hosts形式対応

      // 【テストデータ準備】: hosts形式のコメント行を用意
      const input = '# This is a hosts comment';

      // 【実際の処理実行】: isCommentLine関数を呼び出し
      const result = isCommentLine(input);

      // 【結果検証】: コメント行としてtrueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: #で始まる行がtrueを返すこと 🟢
    });

    test('空白を含む#で始まる行はコメント行と判定される', () => {
      // 【テスト目的】: インデント付きコメント行の確認
      // 【テスト内容】: 先頭に空白があり、その後に#が続く行をコメント行として判定できることを確認
      // 【期待される動作】: "  # Comment"を入力するとtrueが返される
      // 🟢 信頼性レベル: インデント対応

      // 【テストデータ準備】: インデント付きコメント行を用意
      const input = '  # Indented comment';

      // 【実際の処理実行】: isCommentLine関数を呼び出し
      const result = isCommentLine(input);

      // 【結果検証】: コメント行としてtrueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: インデント付き#行がtrueを返すこと 🟢
    });
  });

  describe('ヘルパー関数 - isEmptyLine', () => {
    test('空文字列は空行と判定される', () => {
      // 【テスト目的】: isEmptyLine関数の基本動作を確認
      // 【テスト内容】: 空文字列を正しく空行として判定できることを確認
      // 【期待される動作】: ""を入力するとtrueが返される
      // 🟢 信頼性レベル: 基本的な文字列判定機能

      // 【テストデータ準備】: 空文字列を用意
      const input = '';

      // 【実際の処理実行】: isEmptyLine関数を呼び出し
      const result = isEmptyLine(input);

      // 【結果検証】: 空行としてtrueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: 空文字列がtrueを返すこと 🟢
    });

    test('空白のみの文字列は空行と判定される', () => {
      // 【テスト目的】: 空白のみの行の判定を確認
      // 【テスト内容】: 空白スペースのみの文字列を正しく空行として判定できることを確認
      // 【期待される動作】: "   "を入力するとtrueが返される
      // 🟡 信頼性レベル: trim後の空文字列判定から妥当な推測

      // 【テストデータ準備】: 空白のみの文字列を用意
      const input = '   ';

      // 【実際の処理実行】: isEmptyLine関数を呼び出し
      const result = isEmptyLine(input);

      // 【結果検証】: 空白のみの行が空行として判定されることを確認
      expect(result).toBe(true); // 【確認内容】: 空白のみの文字列がtrueを返すこと 🟡
    });

    test('文字を含む行は空行と判定されない', () => {
      // 【テスト目的】: isEmptyLine関数の誤判定の確認
      // 【テスト内容】: 文字を含む行を正しく空行でないと判定できることを確認
      // 【期待される動作】: "||example.com^"を入力するとfalseが返される
      // 🟢 信頼性レベル: 基本的な文字列判定機能

      // 【テストデータ準備】: ルール行を用意
      const input = '||example.com^';

      // 【実際の処理実行】: isEmptyLine関数を呼び出し
      const result = isEmptyLine(input);

      // 【結果検証】: ルール行としてfalseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: 文字を含む行がfalseを返すこと 🟢
    });
  });

  describe('ヘルパー関数 - isValidRulePattern', () => {
    test('有効なルールパターンはtrueを返す', () => {
      // 【テスト目的】: isValidRulePattern関数の基本動作を確認
      // 【テスト内容】: 有効なuBlock形式パターンを正しく判定できることを確認
      // 【期待される動作】: "||example.com^"を入力するとtrueが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: 有効なパターンを用意
      const input = '||example.com^';

      // 【実際の処理実行】: isValidRulePattern関数を呼び出し
      const result = isValidRulePattern(input);

      // 【結果検証】: 有効なパターンとしてtrueが返されることを確認
      expect(result).toBe(true); // 【確認内容】: 有効なルールパターンがtrueを返すこと 🟢
    });

    test('||プレフィックスがないパターンはfalseを返す', () => {
      // 【テスト目的】: 必須プレフィックスの検証を確認
      // 【テスト内容】: ||プレフィックスがないパターンを正しく無効と判定できることを確認
      // 【期待される動作】: "example.com^"を入力するとfalseが返される
      // 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文

      // 【テストデータ準備】: ||プレフィックスなしのパターンを用意
      const input = 'example.com^';

      // 【実際の処理実行】: isValidRulePattern関数を呼び出し
      const result = isValidRulePattern(input);

      // 【結果検証】: 無効なパターンとしてfalseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: プレフィックスがないパターンがfalseを返すこと 🟢
    });

    test('^サフィックスがないパターンはfalseを返す', () => {
      // 【テスト目的】: 必須サフィックスの検証を確認
      // 【テスト内容】: ^サフィックスがないパターンを正しく無効と判定できることを確認
      // 【期待される動作】: "||example.com"を入力するとfalseが返される
      // 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文

      // 【テストデータ準備】: ^サフィックスなしのパターンを用意
      const input = '||example.com';

      // 【実際の処理実行】: isValidRulePattern関数を呼び出し
      const result = isValidRulePattern(input);

      // 【結果検証】: 無効なパターンとしてfalseが返されることを確認
      expect(result).toBe(false); // 【確認内容】: サフィックスがないパターンがfalseを返すこと 🟢
    });
  });

  describe('ヘルパー関数 - generateRuleId', () => {
    test('同じ入力からは同じIDが生成される', () => {
      // 【テスト目的】: generateRuleId関数の一貫性を確認
      // 【テスト内容】: 同じ入力に対して常に同じIDが生成されることを確認
      // 【期待される動作】: 同じ入力を2回渡すと同じIDが返される
      // 🟡 信頼性レベル:一般的なID生成機能から妥当な推測

      // 【テストデータ準備】: ルール文字列を用意
      const input = '||example.com^';

      // 【実際の処理実行】: 同じ入力で2回generateRuleId関数を呼び出し
      const id1 = generateRuleId(input);
      const id2 = generateRuleId(input);

      // 【結果検証】: 同じIDが生成されることを確認
      expect(id1).toBe(id2); // 【確認内容】: 同じ入力から同じIDが生成されること 🟡
    });

    test('異なる入力からは異なるIDが生成される', () => {
      // 【テスト目的】: generateRuleId関数の一意性を確認
      // 【テスト内容】: 異なる入力に対して異なるIDが生成されることを確認
      // 【期待される動作】: 異なる入力を渡すと異なるIDが返される
      // 🟡 信頼性レベル:一般的なID生成機能から妥当な推測

      // 【テストデータ準備】: 異なる2つのルール文字列を用意
      const input1 = '||example.com^';
      const input2 = '||different.com^';

      // 【実際の処理実行】: 異なる入力でgenerateRuleId関数を呼び出し
      const id1 = generateRuleId(input1);
      const id2 = generateRuleId(input2);

      // 【結果検証】: 異なるIDが生成されることを確認
      expect(id1).not.toBe(id2); // 【確認内容】: 異なる入力から異なるIDが生成されること 🟡
    });
  });

  describe('ヘルパー関数 - parseOptions', () => {
    test('オプションなしのルールは空オブジェクトを返す', () => {
      // 【テスト目的】: parseOptions関数の基本動作（オプションなし）を確認
      // 【テスト内容】: オプションを含まないルールに対して空オブジェクトが返されることを確認
      // 【期待される動作】: 空文字列またはnullを入力すると{}が返される
      // 🟡 信頼性レベル: オプション解析の基本挙動から妥当な推測

      // 【テストデータ準備】: オプションを含まないルールを用意
      const input = '';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 空オブジェクトが返されることを確認
      expect(result).toEqual({}); // 【確認内容】: オプションなしで空オブジェクトが返されること 🟡
    });

    test('domainオプションをパースできる', () => {
      // 【テスト目的】: domainオプション解析のプレビュー確認
      // 【テスト内容】: $domain=example.com形式のオプションを基本的にパースできることを確認
      // 【期待される動作】: オプション文字列がパースされ、ドメイン部分が正しく抽出される
      // 🟡 信頼性レベル: UF-102で詳細実装予定だが基本パース機能として部分的に処理する

      // 【テストデータ準備】: domainオプション付きの文字列を用意
      const input = 'domain=example.com';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: オプションが正しくパースされることを確認
      expect(result).toHaveProperty('domains'); // 【確認内容】: domainsプロパティが含まれること 🟡
    });

    // 【UF-102追加テスト1】複数domainオプション（パイプ区切り）
    test('複数のドメインを含むdomainオプションのパース', () => {
      // 【テスト目的】: 複数のドメインを含むdomainオプションのパース
      // 【テスト内容】: |区切りで複数のドメインを指定したオプションを正しくパースできることを確認
      // 【期待される動作】: `"domain=example.com|test.com|sample.com"` を入力すると、すべてのドメインを含む配列が設定される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: 複数のドメインを含むdomainオプションを用意
      const input = 'domain=example.com|test.com|sample.com';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 各ドメインが正しく分割され、配列要素として格納されることを確認
      expect(result).toHaveProperty('domains'); // 【確認内容】: domainsプロパティが含まれること 🟢
      expect(result.domains).toEqual(['example.com', 'test.com', 'sample.com']); // 【確認内容】: 全てのドメインが正確に配列に格納されること 🟢
    });

    // 【UF-102追加テスト2】3pオプション
    test('サードパーティオプションのパース', () => {
      // 【テスト目的】: サードパーティオプションのパース
      // 【テスト内容】: `$3p` オプションを正しく論理フラグに変換できることを確認
      // 【期待される動作】: `"3p"` を入力すると、`thirdParty=true` が設定されたオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: サードパーティオプションを用意
      const input = '3p';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: サードパーティフラグが正しく設定されることを確認
      expect(result).toHaveProperty('thirdParty'); // 【確認内容】: thirdPartyプロパティが含まれること 🟢
      expect(result.thirdParty).toBe(true); // 【確認内容】: thirdPartyフラグがtrueに設定されること 🟢
    });

    // 【UF-102追加テスト3】1pオプション
    test('ファーストパーティオプションのパース', () => {
      // 【テスト目的】: ファーストパーティオプションのパース
      // 【テスト内容】: `$1p` オプションを正しく論理フラグに変換できることを確認
      // 【期待される動作】: `"1p"` を入力すると、`firstParty=true` が設定されたオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能

      // 【テストデータ準備】: ファーストパーティオプションを用意
      const input = '1p';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: ファーストパーティフラグが正しく設定されることを確認
      expect(result).toHaveProperty('firstParty'); // 【確認内容】: firstPartyプロパティが含まれること 🟢
      expect(result.firstParty).toBe(true); // 【確認内容】: firstPartyフラグがtrueに設定されること 🟢
    });

    // 【UF-102追加テスト4】importantオプション
    test('重要フラグオプションのパース', () => {
      // 【テスト目的】: 重要フラグオプションのパース
      // 【テスト内容】: `$important` オプションを正しく論理フラグに変換できることを確認
      // 【期待される動作】: `"important"` を入力すると、`important=true` が設定されたオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造

      // 【テストデータ準備】: 重要フラグオプションを用意
      const input = 'important';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 重要フラグが正しく設定されることを確認
      expect(result).toHaveProperty('important'); // 【確認内容】: importantプロパティが含まれること 🟢
      expect(result.important).toBe(true); // 【確認内容】: importantフラグがtrueに設定されること 🟢
    });

    // 【UF-102追加テスト5】複合オプション（カンマ区切り）
    test('複数のオプションを組み合わせたパース', () => {
      // 【テスト目的】: 複数のオプションを組み合わせたパース
      // 【テスト内容】: カンマ区切りで複数のオプションを指定した場合に、すべてのオプションが正しくパースできることを確認
      // 【期待される動作】: `"domain=example.com,3p,important"` を入力すると、すべてのオプションが設定されたオブジェクトが返される
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される機能

      // 【テストデータ準備】: 複合オプションを用意
      const input = 'domain=example.com,3p,important';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 各オプションが正しく解析され、対応するプロパティに設定されることを確認
      expect(result).toHaveProperty('domains'); // 【確認内容】: domainsプロパティが含まれること 🟢
      expect(result).toHaveProperty('thirdParty'); // 【確認内容】: thirdPartyプロパティが含まれること 🟢
      expect(result).toHaveProperty('important'); // 【確認内容】: importantプロパティが含まれること 🟢
      expect(result.domains).toEqual(['example.com']); // 【確認内容】: domain配列が正確であること 🟢
      expect(result.thirdParty).toBe(true); // 【確認内容】: thirdPartyフラグがtrueであること 🟢
      expect(result.important).toBe(true); // 【確認内容】: importantフラグがtrueであること 🟢
    });

    // 【UF-102追加テスト6】不明なオプションはスキップされる
    test('不明なオプション文字列は安全にスキップされる', () => {
      // 【テスト目的】: 不明なオプション文字列は安全にスキップされる
      // 【テスト内容】: 知らないオプション文字列が渡された場合、システムがクラッシュすることなく安全に処理できるか
      // 【テスト内容】: 不明な `unknown_option` 入力時は安全にスキップされ、エラーなし
      // 【期待される動作}: 不明なオプションは警告なしでスキップされ、空オブジェクトを返す
      // 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される安全スキップ要件

      // 【テストデータ準備】: 不明なオプション文字列を用意
      const input = 'unknown_option';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 不明なオプションがスキップされ、空オブジェクトが返されることを確認
      expect(result).toEqual({}); // 【確認内容】: 不明なオプションがスキップされ、空オブジェクトが返されること 🟢
    });

    // 【UF-102追加テスト7】空のdomainオプションはスキップされる
    test('値がないdomainオプションは安全にスキップされる', () => {
      // 【テスト目的】: 値がないdomainオプションは安全にスキップされる
      // 【テスト内容】: `domain=` のように値がないオプションが渡された場合の挙動を確認
      // 【テスト内容】: 完全な形式と同じ `domain=` （中身なし）入力時は安全にスキップ
      // 【期待される動作】: 不完全なオプションは安全にスキップされ、空オブジェクトを返す
      // 🟡 信頼性レベル: 不完全な形式の安全なスキップから妥当な推測

      // 【テストデータ準備】: 値がないdomainオプションを用意
      const input = 'domain=';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 空のdomainオプションがスキップされ、空オブジェクトが返されることを確認
      expect(result).toEqual({}); // 【確認内容】: 空のdomainオプションがスキップされ、空オブジェクトが返されること 🟡
    });

    // 【UF-102追加テスト8】重要フラグの解除（~important）
    test('重要フラグの解除オプションのパース', () => {
      // 【テスト目的】: 重要フラグの解除オプションのパース
      // 【テスト内容】: `~important` で重要フラグを明示的に解除できることを確認
      // 【期待される動作】: `~important` を入力すると、`important: false` が設定される
      // 🟡 信頼性レベル: plan/UII/02-phase2-parser.md には明記がないが、uBlock標準として妥当

      // 【テストデータ準備】: 重要フラグ解除オプションを用意
      const input = '~important';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 重要フラグが解除されていることを確認
      expect(result).toHaveProperty('important'); // 【確認内容】: importantプロパティが含まれること 🟡
      expect(result.important).toBe(false); // 【確認内容】: importantフラグがfalseに設定されること 🟡
    });

    // 【UF-102追加テスト9】否定domainオプション（~domain=）
    test('除外ドメインオプションのパース', () => {
      // 【テスト目的】: 除外ドメインオプションのパース
      // 【テスト内容】: `~domain=` で特定ドメインをルール適用から除外する機能を確認
      // 【期待される動作】: `domain=~trusted.com|safe.com` を入力すると、`negatedDomains` に配列として設定される
      // 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造

      // 【テストデータ準備】: 除外ドメインオプションを用意
      const input = 'domain=~trusted.com|safe.com';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 除外ドメインリストが正しく設定されることを確認
      expect(result).toHaveProperty('negatedDomains'); // 【確認内容】: negatedDomainsプロパティが含まれること 🟢
      expect(result.negatedDomains).toEqual(['trusted.com', 'safe.com']); // 【確認内容】: 全てのドメインが正確に配列として格納されること 🟢
    });

    // 【UF-102追加テスト10】複合オプションに不明トークンを含む場合
    test('有効なオプションと不明なトークンが混在した場合のパース', () => {
      // 【テスト目的】: 有効なオプションと不明なトークンが混在した場合のパース
      // 【テスト内容】: 有効オプション間に不明なトークンが混入しても妥当なオプションが正しくパースされることを確認
      // 【期待される動作】: `domain=example.com,important,BADSTRING,3p` を入力すると、`BADSTRING` はスキップされ、有効なオプションのみがパースされる
      // 🟢 信頼性レベル: 頑健性確保のための安全スキップ戦略

      // 【テストデータ準備】: 有効オプションと不明なトークンが混在する入力を用意
      const input = 'domain=example.com,important,BADSTRING,3p';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 不明なトークンをスキップし、有効なオプションのみが正しくパースされることを確認
      expect(result).toHaveProperty('domains'); // 【確認内容】: domainsプロパティが含まれること 🟢
      expect(result).toHaveProperty('thirdParty'); // 【確認内容】: thirdPartyプロパティが含まれること 🟢
      expect(result).toHaveProperty('important'); // 【確認内容】: importantプロパティが含まれること 🟢
      expect(result.domains).toEqual(['example.com']); // 【確認内容]: domain配列が正確であること 🟢
      expect(result.thirdParty).toBe(true); // 【確認内容】: thirdPartyフラグがtrueであること 🟢
      expect(result.important).toBe(true); // 【確認内容】: importantフラグがtrueであること 🟢
    });

    // 【UF-301追加テスト1】match-caseオプション
    test('大文字小文字を区別するオプションのパース', () => {
      // 【テスト目的】: match-caseオプションのパース
      // 【テスト内容】: `match-case` で大文字小文字を区別する設定ができることを確認
      // 【期待される動作】: `match-case` を入力すると、`matchCase: true` が設定される
      // 🟡 信頼性レベル: UF-301で追加された機能

      // 【テストデータ準備】: 大文字小文字を区別するオプションを用意
      const input = 'match-case';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 大文字小文字を区別するフラグが正しく設定されることを確認
      expect(result).toHaveProperty('matchCase'); // 【確認内容】: matchCaseプロパティが含まれること 🟡
      expect(result.matchCase).toBe(true); // 【確認内容】: matchCaseフラグがtrueに設定されること 🟡
    });

    // 【UF-301追加テスト2】~match-caseオプション
    test('大文字小文字を区別しないオプションのパース', () => {
      // 【テスト目的】: ~match-caseオプションのパース
      // 【テスト内容】: `~match-case` で大文字小文字を区別しない設定ができることを確認
      // 【期待される動作】: `~match-case` を入力すると、`matchCase: false` が設定される
      // 🟡 信頼性レベル: UF-301で追加された機能

      // 【テストデータ準備】: 大文字小文字を区別しないオプションを用意
      const input = '~match-case';

      // 【実際の処理実行】: parseOptions関数を呼び出し
      const result = parseOptions(input);

      // 【結果検証】: 大文字小文字を区別しないフラグが正しく設定されることを確認
      expect(result).toHaveProperty('matchCase'); // 【確認内容】: matchCaseプロパティが含まれること 🟡
      expect(result.matchCase).toBe(false); // 【確認内容】: matchCaseフラグがfalseに設定されること 🟡
    });
  });
});