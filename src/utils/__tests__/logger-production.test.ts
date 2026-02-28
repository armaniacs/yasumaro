/**
 * logger-production.test.ts
 * 【セキュリティ強化】デバッグログ本番無効化機能のテスト
 * 【テスト対象】: src/utils/logger.ts の環境依存ログ出力制御
 *
 * 注: chrome storage モックは jest.setup.ts で設定済み
 */

import { describe, test, expect, jest } from '@jest/globals';

/**
 * デバッグログ本番無効化機能のテストスイート
 *
 * 注: 実装前は logger.ts に環境判定ロジックが存在しないためテストが失敗します
 */
describe('Logger 本番環境: デバッグログ無効化（Redフェーズ）', () => {
    /**
     * 環境判定テスト: 本番環境判定
     *
     * Redフェーズ目的: 環境判定関数が存在しないため失敗することを確認
     */
    test('本番環境判定ロジックが存在する', () => {
        // 【テスト目的】: 環境判定用の関数が存在することを確認
        // 【テスト内容】：logger.tsに環境判定用のシンボルがエクスポートされていることを確認
        // 【期待される動作】: isDevelopment または同等の関数が存在する
        // 🟡 信頼性レベル: 黄信号（環境判定方法が確定していない）

        // 【実際の処理実行】logger.tsをインポートして環境判定を確認
        // TODO: 実装後に以下の関数がエクスポートされることを期待
        const logger = require('../logger.js');

        // 【結果検証】実装前の状態では環境判定ロジックは存在しない
        // 現在のlogger.tsにはisDevelopment関数が存在しないため、このアサーションで失敗するはず
        expect(logger.isDevelopment).toBeDefined(); // 【確認内容】: 環境判定関数が存在することを確認 🟡
    });

    /**
     * 正常系テスト: 本番環境のDEBUGログが保存されない
     *
     * Greenフェーズ目的: 実装によりDEBUGが保存されないことを確認
     */
    test('本番環境のDEBUGログが保存されない', async () => {
        // 【テスト目的】: 実装後のlogger.tsでは本番環境でもDEBUGが保存されないことを検証
        // 【テスト内容】：本番環境設定でDEBUGログを追加し、flushしてstorageに保存されないことを確認
        // 【期待される動作】: 実装後はDEBUGが保存されない
        // 🟡 信頼性レベル: 黄信号（実装の挙動による）

        // 【初期条件設定】production環境を設定
        process.env.NODE_ENV = 'production';

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】DEBUGログを追加してflush
        await logger.addLog('DEBUG', 'This is a debug message', { debugData: 'value' });
        await logger.flushLogs(true); // 即時flush

        // 【結果検証】実装後はDEBUGログが保存されていないはず
        const logs = await logger.getLogs();

        // 【Greenフェーズ】：DEBUGログが保存されていないことを確認
        expect(logs.some(log => log.type === 'DEBUG')).toBe(false); // 【確認内容】: DEBUGログが保存されていないことを確認 🟢
    });

    /**
     * 正常系テスト: 本番環境のERRORログが出力される
     */
    test('本番環境のERRORログが出力される', async () => {
        // 【テスト目的】: 本番環境でもERROR等の重要ログは保存されることを確認
        // 【テスト内容】：本番環境設定でERRORログを追加し、storageに保存されることを検証
        // 【期待される動作】: ERRORログは本番環境でも保存される
        // 🟢 信頼性レベル: 青信号（要件定義：本番環境でも重要ログは保存）

        // 【初期条件設定】production環境を設定
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】ERRORログを追加してflush
        await logger.addLog('ERROR', 'This is an error message', { errorData: 'value' });
        await logger.flushLogs(true); // 即時flush

        // 【結果検証】ERRORログが保存されていることを確認
        const logs = await logger.getLogs();

        expect(logs.some(log => log.type === 'ERROR')).toBe(true); // 【確認内容】: ERRORログが保存されていること 🟢
        expect(logs.some(log => log.message === 'This is an error message')).toBe(true); // 【確認内容】: メッセージが保存されていること 🟢

        // 【後片付け】環境変数を元に戻す
        process.env.NODE_ENV = originalEnv;
    });

    /**
     * 正常系テスト: 開発環境のDEBUGログが出力される
     */
    test('開発環境のDEBUGログが出力される', async () => {
        // 【テスト目的】: 開発環境ではDEBUGログが保存されることを確認
        // 【テスト内容】：開発環境設定でDEBUGログを追加し、storageに保存されることを検証
        // 【期待される動作】: 開発環境ではDEBUGログも保存される
        // 🟢 信頼性レベル: 青信号（要件定義：開発環境では全ログ保存）

        // 【初期条件設定】development環境を設定
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】DEBUGログを追加してflush
        await logger.addLog('DEBUG', 'This is a debug message', { debugData: 'value' });
        await logger.flushLogs(true); // 即時flush

        // 【結果検証】DEBUGログが保存されていることを確認
        const logs = await logger.getLogs();

        expect(logs.some(log => log.type === 'DEBUG')).toBe(true); // 【確認内容】: DEBUGログが保存されていること 🟢
        expect(logs.some(log => log.message === 'This is a debug message')).toBe(true); // 【確認内容】: メッセージが保存されていること 🟢

        // 【後片付け】環境変数を元に戻す
        process.env.NODE_ENV = originalEnv;
    });

    /**
     * エラー系テスト: 未定義のノード環境でのデフォルト挙動
     */
    test('未定義のノード環境でのデフォルト挙動', async () => {
        // 【テスト目的】: NODE_ENVが未定義の場合のisDevelopmentの挙動を確認
        // 【テスト内容】：NODE_ENVがundefinedの場合の本番環境挙動を検証
        // 【期待される動作】: NODE_ENVが未定義の場合は本番環境として扱われる（isDevelopment=false）
        // 🟢 信頼性レベル: 青信号（安全策：未定義＝本番）

        // 【初期条件設定】NODE_ENVを未定義に設定
        const originalEnv = process.env.NODE_ENV;
        delete process.env.NODE_ENV;

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】DEBUGログを追加してflush
        await logger.addLog('DEBUG', 'This should be discarded', {});
        await logger.flushLogs(true);

        // 【結果検証】DEBUGログが保存されていないことを確認（本番環境扱い）
        const logs = await logger.getLogs();

        expect(logs.some(log => log.type === 'DEBUG')).toBe(false); // 【確認内容】: DEBUGログが破棄されていること 🟢

        // 【後片付け】環境変数を元に戻す
        process.env.NODE_ENV = originalEnv;
    });

    /**
     * エラー系テスト: 不正な環境文字列の処理
     */
    test('不正な環境文字列の処理', async () => {
        // 【テスト目的】: NODE_ENVにdevelopment以外の値が設定された場合の挙動を確認
        // 【テスト内容】：'test'や'staging'などの環境値でのDEBUGログ処理を検証
        // 【期待される動作】: 'development'以外の環境値は本番環境として扱われる
        // 🟢 信頼性レベル: 青信号（厳密なdevelopmentチェック）

        // 【初期条件設定】test環境を設定
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】DEBUGログを追加してflush
        await logger.addLog('DEBUG', 'This should be discarded', {});
        await logger.flushLogs(true);

        // 【結果検証】DEBUGログが保存されていないことを確認
        const logs = await logger.getLogs();

        expect(logs.some(log => log.type === 'DEBUG')).toBe(false); // 【確認内容】: DEBUGログが破棄されていること 🟢

        // 【後片付け】environment変数を元に戻す
        process.env.NODE_ENV = originalEnv;
    });

    /**
     * 境界値テスト: ログ型列挙値の全種類が正しく扱われる
     */
    test('ログ型列挙値の全種類が正しく扱われる', async () => {
        // 【テスト目的】: 全てのログタイプ（INFO, WARN, ERROR, SANITIZE, DEBUG）が正しく処理されることを確認
        // 【テスト内容】：各ログタイプを追加し、正常に保存されることを検証
        // 【期待される動作】: 全てのログタイプが正しく認識・保存される
        // 🟢 信頼性レベル: 青信号（logger.tsのLogType定義）

        // 【初期条件設定】development環境（DEBUGも保存させる）
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】各種ログタイプを追加してflush
        await logger.addLog('INFO', 'Info message', {});
        await logger.addLog('WARN', 'Warning message', {});
        await logger.addLog('ERROR', 'Error message', {});
        await logger.addLog('SANITIZE', 'Sanitize message', {});
        await logger.addLog('DEBUG', 'Debug message', {});
        await logger.flushLogs(true);

        // 【結果検証】全てのログタイプが保存されていることを確認
        const logs = await logger.getLogs();

        expect(logs.some(log => log.type === 'INFO')).toBe(true); // 【確認内容】: INFOログ 🟢
        expect(logs.some(log => log.type === 'WARN')).toBe(true); // 【確認内容】: WARNログ 🟢
        expect(logs.some(log => log.type === 'ERROR')).toBe(true); // 【確認内容】: ERRORログ 🟢
        expect(logs.some(log => log.type === 'SANITIZE')).toBe(true); // 【確認内容】: SANITIZEログ 🟢
        expect(logs.some(log => log.type === 'DEBUG')).toBe(true); // 【確認内容】: DEBUGログ（開発環境） 🟢

        // 【後片付け】環境変数を元に戻す
        process.env.NODE_ENV = originalEnv;
    });

    /**
     * 境界値テスト: 空メッセージのログ追加
     */
    test('空メッセージのログ追加', async () => {
        // 【テスト目的】: 空文字列メッセージでもロギングが機能するか確認
        // 【テスト内容】：空メッセージのログを追加し、正常に保存されることを検証
        // 【期待される動作】: ユーザー入力ではない空メッセージも保存される
        // 🟢 信頼性レベル: 青信号（バリデーションなしは設計）

        // 【実際の処理実行】logger.tsをインポート
        const logger = await import('../logger.js');

        // 【実際の処理実行】空メッセージのERRORログを追加してflush
        await logger.addLog('ERROR', '', { data: 'value' });
        await logger.flushLogs(true);

        // 【結果検証】空メッセージでもログが保存されていることを確認
        const logs = await logger.getLogs();

        expect(logs.some(log => log.message === '')).toBe(true); // 【確認内容】: 空メッセージのログが保存されている 🟢
        expect(logs.some(log => log.type === 'ERROR')).toBe(true); // 【確認内容】: ERRORタイプであること 🟢
    });
});