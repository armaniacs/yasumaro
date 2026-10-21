import { describe, it, expect } from 'vitest';
import {
  ValidVisitValidator,
  DashboardSqliteValidator,
  FetchUrlValidator,
  ManualRecordValidator,
  CheckDomainValidator,
  ContentCleansingExecutedValidator,
  TestObsidianValidator,
  GenerateReviewSummaryValidator,
  LogForwardValidator,
  ValidationError,
  validVisitValidator,
  dashboardSqliteValidator,
  fetchUrlValidator,
  manualRecordValidator,
  checkDomainValidator,
  contentCleansingExecutedValidator,
  testObsidianValidator,
  generateReviewSummaryValidator,
  logForwardValidator,
} from '../validators.js';
import { MAX_BYTE_STAT_BYTES, MAX_CLEANSED_ELEMENTS } from '../../utils/limits.js';

describe('MessageValidator interface', () => {
  it('singletons are instances of correct classes', () => {
    expect(validVisitValidator).toBeInstanceOf(ValidVisitValidator);
    expect(dashboardSqliteValidator).toBeInstanceOf(DashboardSqliteValidator);
  });

  it('ValidationError has correct name and fields', () => {
    const err = new ValidationError('TestValidator', 'bad field', 'myField');
    expect(err.name).toBe('ValidationError');
    expect(err.validatorName).toBe('TestValidator');
    expect(err.field).toBe('myField');
    expect(err.message).toBe('bad field');
  });
});

describe('ValidVisitValidator', () => {
  const v = new ValidVisitValidator();

  it('accepts valid VALID_VISIT', () => {
    const msg = { type: 'VALID_VISIT', payload: { content: 'hello world' }, protocolVersion: 1 };
    expect(v.validate(msg).payload.content).toBe('hello world');
  });

  it('rejects missing content', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: {}, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects empty content', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: { content: '' }, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects non-string content', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: { content: 123 }, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects wrong type', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: { url: 'https://example.com' } })).toThrow(ValidationError);
  });

  it('rejects invalid force type', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: { content: 'hi', force: 'yes' as unknown as boolean } })).toThrow(ValidationError);
  });

  it('accepts optional force boolean', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: { content: 'hi', force: true } })).not.toThrow();
  });
});

