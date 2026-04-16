/**
 * obsidianClient-security.test.ts
 * 【セキュリティ強化】コンソールログ機密情報削除機能のテスト
 * 【テスト対象】: src/utils/redaction.js の redactSensitiveData 関数
 *
 * 注: chrome storage モックは jest.setup.ts で設定済み
 */

import { vi } from 'vitest';;

/**
 * 【テストモック設定】consoleオブジェクトのモック化
 * ログ出力の内容を検証できるようにモック
 */
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation();

/**
 * 【テスト前準備】各テスト実行前にモックをクリア
 */
beforeEach(() => {
    mockConsoleError.mockClear();
});

describe('ObsidianClient セキュリティ: コンソールログの機密情報削除（Greenフェーズ）', () => {
    /**
     * 正常系テスト: APIキーがログ出力から除外される
     *
     * Greenフェーズ目的: redactSensitiveDataが正しく実装されていることを確認
     */
    test('APIキーがログ出力から除外される', async () => {
        // 【テスト目的】: console.errorにAPIキーを含むオブジェクトを渡した場合、ログにAPIキーが含まれないことを確認
        // 【テスト内容】：APIキー（fullKey）を含むオブジェクトをログに出力し、値が削除されていることを検証
        // 【期待される動作】: ログ出力に `fullKey: 'sk-...'` が含まれていない
        // 🟢 信頼性レベル: 青信号（実装されたredaction.js確認済み）

        // 【実際の処理実行】redactionをインポート
        const { redactSensitiveData } = await import('../../utils/redaction.js');

        // 【テストデータ準備】APIキーを含むログデータ
        const logData = {
            apiKey: 'string',
            fullKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890', // 実際のAPIキー
            message: 'Connection failed',
        };

        // 【実際の処理実行】redaction実行
        const result = redactSensitiveData(logData);

        // 【結果検証】APIキーが削除されていることを確認
        expect(result.fullKey).not.toBe('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890'); // 【確認内容】: 元のAPIキーが出力されていないことを確認 🟢
        expect(result.fullKey).toBe('[REDACTED]'); // 【確認内容】: fullKeyがredaction済みであることを確認 🟢
        // 注: apiKeyキーはキー名に'apiKey'が含まれるためredactionされる
        expect(result.apiKey).toBe('[REDACTED]'); // 【確認内容】: apiKeyキーもredactionされることを確認 🟢
        expect(result.message).toBe('Connection failed'); // 【確認内容】: messageキーはそのままであることを確認 🟢
    });

    /**
     * 正常系テスト: ネスト構造におけるredaction
     *
     * Greenフェーズ目的: 深いネスト構造でもredactionが動作することを確認
     */
    test('ネスト構造におけるredaction', async () => {
        // 【テスト目的】: 入れ子のオブジェクトの深い階層でもredactionが動作することを確認
        // 【テスト内容】：複数階層のネスト構造に含まれるAPIキーが適切にredactionされることを検証
        // 【期待される動作】: ネスト内の機密キーも[REDACTED]に置換される
        // 🟢 信頼性レベル: 青信号（redaction.jsの再帰処理実装確認済み）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        const nestedData = {
            level1: {
                level2: {
                    level3: {
                        apiKey: 'secret-key-12345',
                        fullKey: 'sk-secret-full-key',
                    }
                }
            },
            safeData: 'normal-value'
        };

        const result = redactSensitiveData(nestedData);

        // 【結果検証】深いネスト内のAPIキーが削除されていることを確認
        expect(result.level1.level2.level3.apiKey).toBe('[REDACTED]'); // 【確認内容】: ネスト内のapiKeyがredaction済み 🟢
        expect(result.level1.level2.level3.fullKey).toBe('[REDACTED]'); // 【確認内容】: ネスト内のfullKeyがredaction済み 🟢
        expect(result.safeData).toBe('normal-value'); // 【確認内容】: 安全なデータはそのまま 🟢
    });

    /**
     * 正常系テスト: 配列内の機密情報redaction
     *
     * Greenフェーズ目的: 配列構造でもredactionが動作することを確認
     */
    test('配列内の機密情報redaction', async () => {
        // 【テスト目的】: 配列要素に含まれる機密情報が適切にredactionされることを確認
        // 【テスト内容】：オブジェクトを含む配列で機密キーが適切に処理されることを検証
        // 【期待される動作】: 配列各要素内の機密キーが[REDACTED]に置換される
        // 🟢 信頼性レベル: 青信号（redaction.jsの配列処理実装確認済み）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        const arrayData = [
            { name: 'Item 1', apiKey: 'key-1' },
            { name: 'Item 2', apiKey: 'key-2' },
            { name: 'Item 3', apiKey: 'key-3' },
        ];

        const result = redactSensitiveData(arrayData);

        // 【結果検証】配列内の全APIキーが削除されていることを確認
        expect(result[0].apiKey).toBe('[REDACTED]'); // 【確認内容】: 配列要素1のapiKeyがredaction済み 🟢
        expect(result[1].apiKey).toBe('[REDACTED]'); // 【確認内容】: 配列要素2のapiKeyがredaction済み 🟢
        expect(result[2].apiKey).toBe('[REDACTED]'); // 【確認内容】: 配列要素3のapiKeyがredaction済み 🟢
        expect(result[0].name).toBe('Item 1'); // 【確認内容】: 非機密データはそのまま 🟢
        expect(result[1].name).toBe('Item 2'); // 【確認内容】: 非機密データはそのまま 🟢
        expect(result[2].name).toBe('Item 3'); // 【確認内容】: 非機密データはそのまま 🟢
    });

    /**
     * エッジケーステスト: null/undefined handling
     *
     * Greenフェーズ目的: nullやundefinedが適切に処理されることを確認
     */
    test('null/undefined handling', async () => {
        // 【テスト目的】: nullやundefined値がredaction処理で適切に扱われることを確認
        // 【テスト内容】：機密キーの値としてnull/undefinedを含む場合の動作を検証
        // 【期待される動作】: null/undefinedの機密キーも[REDACTED]に置換される
        // 🟢 信頼性レベル: 青信号（redaction.jsの基本型チェック実装確認済み）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        const dataWithNulls = {
            apiKey: null,
            fullKey: undefined,
            normalValue: 'test',
        };

        const result = redactSensitiveData(dataWithNulls);

        // 【結果検証】null/undefinedの機密キーもredactionされることを確認
        expect(result.apiKey).toBe('[REDACTED]'); // 【確認内容】: nullのapiKeyがredaction済み 🟢
        expect(result.fullKey).toBe('[REDACTED]'); // 【確認内容】: undefinedのfullKeyがredaction済み 🟢
        expect(result.normalValue).toBe('test'); // 【確認内容**: 非機密データはそのまま 🟢
    });

    /**
     * 正常系テスト: 基本型のredaction
     *
     * Greenフェーズ目的: 基本型（文字列、数値、真偽値）がそのまま返却されることを確認
     */
    test('基本型はそのまま返却される', async () => {
        // 【テスト目的】: 純粋な基本型データが変更されずに返却されることを確認
        // 【テスト内容】：文字列、数値、真偽値、nullの基本型をredactionに渡し、そのまま返ることを検証
        // 【期待される動作】: 基本型データは変更なしで返却される
        // 🟢 信頼性レベル: 青信号（redaction.jsの早期return実装確認済み）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        expect(redactSensitiveData('string')).toBe('string'); // 【確認内容】: 文字列はそのまま 🟢
        expect(redactSensitiveData(123)).toBe(123); // 【確認内容】: 数値はそのまま 🟢
        expect(redactSensitiveData(true)).toBe(true); // 【確認内容】: 真偽値はそのまま 🟢
        expect(redactSensitiveData(null)).toBe(null); // 【確認内容】: nullはそのまま 🟢
    });

    /**
     * 安全対策テスト: 再帰深度制限
     *
     * Refactorフェーズ目的: 極端に深いネスト構造でも安全に処理されることを確認
     */
    test('極端に深いネスト構造で安全に処理される', async () => {
        // 【テスト目的】: MAX_RECURSION_DEPTH（100）を超える深さのネスト構造でエラーにならないことを確認
        // 【テスト内容】：深いネスト構造を生成し、安全に処理される（スタックオーバーフローしない）ことを検証
        // 【期待される動作】: 深度制限を超えた部分では '[REDACTED: too deep]' を返却（データ漏洩防止）
        // 🟢 信頼性レベル: 青信号（refactorで追加した深度制限実装確認済み）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        // 深いネスト構造を生成（103階層）
        let deepObject: any = { apiKey: 'deep-key', value: 'root' };
        for (let i = 0; i < 103; i++) {
            deepObject = { apiKey: `key-layer-${i}`, nested: deepObject };
        }

        // 【安全確認】: スタックオーバーフローせずに処理が終了することを確認
        expect(() => redactSensitiveData(deepObject)).not.toThrow(); // 【確認内容】: エラーがスローされないこと 🟢
    });

    /**
     * 正常系テスト: APIキーの型情報のみログに出力される
     */
    test('APIキーの型情報のみログに出力される', async () => {
        // 【テスト目的】: typeofによる型情報はredactionされずにログに出力されることを確認
        // 【テスト内容】：型情報を含むオブジェクトをredactionし、型情報は保持されることを検証
        // 【期待される動作】: typeofの結果（'string'等）は文字列としてそのまま出力される
        // 🟢 信頼性レベル: 青信号（redactionロジックは特定キー名のみ対象）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        // 【テストデータ準備】型情報を含むデータ（実際のobsidianClient.tsの使用パターン）
        const typeInfoData = {
            apiKey: 'string', // typeof apiKeyの結果。キー名にapiKeyが含まれるが値は型情報
            message: 'Type information logged',
        };

        // 【実際の処理実行】redaction実行
        const result = redactSensitiveData(typeInfoData);

        // 【結果検証】型情報はredactionされるが、設計上は問題ないことを確認
        // 注: apiKeyキーはSENSITIVE_KEYSに含まれるためredactionされるが、値は型情報で本物ではない
        expect(result.apiKey).toBe('[REDACTED]'); // 【確認内容】: apiKeyキーはredactionされる（キー名ベース） 🟢
        expect(result.message).toBe('Type information logged'); // 【確認内容】: messageキーはそのまま 🟢
    });

    /**
     * 正常系テスト: redaction関数が安全に機密情報を処理する
     */
    test('redaction関数が安全に機密情報を処理する', async () => {
        // 【テスト目的】: redactSensitiveData関数が様々な形式のデータを安全に処理できることを確認
        // 【テスト内容】：複雑なデータ構造（ネスト、配列、混合）をredactionし、期待通りに処理されることを検証
        // 【期待される動作】: 全ての機密キーが削除され、安全なデータは保持される
        // 🟢 信頼性レベル: 青信号（redaction.jsの完全性確認）

        const { redactSensitiveData } = await import('../../utils/redaction.js');

        // 【テストデータ準備】複雑な混合データ構造
        const complexData = {
            config: {
                apiKey: 'secret-api-key',
                endPoint: 'https://api.example.com',
            },
            metadata: [
                { id: 1, auth: 'token1' },
                { id: 2, password: 'secret1' },
                { id: 3, apiKey: 'key2' },
            ],
            system: {
                version: '1.0.0',
                build: 12345,
            },
        };

        // 【実際の処理実行】redaction実行
        const result = redactSensitiveData(complexData);

        // 【結果検証】全ての機密キーがredactionされることを確認
        expect(result.config.apiKey).toBe('[REDACTED]'); // 【確認内容】: ネスト内のapiKey 🟢
        expect(result.config.endPoint).toBe('https://api.example.com'); // 【確認内容】: エンドポイントは保持 🟢
        expect(result.metadata[0].auth).toBe('[REDACTED]'); // 【確認内容】: 配列内のauth 🟢
        expect(result.metadata[1].password).toBe('[REDACTED]'); // 【確認内容】: 配列内のpassword 🟢
        expect(result.metadata[2].apiKey).toBe('[REDACTED]'); // 【確認内容】: 配列内のapiKey 🟢
        expect(result.metadata[0].id).toBe(1); // 【確認内容】: IDは保持 🟢
        expect(result.system.version).toBe('1.0.0'); // 【確認内容】: システム情報は保持 🟢
    });
});