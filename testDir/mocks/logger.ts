import { vi } from 'vitest';

/**
 * Shared logger mock factory for the three logger module layers
 * (logger/types.js, logger/core.js, logger/api.js).
 *
 * vi.mock factories are hoisted above static imports, so a test file cannot
 * reference a statically imported binding from inside its factory. Test files
 * therefore import this module dynamically inside the factory body:
 *
 *   vi.mock('../../utils/logger/types.js', async () =>
 *     (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
 *       logError: 'fn',
 *       LogType: 'upper4',
 *       ErrorCode: 'internalUnknown',
 *     }),
 *   );
 *
 * Every call builds a fresh module mock with fresh vi.fn() instances, so each
 * test file keeps the exact mock semantics of the handmade block it replaces.
 */

export type LogFnMockStyle = 'fn' | 'resolved' | 'asyncNoop' | 'resolvedUndefined';

export type LogTypeMockName =
    | 'upper4'
    | 'upper3'
    | 'upper2'
    | 'upper5'
    | 'upperWarnDebug'
    | 'lower4'
    | 'lower3'
    | 'lower5';

export const LOG_TYPE_MOCKS: Record<LogTypeMockName, Record<string, string>> = {
    upper4: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    upper3: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    upper2: { INFO: 'INFO', ERROR: 'ERROR' },
    upper5: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', SANITIZE: 'SANITIZE', DEBUG: 'DEBUG' },
    upperWarnDebug: { WARN: 'WARN', DEBUG: 'DEBUG' },
    lower4: { INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug' },
    lower3: { INFO: 'info', WARN: 'warn', ERROR: 'error' },
    lower5: { INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug', SANITIZE: 'sanitize' },
};

export type ErrorCodeMockName =
    | 'internalUnknown'
    | 'internal'
    | 'internalKey'
    | 'internalUnknownKey'
    | 'contentExtractionKey'
    | 'storageWriteKey'
    | 'trancoFetchKey'
    | 'storageRead'
    | 'internalStorageWrite'
    | 'storageReadWrite'
    | 'cryptoThree'
    | 'pipelineSeven'
    | 'pipelineSix'
    | 'storageReadUnknownKey'
    | 'apiInternal'
    | 'storageQuotaKey'
    | 'storageThreeX';

export const ERROR_CODE_MOCKS: Record<ErrorCodeMockName, Record<string, string>> = {
    internalUnknown: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
    internal: { INTERNAL_ERROR: 'INT_001' },
    internalKey: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
    internalUnknownKey: { INTERNAL_ERROR: 'INTERNAL_ERROR', UNKNOWN_ERROR: 'UNKNOWN_ERROR' },
    contentExtractionKey: { CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
    storageWriteKey: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
    trancoFetchKey: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
    storageRead: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
    internalStorageWrite: { INTERNAL_ERROR: 'INT_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
    storageReadWrite: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
    cryptoThree: {
        CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
        CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
        CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    },
    pipelineSeven: {
        API_REQUEST_FAILURE: 'API_REQ_001',
        CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
        CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
        CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
        INTERNAL_ERROR: 'INT_001',
        STORAGE_QUOTA_EXCEEDED: 'STO_001',
        STORAGE_WRITE_FAILURE: 'STO_003',
    },
    pipelineSix: {
        API_REQUEST_FAILURE: 'API_REQ_001',
        CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
        CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
        INTERNAL_ERROR: 'INT_001',
        STORAGE_QUOTA_EXCEEDED: 'STO_001',
        STORAGE_WRITE_FAILURE: 'STO_003',
    },
    storageReadUnknownKey: { STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE', UNKNOWN_ERROR: 'UNKNOWN_ERROR' },
    apiInternal: { API_REQUEST_FAILURE: 'API_REQ_001', INTERNAL_ERROR: 'INT_001' },
    storageQuotaKey: { STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED' },
    storageThreeX: { STORAGE_MIGRATION_FAILURE: 'x', STORAGE_READ_FAILURE: 'x', STORAGE_WRITE_FAILURE: 'x' },
};

/**
 * Spec entries resolve as: log-function mock style ('fn', 'resolved',
 * 'asyncNoop', 'resolvedUndefined'), named LogType/ErrorCode variant, inline
 * record literal, or a caller-provided value passed through verbatim (e.g. a
 * vi.hoisted spy).
 */
export type LoggerModuleMockSpec = Record<string, unknown>;

const NAMED_MOCK_MAPS: Record<string, Record<string, string>> = {
    ...LOG_TYPE_MOCKS,
    ...ERROR_CODE_MOCKS,
};

export function createLoggerModuleMock(spec: LoggerModuleMockSpec = {}): Record<string, unknown> {
    const mod: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(spec)) {
        if (value === 'fn') {
            mod[key] = vi.fn();
        } else if (value === 'resolved') {
            mod[key] = vi.fn(() => Promise.resolve());
        } else if (value === 'asyncNoop') {
            mod[key] = vi.fn(async () => {});
        } else if (value === 'resolvedUndefined') {
            mod[key] = vi.fn().mockResolvedValue(undefined);
        } else if (typeof value === 'string') {
            const named = NAMED_MOCK_MAPS[value];
            if (!named) throw new Error(`unknown named logger mock: ${value}`);
            mod[key] = { ...named };
        } else {
            mod[key] = value;
        }
    }
    return mod;
}
