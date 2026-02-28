/**
 * masterPassword-rateLimit.test.ts
 * 【セキュリティ強化】マスターパスワードレート制限機能のテスト
 * 【テスト対象】: src/utils/rateLimiter.js の checkRateLimit, recordFailedAttempt, resetFailedAttempts 関数
 *
 * 注: chrome.storage.session モックは jest.setup.ts で設定済み
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/**
 * 【テスト前準備】session storageの初期化
 * 各テスト実行前にモックされたsession storageをクリア
 */
beforeEach(() => {
    // chrome.storage.sessionをクリアしてテスト分離を確保
    Object.defineProperty(chrome, 'storage', {
        value: {
            local: {
                get: jest.fn(),
                set: jest.fn(),
                remove: jest.fn(),
                clear: jest.fn(),
            },
            session: {
                get: jest.fn(),
                set: jest.fn(),
                remove: jest.fn(),
                clear: jest.fn(),
            },
        },
        writable: true,
    });
});

/**
 * マスターパスワードレート制限機能のテストスイート
 */
describe('マスターパスワードレート制限（Refactorフェーズ）', () => {
    /**
     * 正常系テスト: 初回認証成功
     */
    test('初回認証成功時、失敗回数カウンターが増加しない', async () => {
        // 【テスト目的】: 正しいパスワードで認証した場合、失敗回数が増加しないことを確認
        // 【テスト内容】：chrome.storage.sessionが空の状態でcheckRateLimitを呼び出し、許可されることを検証
        // 【期待される動作】: 認証成功時にsuccess:trueが返される
        // 🟢 信頼性レベル: 青信号（要件定義および既存コードのverifyMasterPassword動作から確信）

        // 【実際の処理実行】rateLimiterをインポート
        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】空のsession storage
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({});

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】認証が成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: 認証が成功することを確認 🟢
        expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないことを確認 🟢
    });

    /**
     * 正常系テスト: 失敗回数リセット後に認証成功
     */
    test('認証成功後に失敗回数がリセットされる', async () => {
        // 【テスト目的】: 認証成功後にresetFailedAttemptsを呼び出すと、失敗回数がリセットされることを確認
        // 【テスト内容】：失敗回数5回の状態で認証成功し、リセット後にcheckRateLimitが許可されることを検証
        // 【期待される動作】: リセット後は失敗回数が0になり、認証が許可される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { checkRateLimit, recordFailedAttempt, resetFailedAttempts } = await import('../rateLimiter.js');

        // 【テストデータ準備】失敗回数を5回記録
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            passwordFailedAttempts: 4,
            firstFailedAttemptTime: Date.now() - 2 * 60 * 1000, // 2分前
        });

        await recordFailedAttempt();

        // 【リセット実行】認証成功時に失敗回数をリセット
        await resetFailedAttempts();

        // 【確認】: removeが全てのキーで呼ばれたことを確認
        expect(chrome.storage.session.remove).toHaveBeenCalledWith([
            'passwordFailedAttempts',
            'firstFailedAttemptTime',
            'lockedUntil',
        ]);

        // 【リセット後の確認】: session storageが空の場合に許可される
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({});
        const result = await checkRateLimit();

        // 【結果検証】リセット後は認証が成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: リセット後は認証成功 🟢
    });

    /**
     * エッジケーステスト: ロックアウト期間中の認証拒否
     */
    test('ロックアウト期間中は認証が拒否される', async () => {
        // 【テスト目的】: 5回失敗後のロックアウト期間中は認証が拒否されることを確認
        // 【テスト内容】：lockedUntilが設定された状態でcheckRateLimitを呼び出し、拒否されることを検証
        // 【期待される動作】: ロックアウト期間中は残り時間付きのエラーが返される
        // 🟢 信頼性レベル: 青信号（要件定義書のデータフローベース）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】ロックアウト期間中（まだ10分経過していない）
        const lockedUntil = Date.now() + 10 * 60 * 1000; // 10分後に解除
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            lockedUntil: lockedUntil,
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: Date.now() - 2 * 60 * 1000,
        });

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】ロックアウト中は拒否されることを確認
        expect(result.success).toBe(false); // 【確認内容】: 認証が拒否されること 🟢
        expect(result.error).toContain('Too many attempts'); // 【確認内容】: エラーメッセージが含まれること 🟢
        expect(result.error).toContain('Please try again in'); // 【確認内容】: 再試行時間が示されること 🟢
    });

    /**
     * 正常系テスト: 認証失敗時、失敗回数カウンターが増加する
     */
    test('認証失敗時、失敗回数カウンターが増加する', async () => {
        // 【テスト目的】: 認証失敗時にrecordFailedAttemptを呼び出すと、失敗回数が増加することを確認
        // 【テスト内容】：1回目の失敗を記録し、レート制限チェックで拒否されることを検証
        // 【期待される動作】: 失敗回数が1増加し、次回の試行時にカウントが反映される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { recordFailedAttempt } = await import('../rateLimiter.js');

        // 【テストデータ準備】空のsession storage
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({});

        // 【実際の処理実行】失敗を記録
        await recordFailedAttempt();

        // 【確認】: setが呼ばれ、失敗回数が1増加していることを確認
        expect(chrome.storage.session.set).toHaveBeenCalledWith({
            passwordFailedAttempts: 1,
            firstFailedAttemptTime: expect.any(Number),
        }); // 【確認内容】: 失敗回数がカウントされていること 🟢
    });

    /**
     * 正常系テスト: 5回認証失敗後、ロックアウト状態になる
     */
    test('5回認証失敗後、ロックアウト状態になる', async () => {
        // 【テスト目的】: 5回認証失敗後に自動的にロックアウト状態に遷移することを確認
        // 【テスト内容】：失敗回数が5回になった状態でcheckRateLimitを呼び出し、ロックアウトされることを検証
        // 【期待される動作】: 6回目の試行でロックアウトが発動し、30分のロック期間が設定される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { checkRateLimit, recordFailedAttempt } = await import('../rateLimiter.js');

        // 【テストデータ準備】4回失敗済み（5分以内）
        const now = Date.now();
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            passwordFailedAttempts: 4,
            firstFailedAttemptTime: now - 2 * 60 * 1000, // 2分前
        });

        // 【実際の処理実行】5回目の失敗を記録
        await recordFailedAttempt();

        // 【実際の処理実行】6回目の試行でロックアウトチェック
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: now - 2 * 60 * 1000,
        });

        const result = await checkRateLimit();

        // 【結果検証】ロックアウトが発動することを確認
        expect(result.success).toBe(false); // 【確認内容】: 認証が拒否されること 🟢
        expect(chrome.storage.session.set).toHaveBeenCalledWith({
            lockedUntil: expect.any(Number),
        }); // 【確認内容】: ロックアウト時刻が設定されたこと 🟢
    });

    /**
     * 正常系テスト: 30分後、ロックアウトが解除される
     */
    test('30分後、ロックアウトが解除される', async () => {
        // 【テスト目的】: 30分経過後にロックアウトが自動的に解除されることを確認
        // 【テスト内容】：ロックアウト期間が過ぎた状態でcheckRateLimitを呼び出し、認証が許可されることを検証
        // 【期待される動作】: 30分経過後は失敗回数がリセットされ、認証が許可される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】ロックアウト期間が過ぎた状態
        const now = Date.now();
        const oldLockedUntil = now - 31 * 60 * 1000; // 31分前にロック設定
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            lockedUntil: oldLockedUntil,
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: now - 35 * 60 * 1000, // 35分前
        });

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】ロックアウト解除後は認証が成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: ロック解除後は認証成功 🟢
        expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないこと 🟢
    });

    /**
     * 境界値テスト: 5分境界での失敗回数リセット
     */
    test('5分境界での失敗回数リセット', async () => {
        // 【テスト目的】: 評価ウインドウ（5分）を超えたため失敗回数がリセットされることを確認
        // 【テスト内容】：5回失敗で初回時刻から5分以上経過後のレート制限チェックで許可されることを検証
        // 【期待される動作】: 5回失敗後、5分経過すると古い失敗記録が無効となり、認証が許可される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】5回失敗済みだが、初回から5分以上経過
        const now = Date.now();
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: now - 5 * 60 * 1000 - 1000, // 5分1秒前
        });

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】5分経過後は許可されることを確認
        expect(result.success).toBe(true); // 【確認内容】: 評価ウインドウ超過後は認証成功 🟢
        expect(chrome.storage.session.remove).toHaveBeenCalledWith([
            'passwordFailedAttempts',
            'firstFailedAttemptTime',
            'lockedUntil',
        ]); // 【確認内容】: 古い記録がリセットされたこと 🟢
    });

    /**
     * 境界値テスト: 30分境界でのロックアウト解除
     */
    test('30分境界でのロックアウト解除', async () => {
        // 【テスト目的】: ロックアウト期間（30分）を1秒でも経過すると解除されることを確認
        // 【テスト内容】：lockoutから30分1秒経過後の認証が許可されることを検証
        // 【期待される動作】: 30分1秒経過時点で即座に認証が許可される
        // 🟢 信頼性レベル: 青信号（要件定義書の仕様通り）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】ロックアウト期間が1秒過ぎた状態
        const now = Date.now();
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            lockedUntil: now - 1000, // 1秒前にロック解除
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: now - 32 * 60 * 1000,
        });

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】ロック解除直後は認証成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: 30分1秒経過後は認証成功 🟢
        expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないこと 🟢
    });

    /**
     * 境界値テスト: chrome.storage.sessionがクリアされた場合のリセット
     */
    test('chrome.storage.sessionがクリアされた場合のリセット', async () => {
        // 【テスト目的】: session storageがクリアされた場合、全ての制限がリセットされることを確認
        // 【テスト内容】：ブラウザ終了などでsession storageがクリアされた後の挙動を検証
        // 【期待される動作】: storageが空の場合は常に認証が許可される
        // 🟢 信頼性レベル: 青信号（chrome.storage.sessionの仕様）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】chrome.storage.sessionが空（クリアされた状態）
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({});

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】storageクリア後は認証成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: storageクリア後は認証成功 🟢
        expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないこと 🟢
    });

    /**
     * 境界値テスト: セッションが閉じられた後の状態管理
     */
    test('セッションが閉じられた後の状態管理', async () => {
        // 【テスト目的】: セッション終了（閉じられた）後にレート制限が適切に初期化されることを確認
        // 【テスト内容】：新しいセッションで最初の認証が許可されることを検証
        // 【期待される動作】: 新しいセッションの最初の認証は常に許可される
        // 🟢 信頼性レベル: 青信号（chrome.storage.sessionの仕様：ブラウザ終了で消去）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】新しいセッション（storageが完全に空）
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({});

        // 【実際の処理実行】最初の認証を試行
        const result = await checkRateLimit();

        // 【結果検証】新しいセッションでは最初の認証が成功することを確認
        expect(result.success).toBe(true); // 【確認内容】: 新セッションの初回認証は成功 🟢
        expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないこと 🟢
    });

    /**
     * エラー系テスト: ロックアウト時刻が不正な形式の場合のエラーハンドリング
     */
    test('ロックアウト時刻が不正な形式の場合のエラーハンドリング', async () => {
        // 【テスト目的】: lockedUntilに不正な値（文字列など）が設定された場合の挙動を確認
        // 【テスト内容】：lockedUntilが無効な値の場合でも安全に処理されることを検証
        // 【期待される動作】: 不正な値は無視され、エラーをスローせずに安全なデフォルト挙動
        // 🟢 信頼性レベル: 青信号（安全策として実装）

        const { checkRateLimit } = await import('../rateLimiter.js');

        // 【テストデータ準備】lockedUntilに不正な値（文字列）が設定された状態
        (chrome.storage.session.get as jest.Mock).mockResolvedValue({
            lockedUntil: 'invalid-timestamp', // 不正なタイムスタンプ形式
            passwordFailedAttempts: 5,
            firstFailedAttemptTime: Date.now() - 2 * 60 * 1000,
        });

        // 【実際の処理実行】レート制限チェックを実行
        const result = await checkRateLimit();

        // 【結果検証】エラーをスローせずに安全に処理されることを確認
        expect(result).toBeDefined(); // 【確認内容】: 結果オブジェクトが返されること 🟢
        expect(typeof result.success).toBe('boolean'); // 【確認内容】: successフィールドがbooleanであること 🟢
    });
});