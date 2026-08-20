import { describe, it, expect } from 'vitest';
import {
  ServiceWorkerRequestValidator,
  ValidVisitValidator,
  DashboardSqliteValidator,
  FetchUrlValidator,
  ManualRecordValidator,
  CheckDomainValidator,
  ContentCleansingExecutedValidator,
  ValidationError,
  serviceWorkerRequestValidator,
  validVisitValidator,
  dashboardSqliteValidator,
  fetchUrlValidator,
  manualRecordValidator,
  checkDomainValidator,
  contentCleansingExecutedValidator,
} from '../validators.js';

describe('MessageValidator interface', () => {
  it('singletons are instances of correct classes', () => {
    expect(serviceWorkerRequestValidator).toBeInstanceOf(ServiceWorkerRequestValidator);
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

describe('ServiceWorkerRequestValidator', () => {
  const v = new ServiceWorkerRequestValidator();

  it('accepts valid VALID_VISIT message', () => {
    const msg = { type: 'VALID_VISIT', payload: { content: 'hello' }, protocolVersion: 1 };
    expect(() => v.validate(msg)).not.toThrow();
  });

  it('rejects unknown type', () => {
    expect(() => v.validate({ type: 'UNKNOWN', payload: {} })).toThrow(ValidationError);
  });

  it('rejects missing payload for types requiring it', () => {
    expect(() => v.validate({ type: 'VALID_VISIT', protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('accepts NO_PAYLOAD type without payload', () => {
    expect(() => v.validate({ type: 'PING', protocolVersion: 1 })).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => v.validate(null)).toThrow(ValidationError);
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
      { subtype: 'confirm_token' },
      { subtype: 'query' },
      { subtype: 'search', query: 'q' },
      { subtype: 'toggle_star', id: 1 },
      { subtype: 'delete', id: 1 },
      { subtype: 'update', id: 1, changes: {} },
      { subtype: 'migrate' },
      { subtype: 'opfs_spike' },
      { subtype: 'clear_all' },
      { subtype: 'get_count' },
      { subtype: 'status' },
      { subtype: 'cleanup_legacy' },
      { subtype: 'backfill_metadata' },
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
