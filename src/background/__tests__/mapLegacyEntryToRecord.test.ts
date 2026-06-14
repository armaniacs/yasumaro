import { describe, it, expect } from 'vitest';
import { mapLegacyEntryToRecord } from '../migrationService.js';

describe('mapLegacyEntryToRecord', () => {
  it('maps url and timestamp to the SQLite record', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://example.com', timestamp: 1700000000000 });
    expect(record.url).toBe('https://example.com');
    expect(record.created_at).toBe(1700000000000);
  });

  it('maps aiSummary to summary', () => {
    const record = mapLegacyEntryToRecord({
      url: 'https://e.com', timestamp: 1, aiSummary: 'a concise summary',
    });
    expect(record.summary).toBe('a concise summary');
  });

  it('joins the tags array into a comma-separated string', () => {
    const record = mapLegacyEntryToRecord({
      url: 'https://e.com', timestamp: 1, tags: ['IT・プログラミング', 'インフラ'],
    });
    expect(record.tags).toBe('IT・プログラミング, インフラ');
  });

  it('leaves summary and tags null when the legacy entry has none', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1 });
    expect(record.summary).toBeNull();
    expect(record.tags).toBeNull();
  });

  it('treats an empty tags array as null', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1, tags: [] });
    expect(record.tags).toBeNull();
  });

  it('leaves domain null so the SQLite layer derives it from the url', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com/x', timestamp: 1 });
    expect(record.domain).toBeNull();
  });

  it('defaults is_starred and is_deleted to 0', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1 });
    expect(record.is_starred).toBe(0);
    expect(record.is_deleted).toBe(0);
  });
});