describe('DashboardSqliteValidator', () => {
  const v = new DashboardSqliteValidator();

  it('accepts valid query request', () => {
    expect(() => v.validate({ subtype: 'query', limit: 10 })).not.toThrow();
    expect(() => v.validate({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'query' }, protocolVersion: 1 })).not.toThrow();
  });

  it('rejects unknown subtype', () => {
    expect(() => v.validate({ subtype: 'unknown_op' })).toThrow(ValidationError);
  });

  it('rejects missing subtype', () => {
    expect(() => v.validate({ limit: 10 })).toThrow(ValidationError);
  });

  it('rejects toggle_star without id', () => {
    expect(() => v.validate({ subtype: 'toggle_star' })).toThrow(ValidationError);
  });

  it('accepts toggle_star with id', () => {
    expect(() => v.validate({ subtype: 'toggle_star', id: 42 })).not.toThrow();
  });

  it('rejects update without changes', () => {
    expect(() => v.validate({ subtype: 'update', id: 1 })).toThrow(ValidationError);
  });

  it('accepts update with changes', () => {
    expect(() => v.validate({ subtype: 'update', id: 1, changes: { title: 'new' } })).not.toThrow();
  });

  it('rejects search without query', () => {
    expect(() => v.validate({ subtype: 'search' })).toThrow(ValidationError);
  });

  it('accepts search with query', () => {
    expect(() => v.validate({ subtype: 'search', query: 'hello' })).not.toThrow();
  });

  it('rejects import without rows', () => {
    expect(() => v.validate({ subtype: 'import' })).toThrow(ValidationError);
  });

  it('rejects restore_db without data', () => {
    expect(() => v.validate({ subtype: 'restore_db' })).toThrow(ValidationError);
  });

  it('rejects append_to_obsidian without ids', () => {
    expect(() => v.validate({ subtype: 'append_to_obsidian' })).toThrow(ValidationError);
  });

  it('accepts valid status and get_count (no extra fields)', () => {
    expect(() => v.validate({ subtype: 'status' })).not.toThrow();
    expect(() => v.validate({ subtype: 'get_count' })).not.toThrow();
  });

  it('accepts all 20 subtypes without throwing for minimal valid shape', () => {
    const validSamples: Array<Record<string, unknown>> = [
      { subtype: 'create_confirm_token', action: 'delete', id: 1 },
      { subtype: 'query' },
      { subtype: 'search', query: 'q' },
      { subtype: 'toggle_star', id: 1 },
      { subtype: 'delete', id: 1 },
      { subtype: 'update', id: 1, changes: {} },
      { subtype: 'migrate' },
      { subtype: 'clear_all' },
      { subtype: 'get_count' },
      { subtype: 'status' },
      { subtype: 'cleanup_legacy' },
      { subtype: 'backfill_metadata' },
      { subtype: 'resync_legacy' },
      { subtype: 'backup_db' },
      { subtype: 'restore_db', data: 'base64' },
      { subtype: 'import', rows: [] },
      { subtype: 'append_to_obsidian', ids: [1] },
      { subtype: 'purge_now' },
      { subtype: 'content_purge_now' },
      { subtype: 'audit_log_query' },
    ];
    for (const sample of validSamples) {
      expect(() => v.validate(sample), `subtype ${sample.subtype} should be valid`).not.toThrow();
      expect(() => v.validate({ type: 'DASHBOARD_SQLITE', payload: sample, protocolVersion: 1 }), `wrapped ${sample.subtype}`).not.toThrow();
    }
  });
});

describe('FetchUrlValidator', () => {
  const v = new FetchUrlValidator();

  it('accepts valid https url', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: { url: 'https://example.com/path' }, protocolVersion: 1 })).not.toThrow();
  });

  it('rejects missing url', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: {}, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects non-http protocol', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: { url: 'ftp://example.com' }, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects invalid url', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: { url: 'not-a-url' }, protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects wrong type', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', payload: { url: 'https://example.com' } })).toThrow(ValidationError);
  });
});

describe('ManualRecordValidator', () => {
  const v = new ManualRecordValidator();

  it('accepts valid MANUAL_RECORD', () => {
    expect(() =>
      v.validate({ type: 'MANUAL_RECORD', payload: { title: 't', url: 'https://example.com', content: 'c' }, protocolVersion: 1 }),
    ).not.toThrow();
  });

  it('accepts valid PREVIEW_RECORD and SAVE_RECORD', () => {
    expect(() =>
      v.validate({ type: 'PREVIEW_RECORD', payload: { title: 't', url: 'https://example.com', content: 'c' } }),
    ).not.toThrow();
    expect(() =>
      v.validate({ type: 'SAVE_RECORD', payload: { title: 't', url: 'https://example.com', content: 'c' } }),
    ).not.toThrow();
  });

  it('rejects missing title', () => {
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { url: 'https://example.com', content: 'c' } })).toThrow(ValidationError);
  });

  it('rejects missing url', () => {
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { title: 't', content: 'c' } })).toThrow(ValidationError);
  });

  it('rejects missing content', () => {
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { title: 't', url: 'https://example.com' } })).toThrow(ValidationError);
  });

  it('rejects invalid force', () => {
    expect(() =>
      v.validate({ type: 'MANUAL_RECORD', payload: { title: 't', url: 'https://example.com', content: 'c', force: 'yes' as unknown as boolean } }),
    ).toThrow(ValidationError);
  });

  it('rejects unknown type', () => {
    expect(() => v.validate({ type: 'FETCH_URL', payload: { title: 't', url: 'https://example.com', content: 'c' } })).toThrow(ValidationError);
  });
});

