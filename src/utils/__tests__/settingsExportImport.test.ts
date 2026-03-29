/**
 * settingsExportImport.test.ts
 * settingsExportImport.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

// chrome API モック
const mockChrome = {
    storage: {
        local: {
            get: jest.fn(async () => ({})),
            set: jest.fn(async () => {})
        }
    },
    i18n: {
        getMessage: jest.fn((key: string) => key)
    }
};
(global as any).chrome = mockChrome;

// confirm / alert モック
(global as any).confirm = jest.fn(() => true);
(global as any).alert = jest.fn();

// URL モック
Object.defineProperty(global, 'URL', {
    value: {
        createObjectURL: jest.fn(() => 'blob:http://localhost/fake'),
        revokeObjectURL: jest.fn()
    },
    writable: true,
    configurable: true
});

// logger モック
jest.mock('../logger.js', () => ({
    logError: jest.fn(async () => {}),
    logWarn: jest.fn(async () => {}),
    logInfo: jest.fn(async () => {}),
    ErrorCode: {
        SETTINGS_IMPORT_FAILURE: 'SETTINGS_IMPORT_FAILURE',
        SETTINGS_SIGNATURE_FAILURE: 'SETTINGS_SIGNATURE_FAILURE'
    }
}));

// storage モック
jest.mock('../storage.js', () => ({
    getSettings: jest.fn(async () => ({
        ai_provider: 'gemini',
        obsidian_protocol: 'http',
        obsidian_port: '27123',
        min_visit_duration: 10,
        min_scroll_depth: 25,
        gemini_model: 'gemini-pro',
        obsidian_daily_path: 'Daily',
        openai_base_url: 'https://api.openai.com',
        openai_model: 'gpt-4',
        openai_2_base_url: '',
        openai_2_model: '',
        domain_whitelist: [],
        domain_blacklist: [],
        domain_filter_mode: 'whitelist',
        privacy_mode: 'off',
        pii_confirmation_ui: false,
        pii_sanitize_logs: false,
        ublock_rules: {},
        ublock_sources: [],
        ublock_format_enabled: false,
        simple_format_enabled: false,
        obsidian_api_key: 'obs_key',
        gemini_api_key: 'gem_key',
        openai_api_key: 'oai_key',
        openai_2_api_key: 'oai2_key'
    })),
    saveSettings: jest.fn(async () => {}),
    getOrCreateHmacSecret: jest.fn(async () => 'test_hmac_secret'),
    Settings: {}
}));

// crypto モック
jest.mock('../crypto.js', () => ({
    computeHMAC: jest.fn(async (_secret: string, data: string) => 'hmac_' + Buffer.from(data).toString('base64').substring(0, 20)),
    encrypt: jest.fn(async (plaintext: string) => ({
        ciphertext: 'enc_' + Buffer.from(plaintext).toString('base64'),
        iv: 'test_iv'
    })),
    decryptData: jest.fn(async (data: any) => {
        if (data.ciphertext.startsWith('enc_')) {
            return Buffer.from(data.ciphertext.substring(4), 'base64').toString();
        }
        throw new Error('Decryption failed');
    }),
    deriveKey: jest.fn(async () => 'mock_key'),
    hashPasswordWithPBKDF2: jest.fn(async () => 'hashed'),
    verifyPasswordWithPBKDF2: jest.fn(async () => true),
    generateSalt: jest.fn(() => new Uint8Array(16).fill(42))
}));

// storageSettings モック
jest.mock('../storageSettings.js', () => ({
    API_KEY_FIELDS: ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key']
}));

import {
    EXPORT_VERSION,
    validateExportData,
    isEncryptedExport,
    exportSettings,
    importSettings,
    exportEncryptedSettings,
    importEncryptedSettings,
    saveEncryptedExportToFile
} from '../settingsExportImport.js';

describe('settingsExportImport', () => {

    describe('定数', () => {
        test('EXPORT_VERSION が 1.0.0', () => {
            expect(EXPORT_VERSION).toBe('1.0.0');
        });
    });

    describe('validateExportData', () => {
        const validData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            apiKeyExcluded: true,
            settings: {
                obsidian_protocol: 'http',
                obsidian_port: '27123',
                min_visit_duration: 10,
                min_scroll_depth: 25,
                gemini_model: 'gemini-pro',
                obsidian_daily_path: 'Daily',
                ai_provider: 'gemini',
                openai_base_url: '',
                openai_model: '',
                openai_2_base_url: '',
                openai_2_model: '',
                domain_whitelist: [],
                domain_blacklist: [],
                domain_filter_mode: 'whitelist',
                privacy_mode: 'off',
                pii_confirmation_ui: false,
                pii_sanitize_logs: false,
                ublock_rules: {},
                ublock_sources: [],
                ublock_format_enabled: false,
                simple_format_enabled: false
            }
        };

        test('有効なデータで true を返す', () => {
            expect(validateExportData(validData)).toBe(true);
        });

        test('null で false を返す', () => {
            expect(validateExportData(null)).toBe(false);
        });

        test('文字列で false を返す', () => {
            expect(validateExportData('string')).toBe(false);
        });

        test('version がない場合は false', () => {
            const { version, ...noVersion } = validData;
            expect(validateExportData(noVersion)).toBe(false);
        });

        test('exportedAt がない場合は false', () => {
            const { exportedAt, ...noDate } = validData;
            expect(validateExportData(noDate)).toBe(false);
        });

        test('settings がない場合は false', () => {
            const { settings, ...noSettings } = validData;
            expect(validateExportData(noSettings)).toBe(false);
        });

        test('apiKeyExcluded=true でAPIキーフィールドがなくても true', () => {
            expect(validateExportData(validData)).toBe(true);
        });

        test('apiKeyExcluded=false でAPIキーが必要', () => {
            const data = { ...validData, apiKeyExcluded: false };
            expect(validateExportData(data)).toBe(false);
        });

        test('apiKeyExcluded=false でAPIキーがある場合は true', () => {
            const data = {
                ...validData,
                apiKeyExcluded: false,
                settings: {
                    ...validData.settings,
                    obsidian_api_key: 'key',
                    gemini_api_key: 'key',
                    openai_api_key: 'key',
                    openai_2_api_key: 'key'
                }
            };
            expect(validateExportData(data)).toBe(true);
        });

        test('必須フィールドが欠けている場合は false', () => {
            const incompleteSettings = { obsidian_protocol: 'http' };
            const data = { ...validData, settings: incompleteSettings };
            expect(validateExportData(data)).toBe(false);
        });
    });

    describe('isEncryptedExport', () => {
        test('encrypted: true の場合は true', () => {
            expect(isEncryptedExport({ encrypted: true })).toBe(true);
        });

        test('encrypted: false の場合は false', () => {
            expect(isEncryptedExport({ encrypted: false })).toBe(false);
        });

        test('encrypted フィールドがない場合は false', () => {
            expect(isEncryptedExport({})).toBe(false);
        });

        test('null の場合は false', () => {
            expect(isEncryptedExport(null)).toBe(false);
        });

        test('undefined の場合は false', () => {
            expect(isEncryptedExport(undefined)).toBe(false);
        });

        test('文字列の場合は false', () => {
            expect(isEncryptedExport('encrypted')).toBe(false);
        });
    });

    describe('exportSettings', () => {
        test('Blob を作成してダウンロードリンクを生成する', async () => {
            // document モック
            const mockLink = {
                href: '',
                download: '',
                style: { display: '' },
                click: jest.fn()
            };
            const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
            const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);

            await exportSettings();

            expect(createElementSpy).toHaveBeenCalledWith('a');
            expect(mockLink.click).toHaveBeenCalled();
            expect(appendChildSpy).toHaveBeenCalled();
            expect(removeChildSpy).toHaveBeenCalled();

            createElementSpy.mockRestore();
            appendChildSpy.mockRestore();
            removeChildSpy.mockRestore();
        });
    });

    describe('importSettings', () => {
        test('署名がないファイルは拒否される', async () => {
            const data = JSON.stringify({
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                settings: {},
                apiKeyExcluded: true
            });

            const result = await importSettings(data);
            expect(result).toBeNull();
        });

        test('有効な署名付きファイルをインポートできる', async () => {
            const { computeHMAC } = require('../crypto.js');
            const exportData = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                apiKeyExcluded: true,
                settings: {
                    obsidian_protocol: 'http',
                    obsidian_port: '27123',
                    min_visit_duration: 10,
                    min_scroll_depth: 25,
                    gemini_model: 'gemini-pro',
                    obsidian_daily_path: 'Daily',
                    ai_provider: 'gemini',
                    openai_base_url: '',
                    openai_model: '',
                    openai_2_base_url: '',
                    openai_2_model: '',
                    domain_whitelist: [],
                    domain_blacklist: [],
                    domain_filter_mode: 'whitelist',
                    privacy_mode: 'off',
                    pii_confirmation_ui: false,
                    pii_sanitize_logs: false,
                    ublock_rules: {},
                    ublock_sources: [],
                    ublock_format_enabled: false,
                    simple_format_enabled: false
                }
            };

            // 署名を計算
            const { signature, ...dataForSig } = exportData as any;
            const dataJson = JSON.stringify(dataForSig, null, 2);
            const computedSig = await computeHMAC('test_hmac_secret', dataJson);

            const signedData = { ...exportData, signature: computedSig };
            const result = await importSettings(JSON.stringify(signedData));

            expect(result).not.toBeNull();
        });

        test('無効なJSONで null を返す', async () => {
            const result = await importSettings('not json');
            expect(result).toBeNull();
        });

        test('構造検証に失敗した場合は null を返す', async () => {
            const { computeHMAC } = require('../crypto.js');
            const data = { version: '1.0.0', exportedAt: 'now', settings: {} };
            const sig = await computeHMAC('test_hmac_secret', JSON.stringify(data, null, 2));

            const result = await importSettings(JSON.stringify({ ...data, signature: sig }));
            expect(result).toBeNull();
        });
    });

    describe('exportEncryptedSettings', () => {
        test('暗号化データを返す', async () => {
            const result = await exportEncryptedSettings('master_password');

            expect(result.success).toBe(true);
            expect(result.encryptedData).toBeDefined();
            expect(result.encryptedData?.encrypted).toBe(true);
            expect(result.encryptedData?.version).toBe(EXPORT_VERSION);
            expect(result.encryptedData?.ciphertext).toBeDefined();
            expect(result.encryptedData?.iv).toBeDefined();
            expect(result.encryptedData?.hmac).toBeDefined();
            expect(result.encryptedData?.salt).toBeDefined();
        });
    });

    describe('importEncryptedSettings', () => {
        test('暗号化されていないデータで null を返す', async () => {
            const data = JSON.stringify({ encrypted: false });
            const result = await importEncryptedSettings(data, 'password');
            expect(result).toBeNull();
        });

        test('無効なJSONで null を返す', async () => {
            const result = await importEncryptedSettings('invalid', 'password');
            expect(result).toBeNull();
        });
    });

    describe('saveEncryptedExportToFile', () => {
        test('Blob を作成してダウンロードリンクを生成する', async () => {
            const mockLink = {
                href: '',
                download: '',
                style: { display: '' },
                click: jest.fn()
            };
            const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
            const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);

            await saveEncryptedExportToFile({
                encrypted: true,
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                ciphertext: 'test',
                iv: 'test',
                hmac: 'test',
                salt: 'test'
            });

            expect(mockLink.click).toHaveBeenCalled();
            expect(mockLink.download).toContain('encrypted');

            createElementSpy.mockRestore();
            appendChildSpy.mockRestore();
            removeChildSpy.mockRestore();
        });
    });
});
