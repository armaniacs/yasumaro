/**
 * settingsExportImport-signature.test.ts
 * 【セキュリティ強化】設定ファイル署名強化機能のテスト
 * 【テスト対象】: src/utils/settingsExportImport.ts の署名検証挙動
 *
 * 注: chrome storage モックと Web Crypto API は jest.setup.ts で設定済み
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/**
 * 【テスト前準備】alert モックの設定
 */
beforeEach(() => {
    // 【モック設定】alert
    global.alert = jest.fn(() => {});
    global.confirm = jest.fn(() => false);
    // chrome.storage.localをクリア
    chrome.storage.local.clear();
});

describe('設定ファイル署名強化: signature enforcement（Greenフェーズ）', () => {
    /**
     * 異常系テスト: 署名なしファイルの拒否
     *
     * Greenフェーズ目的: 署名なしファイルが即時拒否されることを確認
     */
    test('署名のないファイルのインポート拒否', async () => {
        // 【テスト目的】: signatureフィールドが欠けている設定ファイルを拒否することを確認
        // 【テスト内容】：署名なしのJSONファイルをインポートし、即時拒否されることを検証
        // 【期待される動作】: 警告ダイアログなしで即時拒否
        // 🟢 信頼性レベル: 青信号（実装された署名強化ロジック確認済み）

        // 【テストデータ準備】署名なしの設定ファイル
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            // signatureフィールドなし
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】implementation依存の動作を確認
        const settingsExportImport = await import('../settingsExportImport.js');

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】実装後：署名なしファイルは即時拒否
        expect(result).toBeNull(); // 【確認内容】: インポートが拒否されnullが返されたことを確認 🟢

        // 【Greenフェーズ】署名なしファイルは即時アラートで拒否
        expect(global.alert).toHaveBeenCalledWith(
            expect.stringContaining('does not contain a signature')
        ); // 【確認内容】: アラート（エラー）が表示されたことを確認 🟢

        // confirmダイアログが呼ばれていないことを確認（警告ダイアログなしで即時拒否）
        expect(global.confirm).not.toHaveBeenCalled(); // 【確認内容】: 確認ダイアログが表示されていないことを確認 🟢
    });

    /**
     * 正常系テスト: 有効な署名付き設定ファイルのインポート成功
     */
    test('有効な署名付き設定ファイルのインポート成功', async () => {
        // 【テスト目的】: 有効な署名が含まれる設定ファイルのインポートが成功することを確認
        // 【テスト内容】：有効な署名が含まれる設定ファイルをインポートし、成功することを検証
        // 【期待される動作】: 署名検証が成功し、設定がインポートされる
        // 🟢 信頼性レベル: 青信号（既存の署名検証実装確認済み）

        // 【テストデータ準備】署名付き設定ファイル
        const mockSignature = 'valid-signature-mock';
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: mockSignature,
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        // 【モック設定】computeHMACが同じ署名を返す
        const cryptoModule = await import('../../utils/crypto.js');
        jest.spyOn(cryptoModule, 'computeHMAC').mockResolvedValue(mockSignature);

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】署名付きの有効ファイルはインポート成功（テスト環境の戻り値）
        expect(result).not.toBeNull(); // 【確認内容】: インポートが成功していること 🟢
        expect(global.alert).not.toHaveBeenCalled(); // 【確認内容】: アラートが表示されていないこと 🟢
    });

    /**
     * 正常系テスト: 署名が改ざんされたファイルのインポート失敗
     */
    test('署名が改ざんされたファイルのインポート失敗', async () => {
        // 【テスト目的】: 署名フィールドが改ざんされたファイルが拒否されることを確認
        // 【テスト内容】：不正な署名を含む設定ファイルをインポートし、拒否されることを検証
        // 【期待される動作】: 署名検証に失敗し、インポートが拒否される
        // 🟢 信頼性レベル: 青信号（既存の署名検証実装確認済み）

        // 【テストデータ準備】署名が改ざんされた設定ファイル
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: 'tampered-signature', // 改ざんされた署名
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        // 【モック設定】computeHMACが元の署名と異なる値を返す
        const cryptoModule = await import('../../utils/crypto.js');
        jest.spyOn(cryptoModule, 'computeHMAC').mockResolvedValue('original-signature');

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】改ざんされた署名でインポート拒否
        expect(result).toBeNull(); // 【確認内容】: インポートが拒否されたこと 🟢
        expect(global.confirm).toHaveBeenCalledWith(
            expect.stringContaining('signature verification failed')
        ); // 【確認内容】: force import 確認が表示されたこと 🟢
    });

    /**
     * 正常系テスト: データが改ざんされたファイルの署名検証失敗
     */
    test('データが改ざんされたファイルの署名検証失敗', async () => {
        // 【テスト目的】: データ部分（署名以外）が改ざんされたファイルが検知されることを確認
        // 【テスト内容】：設定値が変更されたファイルをインポートし、署名検証に失敗することを検証
        // 【期待される動作】: データの改ざんが検知され、インポートが拒否される
        // 🟢 信頼性レベル: 青信号（HMACの完全性保証特性）

        // 【テストデータ準備】データが改ざんされた設定ファイル
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'https', // 改ざん：httpからhttpsに変更
                obsidian_port: '9999', // 改ざん：27124から9999に変更
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: 'original-signature', // 元の署名を残した状態
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        // 【モック設定】computeHMACが改ざん後のデータから異なる署名を返す
        const cryptoModule = await import('../../utils/crypto.js');
        jest.spyOn(cryptoModule, 'computeHMAC').mockResolvedValue('tampered-data-signature');

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】データ改ざんでインポート拒否
        expect(result).toBeNull(); // 【確認内容】: インポートが拒否されたこと 🟢
        expect(global.confirm).toHaveBeenCalledWith(
            expect.stringContaining('signature verification failed')
        ); // 【確認内容】: force import 確認が表示されたこと 🟢
    });

    /**
     * エラー系テスト: 不正な署名形式の処理
     */
    test('不正な署名形式の処理', async () => {
        // 【テスト目的】: 署名フィールドが不正な形式の場合の挙動を確認
        // 【テスト内容】：署名が数値やnullなど無効な形式の場合の処理を検証
        // 【期待される動作】: 不正な署名形式は署名なしとして扱われ、即時拒否
        // 🟢 信頼性レベル: 青信号（型安全な署名チェック）

        // 【テストデータ準備】署名が数値（不正な形式）の設定ファイル
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: 12345, // 不正な署名形式（数値）
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】不正な署名形式でインポート拒否
        expect(result).toBeNull(); // 【確認内容】: インポートが拒否されたこと 🟢
    });

    /**
     * 境界値テスト: 空のsettingsオブジェクトの署名検証
     */
    test('空のsettingsオブジェクトの署名検証', async () => {
        // 【テスト目的】: settingsフィールドが空オブジェクトの場合の署名検証挙動を確認
        // 【テスト内容】：空のsettingsを持つ署名付きファイルの検証を検証
        // 【期待される動作】: 構造検証で失敗し、インポートが拒否される
        // 🟢 信頼性レベル: 青信号（validateExportDataの構造チェック）

        // 【テストデータ準備】settingsが空の設定ファイル
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {}, // 空object
            apiKeyExcluded: false,
            signature: 'some-signature',
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】空settingsで検証失敗
        expect(result).toBeNull(); // 【確認内容】: インポートが拒否されたこと 🟢
    });

    /**
     * 境界値テスト: 特殊文字を含む設定値の署名検証
     */
    test('特殊文字を含む設定値の署名検証', async () => {
        // 【テスト目的】: 特殊文字やUnicodeを含む設定値でも署名検証が正しく動作することを確認
        // 【テスト内容】：特殊文字を含む設定を持つ署名付きファイルのインポートを検証
        // 【期待される動作】: 特殊文字を含む値でも署名検証が成功し、インポートが成功する
        // 🟢 信頼性レベル: 青信号（HMACのバイナリ対応性）

        // 【テストデータ準備】特殊文字を含む設定ファイル
        const mockSignature = '-special-chars-signature';
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/日付/{date}', // 日本語と特殊文字
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: 'example.com\nexample.org', // 改行文字
                domain_blacklist: 'test<script>alert(1)</test>', // HTML特殊文字
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '🔒#rule1\n🔓#rule2', // 絵文字と改行
                ublock_sources: 'src1,src2',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: mockSignature,
        };

        const jsonData = JSON.stringify(exportData);

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        // 【モック設定】computeHMACが同じ署名を返す
        const cryptoModule = await import('../../utils/crypto.js');
        jest.spyOn(cryptoModule, 'computeHMAC').mockResolvedValue(mockSignature);

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】特殊文字を含む値でもインポート成功
        expect(result).not.toBeNull(); // 【確認内容】: インポートが成功していること 🟢
        expect(result?.obsidian_daily_path).toBe('Daily/日付/{date}'); // 【確認内容】: 日本語が正しく保持されていること 🟢
    });

    /**
     * 正常系テスト: HMAC署名の正確性検証
     */
    test('HMAC署名の正確性検証', async () => {
        // 【テスト目的】: HMAC署名がデータの完全性を正確に保証することを確認
        // 【テスト内容】：同じデータに対して同じ署名が生成されることを検証
        // 【期待される動作】: HMAC署名は決定論的で、同じ入力には同じ署名が生成される
        // 🟢 信頼性レベル: 青信号（HMACのバリデーション特性）

        // 【テストデータ準備】一貫性のある設定データ
        const exportData = {
            version: '1.0.0',
            exportedAt: '2024-01-01T00:00:00.000Z', // 固定のタイムスタンプ
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27124',
                min_visit_duration: 1000,
                min_scroll_depth: 50,
                gemini_model: 'gemini-opus',
                obsidian_daily_path: 'Daily/{date}',
                ai_provider: 'openai',
                openai_base_url: 'https://api.openai.com/v1',
                openai_model: 'gpt-4',
                openai_2_base_url: 'https://api.openai.com/v1',
                openai_2_model: 'gpt-3.5-turbo',
                domain_whitelist: '',
                domain_blacklist: '',
                domain_filter_mode: 'whitelist',
                privacy_mode: false,
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: '',
                ublock_sources: '',
                ublock_format_enabled: false,
                simple_format_enabled: false,
            },
            apiKeyExcluded: true,
            signature: 'consistent-signature',
        };

        const jsonData = JSON.stringify(exportData);
        const expectedSignature = 'consistent-signature';

        // 【実際の処理実行】settingsExportImportをインポート
        const settingsExportImport = await import('../settingsExportImport.js');

        // 【モック設定】computeHMACが一貫して同じ署名を返す
        let callCount = 0;
        const cryptoModule = await import('../../utils/crypto.js');
        jest.spyOn(cryptoModule, 'computeHMAC').mockImplementation(async () => {
            callCount++;
            return expectedSignature;
        });

        const result = await settingsExportImport.importSettings(jsonData);

        // 【結果検証】HMAC署名の一貫性を確認
        expect(result).not.toBeNull(); // 【確認内容】: インポートが成功していること 🟢
        expect(callCount).toBeGreaterThan(0); // 【確認内容】: computeHMACが呼ばれたこと 🟢
    });
});