describe('ManualRecordValidator — ByteStatsPayload fields (PBI 2026-10-21-02)', () => {
  const v = new ManualRecordValidator();
  const base = { title: 't', url: 'https://example.com', content: 'c' };

  it('accepts valid byte-stat fields on all three manual types', () => {
    const payload = {
      ...base,
      pageBytes: 1024,
      candidateBytes: 512,
      originalBytes: 400,
      cleansedBytes: 350,
      aiSummaryOriginalBytes: 300,
      aiSummaryCleansedBytes: 250,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'ads',
      aiSummaryCleansedReasons: ['ads'],
      fallbackTriggered: false,
      fallbackReason: 'none',
    };
    for (const type of ['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD']) {
      expect(() => v.validate({ type, payload }), `${type} should accept byte stats`).not.toThrow();
    }
  });

  it('rejects a negative or fractional byte field', () => {
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { ...base, pageBytes: -1 } })).toThrow(ValidationError);
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { ...base, pageBytes: 1.5 } })).toThrow(ValidationError);
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { ...base, pageBytes: '1024' } })).toThrow(ValidationError);
  });

  it('rejects a byte field above MAX_BYTE_STAT_BYTES', () => {
    expect(() =>
      v.validate({ type: 'SAVE_RECORD', payload: { ...base, cleansedBytes: MAX_BYTE_STAT_BYTES + 1 } }),
    ).toThrow(ValidationError);
  });

  it('rejects aiSummaryCleansedElements above MAX_CLEANSED_ELEMENTS', () => {
    expect(() =>
      v.validate({ type: 'PREVIEW_RECORD', payload: { ...base, aiSummaryCleansedElements: MAX_CLEANSED_ELEMENTS + 1 } }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-boolean fallbackTriggered and a non-string fallbackReason', () => {
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { ...base, fallbackTriggered: 'yes' } })).toThrow(ValidationError);
    expect(() => v.validate({ type: 'MANUAL_RECORD', payload: { ...base, fallbackReason: 5 } })).toThrow(ValidationError);
  });

  it('rejects an over-long aiSummaryCleansedReason and a non-array reasons list', () => {
    expect(() =>
      v.validate({ type: 'MANUAL_RECORD', payload: { ...base, aiSummaryCleansedReason: 'x'.repeat(129) } }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ type: 'MANUAL_RECORD', payload: { ...base, aiSummaryCleansedReasons: 'ads' } }),
    ).toThrow(ValidationError);
  });
});

describe('new singletons', () => {
  it('fetchUrlValidator and manualRecordValidator are instances', () => {
    expect(fetchUrlValidator).toBeInstanceOf(FetchUrlValidator);
    expect(manualRecordValidator).toBeInstanceOf(ManualRecordValidator);
  });
  it('checkDomainValidator and contentCleansingExecutedValidator are instances', () => {
    expect(checkDomainValidator).toBeInstanceOf(CheckDomainValidator);
    expect(contentCleansingExecutedValidator).toBeInstanceOf(ContentCleansingExecutedValidator);
  });
});

describe('CheckDomainValidator', () => {
  const v = new CheckDomainValidator();
  it('accepts CHECK_DOMAIN without payload', () => {
    expect(() => v.validate({ type: 'CHECK_DOMAIN', protocolVersion: 1 })).not.toThrow();
  });
  it('rejects CHECK_DOMAIN with payload', () => {
    expect(() => v.validate({ type: 'CHECK_DOMAIN', payload: {}, protocolVersion: 1 })).toThrow(ValidationError);
  });
  it('rejects wrong type', () => {
    expect(() => v.validate({ type: 'PING', protocolVersion: 1 })).toThrow(ValidationError);
  });
});

