import { describe, it, expect } from 'vitest';
import { mergeRecord, readHistoryFile, formatHistoryFile, shouldSkipRecord } from '../updateHistory.mjs';

describe('mergeRecord', () => {
  it('appends a new record to an empty list', () => {
    const record = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0' };
    const result = mergeRecord([], record);
    expect(result).toEqual([record]);
  });

  it('appends a new record and sorts by date ascending', () => {
    const older = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0' };
    const newer = { tag: 'v2.0.0', date: '2026-02-01T00:00:00+09:00', version: '2.0.0' };
    const result = mergeRecord([newer], older);
    expect(result).toEqual([older, newer]);
  });

  it('overwrites an existing record with the same tag', () => {
    const original = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0', linesOfCode: 100 };
    const updated = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0', linesOfCode: 200 };
    const result = mergeRecord([original], updated);
    expect(result).toEqual([updated]);
  });
});

describe('readHistoryFile', () => {
  it('parses an existing history JSON string', () => {
    const content = JSON.stringify({ records: [{ tag: 'v1.0.0' }] });
    expect(readHistoryFile(content)).toEqual([{ tag: 'v1.0.0' }]);
  });

  it('returns an empty array when content is undefined (file does not exist yet)', () => {
    expect(readHistoryFile(undefined)).toEqual([]);
  });
});

describe('formatHistoryFile', () => {
  it('wraps records in a { records: [...] } object, pretty-printed', () => {
    const records = [{ tag: 'v1.0.0' }];
    const result = formatHistoryFile(records);
    expect(JSON.parse(result)).toEqual({ records });
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('shouldSkipRecord', () => {
  it('returns true when the record is null', () => {
    expect(shouldSkipRecord(null)).toBe(true);
  });

  it('returns false when the record is a valid object', () => {
    expect(shouldSkipRecord({ tag: 'v1.0.0' })).toBe(false);
  });
});
