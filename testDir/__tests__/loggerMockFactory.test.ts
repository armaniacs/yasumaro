import { describe, it, expect, vi } from 'vitest';
import { createLoggerModuleMock, LOG_TYPE_MOCKS, ERROR_CODE_MOCKS } from '../mocks/logger.js';

describe('createLoggerModuleMock', () => {
  it('creates fresh vi.fn() exports per call', () => {
    const a = createLoggerModuleMock({ logError: 'fn' });
    const b = createLoggerModuleMock({ logError: 'fn' });

    expect(vi.isMockFunction(a.logError)).toBe(true);
    expect(vi.isMockFunction(b.logError)).toBe(true);
    expect(a.logError).not.toBe(b.logError);
  });

  it('resolved style returns a promise per call', async () => {
    const mod = createLoggerModuleMock({ logInfo: 'resolved' });
    const logInfo = mod.logInfo as () => Promise<void>;

    await expect(logInfo()).resolves.toBeUndefined();
  });

  it('asyncNoop style returns a promise per call', async () => {
    const mod = createLoggerModuleMock({ logWarn: 'asyncNoop' });
    const logWarn = mod.logWarn as () => Promise<void>;

    await expect(logWarn()).resolves.toBeUndefined();
  });

  it('resolvedUndefined style resolves to undefined', async () => {
    const mod = createLoggerModuleMock({ logSanitize: 'resolvedUndefined' });
    const logSanitize = mod.logSanitize as () => Promise<void>;

    await expect(logSanitize()).resolves.toBeUndefined();
  });

  it('passes caller-provided values through verbatim', () => {
    const spy = vi.fn();
    const mod = createLoggerModuleMock({ logError: spy });

    expect(mod.logError).toBe(spy);
  });

  it('keeps spec entry order as export order', () => {
    const mod = createLoggerModuleMock({ logWarn: 'fn', logError: 'fn', logInfo: 'fn' });

    expect(Object.keys(mod)).toEqual(['logWarn', 'logError', 'logInfo']);
  });
});

describe('LOG_TYPE_MOCKS', () => {
  it('pins the shapes replaced across test files', () => {
    expect(LOG_TYPE_MOCKS.upper4).toEqual({ INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' });
    expect(LOG_TYPE_MOCKS.upper3).toEqual({ INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' });
    expect(LOG_TYPE_MOCKS.upper2).toEqual({ INFO: 'INFO', ERROR: 'ERROR' });
    expect(LOG_TYPE_MOCKS.upper5).toEqual({
      INFO: 'INFO',
      WARN: 'WARN',
      ERROR: 'ERROR',
      SANITIZE: 'SANITIZE',
      DEBUG: 'DEBUG',
    });
    expect(LOG_TYPE_MOCKS.upperWarnDebug).toEqual({ WARN: 'WARN', DEBUG: 'DEBUG' });
    expect(LOG_TYPE_MOCKS.lower4).toEqual({ INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug' });
    expect(LOG_TYPE_MOCKS.lower3).toEqual({ INFO: 'info', WARN: 'warn', ERROR: 'error' });
    expect(LOG_TYPE_MOCKS.lower5).toEqual({
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error',
      DEBUG: 'debug',
      SANITIZE: 'sanitize',
    });
  });
});

describe('ERROR_CODE_MOCKS', () => {
  it('pins the shared ErrorCode literal maps', () => {
    expect(ERROR_CODE_MOCKS.internalUnknown).toEqual({ INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' });
    expect(ERROR_CODE_MOCKS.internal).toEqual({ INTERNAL_ERROR: 'INT_001' });
    expect(ERROR_CODE_MOCKS.internalKey).toEqual({ INTERNAL_ERROR: 'INTERNAL_ERROR' });
    expect(ERROR_CODE_MOCKS.internalUnknownKey).toEqual({
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    });
    expect(ERROR_CODE_MOCKS.contentExtractionKey).toEqual({
      CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE',
    });
    expect(ERROR_CODE_MOCKS.storageWriteKey).toEqual({ STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' });
    expect(ERROR_CODE_MOCKS.trancoFetchKey).toEqual({ TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' });
    expect(ERROR_CODE_MOCKS.storageRead).toEqual({ STORAGE_READ_FAILURE: 'STRG_RD_001' });
    expect(ERROR_CODE_MOCKS.internalStorageWrite).toEqual({
      INTERNAL_ERROR: 'INT_001',
      STORAGE_WRITE_FAILURE: 'STRG_WR_001',
    });
    expect(ERROR_CODE_MOCKS.storageReadWrite).toEqual({
      STORAGE_READ_FAILURE: 'STRG_RD_001',
      STORAGE_WRITE_FAILURE: 'STRG_WR_001',
    });
    expect(ERROR_CODE_MOCKS.cryptoThree).toEqual({
      CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
      CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
      CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    });
    expect(ERROR_CODE_MOCKS.pipelineSeven).toEqual({
      API_REQUEST_FAILURE: 'API_REQ_001',
      CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
      CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
      CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
      INTERNAL_ERROR: 'INT_001',
      STORAGE_QUOTA_EXCEEDED: 'STO_001',
      STORAGE_WRITE_FAILURE: 'STO_003',
    });
    expect(ERROR_CODE_MOCKS.pipelineSix).toEqual({
      API_REQUEST_FAILURE: 'API_REQ_001',
      CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
      CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
      INTERNAL_ERROR: 'INT_001',
      STORAGE_QUOTA_EXCEEDED: 'STO_001',
      STORAGE_WRITE_FAILURE: 'STO_003',
    });
    expect(ERROR_CODE_MOCKS.storageReadUnknownKey).toEqual({
      STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE',
      UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    });
    expect(ERROR_CODE_MOCKS.apiInternal).toEqual({
      API_REQUEST_FAILURE: 'API_REQ_001',
      INTERNAL_ERROR: 'INT_001',
    });
    expect(ERROR_CODE_MOCKS.storageQuotaKey).toEqual({ STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED' });
    expect(ERROR_CODE_MOCKS.storageThreeX).toEqual({
      STORAGE_MIGRATION_FAILURE: 'x',
      STORAGE_READ_FAILURE: 'x',
      STORAGE_WRITE_FAILURE: 'x',
    });
  });
});