describe('ContentCleansingExecutedValidator', () => {
  const v = new ContentCleansingExecutedValidator();
  it('accepts valid payload', () => {
    expect(() =>
      v.validate({ type: 'CONTENT_CLEANSING_EXECUTED', payload: { hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 }, protocolVersion: 1 }),
    ).not.toThrow();
  });
  it('rejects missing field', () => {
    expect(() =>
      v.validate({ type: 'CONTENT_CLEANSING_EXECUTED', payload: { hardStripRemoved: 1, keywordStripRemoved: 2 }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });
  it('rejects non-number', () => {
    expect(() =>
      v.validate({ type: 'CONTENT_CLEANSING_EXECUTED', payload: { hardStripRemoved: '1' as unknown as number, keywordStripRemoved: 2, totalRemoved: 3 }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });
  it('rejects wrong type', () => {
    expect(() => v.validate({ type: 'CHECK_DOMAIN', payload: { hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 } })).toThrow(ValidationError);
  });
});

describe('TestObsidianValidator — optional-object裁定 (PBI 2026-10-05-13)', () => {
  const v = new TestObsidianValidator();

  it('accepts a missing payload (stored-settings fallback)', () => {
    expect(() => v.validate({ type: 'TEST_OBSIDIAN', protocolVersion: 1 })).not.toThrow();
  });

  it('accepts an empty object payload', () => {
    expect(() => v.validate({ type: 'TEST_OBSIDIAN', payload: {}, protocolVersion: 1 })).not.toThrow();
  });

  it('accepts form-value payloads', () => {
    expect(() =>
      v.validate({ type: 'TEST_OBSIDIAN', payload: { apiKey: 'k', protocol: 'https', port: '27124', host: '127.0.0.1' }, protocolVersion: 1 }),
    ).not.toThrow();
  });

  it('rejects non-object payloads', () => {
    expect(() => v.validate({ type: 'TEST_OBSIDIAN', payload: 'secret', protocolVersion: 1 })).toThrow(ValidationError);
    expect(() => v.validate({ type: 'TEST_OBSIDIAN', payload: ['k'], protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects wrong type', () => {
    expect(() => v.validate({ type: 'TEST_AI', protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('testObsidianValidator singleton is an instance', () => {
    expect(testObsidianValidator).toBeInstanceOf(TestObsidianValidator);
  });
});

describe('DashboardSqliteValidator — archive subtypes (PBI 2026-09-06-02)', () => {
  const BASE = { type: 'DASHBOARD_SQLITE', protocolVersion: 2 };

  it('archive_preview: accepts a consistent cutoff pair', () => {
    const cutoffDate = '2026-03-31';
    const cutoffMs = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_preview', cutoffDate, cutoffMs, includeDeleted: false } }),
    ).not.toThrow();
  });

  it('archive_preview: rejects a cutoffMs that does not match cutoffDate', () => {
    const cutoffDate = '2026-03-31';
    const cutoffMs = new Date(2026, 3, 30, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_preview', cutoffDate, cutoffMs, includeDeleted: false } }),
    ).toThrow(/cutoffMs does not match cutoffDate/);
  });

  it('archive_preview: rejects a non-existent calendar date', () => {
    const cutoffMs = new Date(2026, 2, 2, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_preview', cutoffDate: '2026-02-30', cutoffMs, includeDeleted: true } }),
    ).toThrow(/Invalid archive cutoff date/);
  });

  it('archive_preview: rejects non-boolean includeDeleted', () => {
    const cutoffDate = '2026-03-31';
    const cutoffMs = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_preview', cutoffDate, cutoffMs, includeDeleted: 'no' } }),
    ).toThrow(/includeDeleted must be boolean/);
  });

  it('archive_create: rejects an over-long yasumaroVersion', () => {
    const cutoffDate = '2026-03-31';
    const cutoffMs = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({
        ...BASE,
        payload: { subtype: 'archive_create', cutoffDate, cutoffMs, includeDeleted: false, yasumaroVersion: 'v'.repeat(65) },
      }),
    ).toThrow(/yasumaroVersion/);
  });

  it('archive_create: accepts a well-formed payload', () => {
    const cutoffDate = '2026-03-31';
    const cutoffMs = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();
    expect(() =>
      dashboardSqliteValidator.validate({
        ...BASE,
        payload: { subtype: 'archive_create', cutoffDate, cutoffMs, includeDeleted: true, yasumaroVersion: '6.7.113' },
      }),
    ).not.toThrow();
  });

  it('archive_delete_by_staging: rejects client-specified non-staging names', () => {
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_delete_by_staging', stagingName: 'yasumaro.db' } }),
    ).toThrow(/stagingName/);
  });

  it('archive_delete_by_staging: accepts a valid staging name', () => {
    const name = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_delete_by_staging', stagingName: name } }),
    ).not.toThrow();
  });

  it('archive_export: rejects client-specified non-staging names', () => {
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_export', stagingName: 'yasumaro.db', offset: 0, length: 1000 } }),
    ).toThrow(/stagingName/);
  });

  it('archive_export: rejects oversized chunk lengths', () => {
    const name = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    expect(() =>
      dashboardSqliteValidator.validate({ ...BASE, payload: { subtype: 'archive_export', stagingName: name, offset: 0, length: 9 * 1024 * 1024 } }),
    ).toThrow(/length/);
  });
});

describe('GenerateReviewSummaryValidator (PBI 2026-10-21-02)', () => {
  const v = new GenerateReviewSummaryValidator();

  it('accepts weekly and monthly', () => {
    expect(() =>
      v.validate({ type: 'GENERATE_REVIEW_SUMMARY', payload: { periodType: 'weekly' }, protocolVersion: 1 }),
    ).not.toThrow();
    expect(() =>
      v.validate({ type: 'GENERATE_REVIEW_SUMMARY', payload: { periodType: 'monthly' }, protocolVersion: 1 }),
    ).not.toThrow();
  });

  it('rejects a periodType outside the contract (was a silent weekly fallback)', () => {
    expect(() =>
      v.validate({ type: 'GENERATE_REVIEW_SUMMARY', payload: { periodType: 'yearly' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ type: 'GENERATE_REVIEW_SUMMARY', payload: {}, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects a missing payload', () => {
    expect(() => v.validate({ type: 'GENERATE_REVIEW_SUMMARY', protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects wrong type', () => {
    expect(() =>
      v.validate({ type: 'PING', payload: { periodType: 'weekly' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('generateReviewSummaryValidator singleton is an instance', () => {
    expect(generateReviewSummaryValidator).toBeInstanceOf(GenerateReviewSummaryValidator);
  });
});

describe('LogForwardValidator (PBI 2026-10-21-02)', () => {
  const v = new LogForwardValidator();

  it('accepts info, warn and error', () => {
    for (const level of ['info', 'warn', 'error']) {
      expect(() =>
        v.validate({ type: 'LOG_FORWARD', payload: { level, message: 'm', source: 'offscreen' }, protocolVersion: 1 }),
        `level ${level} should be valid`,
      ).not.toThrow();
    }
  });

  it('rejects an unknown level (was a silent debug downgrade)', () => {
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'verbose', message: 'm', source: 'offscreen' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: undefined, message: 'm', source: 'offscreen' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects non-string message and source', () => {
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'info', message: 1, source: 'offscreen' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'info', message: 'm', source: 2 }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('accepts optional details and rejects non-object details', () => {
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'info', message: 'm', details: { a: 1 }, source: 'offscreen' }, protocolVersion: 1 }),
    ).not.toThrow();
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'info', message: 'm', details: 'x', source: 'offscreen' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ type: 'LOG_FORWARD', payload: { level: 'info', message: 'm', details: ['x'], source: 'offscreen' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects a missing payload', () => {
    expect(() => v.validate({ type: 'LOG_FORWARD', protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects wrong type', () => {
    expect(() =>
      v.validate({ type: 'PING', payload: { level: 'info', message: 'm', source: 'x' }, protocolVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('logForwardValidator singleton is an instance', () => {
    expect(logForwardValidator).toBeInstanceOf(LogForwardValidator);
  });
});
