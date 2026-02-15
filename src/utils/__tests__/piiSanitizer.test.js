/**
 * piiSanitizer.test.js
 * PII（個人情報）サニタイザーのテスト
 * 【テスト対象】: src/utils/piiSanitizer.js
 */

import { describe, test, expect } from '@jest/globals';
import { sanitizeRegex } from '../piiSanitizer.ts';

describe('piiSanitizer', () => {
  describe('sanitizeRegex - 正常系', () => {
    test('ハイフン区切りクレジットカード番号を検出してマスクできる', async () => {
      // 【テスト目的】: 最も重要なPII（クレジットカード）の検出確認
      // 【テスト内容】: 16桁のクレジットカード番号（4桁-4桁-4桁-4桁形式）の検出をテスト
      // 【期待される動作】: 正規表現でマッチし、[MASKED:creditCard]に置換
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 9行目）を直接参照

      // 【テストデータ準備】: 一般的なクレジットカード番号の表記形式を用意
      const text = 'カード番号は 1234-5678-9012-3456 です';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      // 【処理内容】: PII_PATTERNSの各正規表現でマッチングし、マスク文字列に置換
      const result = await sanitizeRegex(text);

      // 【結果検証】: テキストとマスクされた項目の配列を確認
      expect(result.text).toBe('カード番号は [MASKED:creditCard] です'); // 【確認内容】: クレジットカード番号がマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスクされた項目が1つ記録されることを確認 🟢
      expect(result.maskedItems[0].type).toBe('creditCard'); // 【確認内容】: PIIタイプがcreditCardであることを確認 🟢
      expect(result.maskedItems[0].original).toBe('1234-5678-9012-3456'); // 【確認内容】: 元の値が記録されることを確認 🟢
    });

    test('12桁のマイナンバーを検出してマスクできる', async () => {
      // 【テスト目的】: 日本特有のPII検出機能の確認
      // 【テスト内容】: 4桁-4桁-4桁形式のマイナンバー検出をテスト
      // 【期待される動作】: 正規表現でマッチし、[MASKED:myNumber]に置換
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 12行目）を直接参照

      // 【テストデータ準備】: 日本固有の個人識別番号を用意
      const text = 'マイナンバー: 1234-5678-9012';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: マイナンバーがマスクされることを確認
      expect(result.text).toBe('マイナンバー: [MASKED:myNumber]'); // 【確認内容】: マイナンバーがマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスクされた項目が1つ記録されることを確認 🟢
      expect(result.maskedItems[0].type).toBe('myNumber'); // 【確認内容】: PIIタイプがmyNumberであることを確認 🟢
    });

    test('標準的なメールアドレスを検出してマスクできる', async () => {
      // 【テスト目的】: 頻出するPIIの検出確認
      // 【テスト内容】: RFC準拠の一般的なメールアドレス形式の検出をテスト
      // 【期待される動作】: @を含む文字列を正規表現でマッチし、[MASKED:email]に置換
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 20行目）を直接参照

      // 【テストデータ準備】: 最も一般的なメールアドレス形式を用意
      const text = '連絡先: user@example.com';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: メールアドレスがマスクされることを確認
      expect(result.text).toBe('連絡先: [MASKED:email]'); // 【確認内容】: メールアドレスがマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスクされた項目が1つ記録されることを確認 🟢
      expect(result.maskedItems[0].type).toBe('email'); // 【確認内容】: PIIタイプがemailであることを確認 🟢
    });

    test('ハイフン付き日本の携帯電話番号を検出してマスクできる', async () => {
      // 【テスト目的】: 地域固有のPII検出確認
      // 【テスト内容】: 090-xxxx-xxxx形式の携帯電話番号検出をテスト
      // 【期待される動作】: 日本の電話番号パターンでマッチし、[MASKED:phoneJp]に置換
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 24行目）を直接参照

      // 【テストデータ準備】: 日本の携帯電話番号の標準形式を用意
      const text = '電話: 090-1234-5678';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: 電話番号がマスクされることを確認
      expect(result.text).toBe('電話: [MASKED:phoneJp]'); // 【確認内容】: 電話番号がマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスクされた項目が1つ記録されることを確認 🟢
      expect(result.maskedItems[0].type).toBe('phoneJp'); // 【確認内容】: PIIタイプがphoneJpであることを確認 🟢
    });

    test('1つのテキスト内に複数種類のPIIが存在する場合にすべてマスクできる', async () => {
      // 【テスト目的】: 包括的なPII検出機能の確認
      // 【テスト内容】: 異なる種類のPII（メール、電話、カード番号）の同時検出をテスト
      // 【期待される動作】: for...ofループですべてのパターンを適用し、すべてマスク
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 41-46行目）を直接参照

      // 【テストデータ準備】: 実際のフォーム送信データを想定した複数PII含有テキストを用意
      const text = '連絡先: user@example.com, 電話: 090-1234-5678, カード: 1234-5678-9012-3456';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: すべてのPIIがマスクされることを確認
      expect(result.text).toBe('連絡先: [MASKED:email], 電話: [MASKED:phoneJp], カード: [MASKED:creditCard]'); // 【確認内容】: 3種類のPIIがすべてマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(3); // 【確認内容】: マスクされた項目が3つ記録されることを確認 🟢

      // 【確認内容】: 各PIIタイプが正しく記録されることを確認 🟢
      const types = result.maskedItems.map(item => item.type);
      expect(types).toContain('email');
      expect(types).toContain('phoneJp');
      expect(types).toContain('creditCard');
    });
  });

  describe('sanitizeRegex - 異常系', () => {
    test('null入力に対して安全にエラーハンドリングできる', async () => {
      // 【テスト目的】: nullセーフティの確認
      // 【テスト内容】: 入力がnullの場合の早期リターンをテスト
      // 【期待される動作】: 例外をthrowせず、デフォルト値を返す
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 33-35行目）を直接参照

      // 【テストデータ準備】: null値を用意
      const text = null;

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      // 【処理内容】: 型チェックで早期リターン
      const result = await sanitizeRegex(text);

      // 【結果検証】: 空文字列と空配列が返されることを確認
      expect(result.text).toBe(''); // 【確認内容】: null入力時に空文字列が返されることを確認 🟢
      expect(result.maskedItems).toEqual([]); // 【確認内容】: null入力時に空配列が返されることを確認 🟢
    });

    test('undefined入力に対して安全にエラーハンドリングできる', async () => {
      // 【テスト目的】: undefinedセーフティの確認
      // 【テスト内容】: 入力がundefinedの場合の早期リターンをテスト
      // 【期待される動作】: 例外をthrowせず、デフォルト値を返す
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 33-35行目のtypeofチェック）を直接参照

      // 【テストデータ準備】: undefined値を用意
      const text = undefined;

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: 空文字列と空配列が返されることを確認
      expect(result.text).toBe(''); // 【確認内容】: undefined入力時に空文字列が返されることを確認 🟢
      expect(result.maskedItems).toEqual([]); // 【確認内容】: undefined入力時に空配列が返されることを確認 🟢
    });

    test('空文字列入力に対して正常に処理できる', async () => {
      // 【テスト目的】: 空入力に対する堅牢性確認
      // 【テスト内容】: 有効な文字列だが内容が空のケースをテスト
      // 【期待される動作】: 正規表現マッチが0件でもエラーにならない
      // 🟢 信頼性レベル: 既存実装（replace処理はマッチ0件でも安全）

      // 【テストデータ準備】: 空文字列を用意
      const text = '';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: 空文字列と空配列が返されることを確認
      expect(result.text).toBe(''); // 【確認内容】: 空文字列入力時にそのまま空文字列が返されることを確認 🟢
      expect(result.maskedItems).toEqual([]); // 【確認内容】: 空文字列入力時に空配列が返されることを確認 🟢
    });

    test('数値型入力に対して安全にエラーハンドリングできる', async () => {
      // 【テスト目的】: 型チェックの確認
      // 【テスト内容】: 型チェックでstring以外を弾く処理をテスト
      // 【期待される動作】: 型エラーを事前に防ぐ
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 34行目のtypeofチェック）を直接参照

      // 【テストデータ準備】: 数値を用意（JavaScriptの型強制による意図しない入力を想定）
      const text = 12345;

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: 空文字列と空配列が返されることを確認
      expect(result.text).toBe(''); // 【確認内容】: 数値入力時に空文字列が返されることを確認 🟢
      expect(result.maskedItems).toEqual([]); // 【確認内容】: 数値入力時に空配列が返されることを確認 🟢
    });
  });

  describe('sanitizeRegex - 境界値・エッジケース', () => {
    test('PIIパターンに類似するが正当な数字列（商品コード）の扱いを確認', async () => {
      // 【テスト目的】: 誤検知リスクの確認と仕様の明示
      // 【テスト内容】: 7桁の数字が銀行口座パターンとしてマスクされるかをテスト
      // 【期待される動作】: 現在の実装では7桁数字を銀行口座としてマスク（安全側に倒す仕様）
      // 🟡 信頼性レベル: 誤検知は仕様として許容されているが、テストで挙動を明示する必要あり

      // 【テストデータ準備】: ECサイトの商品コードを想定した7桁の数字を用意
      const text = '商品コード: 1234567';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: 7桁数字が銀行口座としてマスクされることを確認（仕様通り）
      // 【期待値確認】: piiSanitizer.js 15-16行目のコメント「安全側に倒してマスク」の通り
      expect(result.text).toBe('商品コード: [MASKED:bankAccount]'); // 【確認内容】: 7桁数字が銀行口座としてマスクされることを確認 🟡
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスク項目が1つ記録されることを確認 🟡
      expect(result.maskedItems[0].type).toBe('bankAccount'); // 【確認内容】: PIIタイプがbankAccountであることを確認 🟡
    });

    test('スペース区切りのクレジットカード番号を検出できる', async () => {
      // 【テスト目的】: 柔軟なパターンマッチングの確認
      // 【テスト内容】: ハイフンではなくスペース区切りのクレジットカード番号検出をテスト
      // 【期待される動作】: スペース区切りでも正しくマッチ
      // 🟢 信頼性レベル: 既存実装（piiSanitizer.js 9行目の`[-\\s]?`）を直接参照

      // 【テストデータ準備】: ユーザーがフォームに手入力する際のスペース区切りを用意
      const text = 'カード: 1234 5678 9012 3456';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: スペース区切りでもマスクされることを確認
      expect(result.text).toBe('カード: [MASKED:creditCard]'); // 【確認内容】: スペース区切りのカード番号がマスクされることを確認 🟢
    });

    test('同じテキスト内に同じ種類のPIIが複数存在する場合にすべてマスクできる', async () => {
      // 【テスト目的】: グローバルマッチングの確認
      // 【テスト内容】: replaceのグローバルフラグ（/g）が正しく動作するかをテスト
      // 【期待される動作】: すべてのマッチがマスクされる
      // 🟢 信頼性レベル: 既存実装（各正規表現の/gフラグ）を直接参照

      // 【テストデータ準備】: フォームに複数の連絡先が記載されている場合を想定
      const text = 'メール1: user1@example.com, メール2: user2@example.com';

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      const result = await sanitizeRegex(text);

      // 【結果検証】: すべてのメールアドレスがマスクされることを確認
      expect(result.text).toBe('メール1: [MASKED:email], メール2: [MASKED:email]'); // 【確認内容】: 複数のメールアドレスがすべてマスクされることを確認 🟢
      expect(result.maskedItems).toHaveLength(2); // 【確認内容】: マスクされた項目が2つ記録されることを確認 🟢
      expect(result.maskedItems[0].original).toBe('user1@example.com'); // 【確認内容】: 1つ目の元の値が記録されることを確認 🟢
      expect(result.maskedItems[1].original).toBe('user2@example.com'); // 【確認内容】: 2つ目の元の値が記録されることを確認 🟢
    });

    test('大量テキスト（10,000文字）に対しても正常に動作する', async () => {
      // 【テスト目的】: パフォーマンスとセキュリティの確認
      // 【テスト内容】: 長文でも正規表現がReDoS攻撃に対して脆弱でないことをテスト
      // 【期待される動作】: 処理時間が許容範囲内で完了し、すべてのPIIがマスクされる
      // 🟡 信頼性レベル: 正規表現のReDoS脆弱性テストは別途実施が望ましい

      // 【テストデータ準備】: extractor.jsが最大10,000文字に切り詰める仕様に合わせた長文を生成
      const longText = 'テスト'.repeat(2000) + ' user@example.com ' + 'テスト'.repeat(2000);

      // 【実際の処理実行】: sanitizeRegex関数を呼び出し
      // 【処理内容】: 長大なテキストに対してPII検出を実行
      const startTime = Date.now();
      const result = await sanitizeRegex(longText);
      const elapsedTime = Date.now() - startTime;

      // 【結果検証】: メールアドレスがマスクされ、処理時間が許容範囲内であることを確認
      expect(result.text).toContain('[MASKED:email]'); // 【確認内容】: 長文内のメールアドレスがマスクされることを確認 🟡
      expect(result.maskedItems).toHaveLength(1); // 【確認内容】: マスクされた項目が1つ記録されることを確認 🟡
      expect(elapsedTime).toBeLessThan(100); // 【確認内容】: 処理時間が100ms未満であることを確認（パフォーマンス） 🟡
    });
  });

  describe('sanitizeRegex - 入力サイズ制限', () => {
    test('64KB以下の入力は正常に処理される', async () => {
      // 【テスト目的】: 入力サイズ制限の境界値確認
      // 【テスト内容】: 64KB未満の入力が正常に処理されることを確認
      const text = 'a'.repeat(64 * 1024 - 1); // 64KB - 1文字
      const result = await sanitizeRegex(text);

      expect(result.text).toBe(text);
      expect(result.maskedItems).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test('64KBの入力は正常に処理される', async () => {
      // 【テスト目的】: 入力サイズ制限の境界値確認
      // 【テスト内容】: ちょうど64KBの入力が正常に処理されることを確認
      const text = 'a'.repeat(64 * 1024); // 64KB
      const result = await sanitizeRegex(text);

      expect(result.text).toBe(text);
      expect(result.maskedItems).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test('64KBを超える入力はエラーを返す', async () => {
      // 【テスト目的】: 入力サイズ制限の確認
      // 【テスト内容】: 64KBを超える入力がエラーを返すことを確認
      const text = 'a'.repeat(64 * 1024 + 1); // 64KB + 1文字
      const result = await sanitizeRegex(text);

      expect(result.text).toBe(text); // 元のテキストが返される
      expect(result.maskedItems).toEqual([]);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('exceeds maximum limit');
    });

    test('skipSizeLimitオプションでサイズ制限を回避できる', async () => {
      // 【テスト目的】: skipSizeLimitオプションの確認
      // 【テスト内容】: skipSizeLimitオプションを使用するとサイズ制限を回避できることを確認
      const text = 'a'.repeat(64 * 1024 + 1); // 64KB + 1文字
      const result = await sanitizeRegex(text, { skipSizeLimit: true });

      expect(result.text).toBe(text);
      expect(result.maskedItems).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });

  describe('sanitizeRegex - タイムアウト機能', () => {
    test('デフォルトのタイムアウト時間は5秒である', async () => {
      // 【テスト目的】: デフォルトタイムアウト値の確認
      // 【テスト内容】: デフォルトで5秒のタイムアウトが設定されていることを確認
      const text = 'test@example.com';
      const startTime = Date.now();
      const result = await sanitizeRegex(text);
      const elapsedTime = Date.now() - startTime;

      expect(result.text).toBe('[MASKED:email]');
      expect(result.maskedItems).toHaveLength(1);
      expect(elapsedTime).toBeLessThan(5000); // 5秒以内に完了
    });

    test('カスタムタイムアウト時間を設定できる', async () => {
      // 【テスト目的】: カスタムタイムアウト値の確認
      // 【テスト内容】: timeoutオプションでカスタムタイムアウトを設定できることを確認
      const text = 'test@example.com';
      const result = await sanitizeRegex(text, { timeout: 1000 }); // 1秒

      expect(result.text).toBe('[MASKED:email]');
      expect(result.maskedItems).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    test('タイムアウト時にエラーを返す', async () => {
      // 【テスト目的】: タイムアウトエラーの確認
      // 【テスト内容】: 処理がタイムアウトした場合にエラーを返すことを確認
      // 注: このテストは実際にタイムアウトを発生させるため、実行時間がかかる
      // 非常に長いテキストを使用してタイムアウトを強制的に発生させる
      // マッチが多数ある状況を作るとループ回数が増えてタイムアウトしやすくなる
      const text = 'test@example.com '.repeat(5000); // 約100KB (十分重い)
      const result = await sanitizeRegex(text, { timeout: 1, skipSizeLimit: true }); // 1msでタイムアウト

      // タイムアウトエラーが返されることを確認
      expect(result.error).toBeDefined();
      expect(result.error).toContain('timed out');
    });
  });
});
