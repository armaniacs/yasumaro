import { describe, it, expect } from 'vitest';
import * as limitsModule from '../limits.js';
import { MAX_QUERY_LIMIT as ENGINE_LIMIT } from '../../offscreen/sqliteEngineHost.js';
import { STORAGE_QUOTA_BYTES as QUOTA } from '../storage/quota.js';

const EXPECTED: Record<string, number> = {
  MAX_CONTENT_LENGTH: 1000000,
  MAX_TITLE_LENGTH: 500,
  MAX_SEARCH_QUERY_LENGTH: 1000,
  MAX_IMPORT_ROWS: 1000,
  MAX_IMPORT_BYTES: 2000000,
  MAX_RESTORE_DB_BYTES: 10000000,
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES: 8388608,
  MAX_APPEND_IDS: 100,
  MAX_RESTORE_BASE64_BYTES: 157286400,
  AUDIT_CAP_OPFS: 1000,
  AUDIT_CAP_IDB: 100000,
  MAX_QUERY_LIMIT: 100000,
  MAX_LOG_FORWARD_MESSAGE_CHARS: 65536,
  MAX_LOG_FORWARD_DETAILS_KEYS: 64,
  MAX_LOG_FORWARD_SERIALIZED_CHARS: 262144,
  MAX_RECORD_SIZE: 65536,
  MAX_PII_INPUT_SIZE: 65536,
  MAX_PII_OUTPUT_SIZE: 131072,
  MAX_TOKENS_PER_CALL: 10000000,
  MAX_ENVELOPE_CIPHERTEXT_LENGTH: 67108864,
  MAX_ERROR_BODY_SIZE: 1048576,
  MAX_IMPORT_TEXT_BYTES: 10485760,
  MAX_PAYLOAD_STRING_BYTES: 1048576,
  MAX_BATCH_TOTAL_BYTES: 20971520,
  MAX_PAYLOAD_TOTAL_BYTES: 20971520,
  MAX_FILTER_LIST_SIZE: 10485760,
  MAX_BODY_SIZE: 10485760,
  DEFAULT_IMPORT_SIZE_CAP_BYTES: 10485760,
  MAX_ENVELOPE_BASE64_LENGTH: 10485760,
  MAX_AI_HTTP_RESPONSE_BYTES: 10485760,
  STORAGE_QUOTA_BYTES: 10485760,
  IMPORT_TOTAL_ROW_CAP: 100000,
  MAX_SUMMARY_LENGTH: 100000,
  MAX_QUERY_IDS: 200,
  MAX_ARCHIVE_QUERY_LIMIT: 500,
  MAX_BYTE_STAT_BYTES: 16777216,
  MAX_CLEANSED_ELEMENTS: 1000000,
  MAX_CLEANSED_REASON_CHARS: 128,
  MAX_CLEANSED_REASONS: 64,
};

const EXPECTED_LIMITS_EXPORT_COUNT = 41;

const VALIDATOR_LIMIT_KEYS = [
  'MAX_APPEND_IDS',
  'MAX_ARCHIVE_EXPORT_CHUNK_BYTES',
  'MAX_ARCHIVE_QUERY_LIMIT',
  'MAX_BYTE_STAT_BYTES',
  'MAX_CLEANSED_ELEMENTS',
  'MAX_CLEANSED_REASON_CHARS',
  'MAX_CLEANSED_REASONS',
  'MAX_CONTENT_LENGTH',
  'MAX_IMPORT_BYTES',
  'MAX_IMPORT_ROWS',
  'MAX_RESTORE_DB_BYTES',
  'MAX_SEARCH_QUERY_LENGTH',
  'MAX_TITLE_LENGTH',
].sort();

describe('cap parity guard', () => {
  const surface = { ...limitsModule } as Record<string, object | number>;

  it.each(Object.entries(EXPECTED))('%s keeps its value', (name, value) => {
    expect(surface[name]).toBe(value);
  });

  it('exposes every expected export name', () => {
    for (const name of Object.keys(EXPECTED)) {
      expect(name in surface).toBe(true);
    }
    expect(Object.keys(limitsModule).length).toBe(EXPECTED_LIMITS_EXPORT_COUNT);
  });

  it('QUERY_CAPS and VALIDATOR_LIMITS keep their shape', () => {
    expect(surface.QUERY_CAPS).toEqual({ fts: 100000, plain: 10000 });
    expect(Object.keys(surface.VALIDATOR_LIMITS as Record<string, unknown>).sort()).toEqual(
      VALIDATOR_LIMIT_KEYS,
    );
    const limits = surface.VALIDATOR_LIMITS as Record<string, number>;
    for (const name of VALIDATOR_LIMIT_KEYS) {
      expect(limits[name]).toBe(EXPECTED[name]);
    }
  });

  it('re-exported wire caps match the registry', () => {
    expect(ENGINE_LIMIT).toBe(100000);
    expect(QUOTA).toBe(10485760);
  });
});
