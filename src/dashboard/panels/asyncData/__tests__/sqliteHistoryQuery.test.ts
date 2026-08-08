/**
 * sqliteHistoryQuery.test.ts
 *
 * sqliteHistoryPanel のクロージャから切り出した純関数のテスト。
 * DBモックも jsdom も使わず、引数と戻り値だけで検証できることが要点。
 */
import { describe, it, expect } from 'vitest';
import {
  buildEnrichmentKey,
  enrichEntryWithChromeStorage,
  filterRowsByTag,
  dateRangeFromSelectedDate,
} from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';
import type { SavedUrlEntry } from '../../../../utils/storageUrls.js';

function makeEntry(over: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com/a',
    title: 'A',
    created_at: 1_700_000_000_000,
    ...over,
  } as BrowsingLogEntry;
}

describe('buildEnrichmentKey', () => {
  it('URLと分単位に丸めた時刻でキーを作る', () => {
    expect(buildEnrichmentKey('https://example.com', 120_000)).toBe('https://example.com|2');
  });

  it('同じ分内の異なるミリ秒は同一キーになる', () => {
    const a = buildEnrichmentKey('https://example.com', 120_000);
    const b = buildEnrichmentKey('https://example.com', 179_999);
    expect(a).toBe(b);
  });

  it('分をまたぐと別キーになる', () => {
    const a = buildEnrichmentKey('https://example.com', 179_999);
    const b = buildEnrichmentKey('https://example.com', 180_000);
    expect(a).not.toBe(b);
  });
});

describe('enrichEntryWithChromeStorage', () => {
  it('診断メタデータが既にある場合は補完せず同一参照を返す', () => {
    const entry = makeEntry({ sent_tokens: 100 });
    const result = enrichEntryWithChromeStorage(entry, new Map());
    expect(result).toBe(entry);
  });

  it('storage側に対応エントリが無ければ同一参照を返す', () => {
    const entry = makeEntry();
    const result = enrichEntryWithChromeStorage(entry, new Map());
    expect(result).toBe(entry);
  });

  it('対応エントリがあれば欠けている項目を補完する', () => {
    const entry = makeEntry({ created_at: 120_000 });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        sentTokens: 42,
        aiProvider: 'gemini',
        fallbackTriggered: true,
      } as SavedUrlEntry],
    ]);

    const result = enrichEntryWithChromeStorage(entry, map);
    expect(result).not.toBe(entry);
    expect(result.sent_tokens).toBe(42);
    expect(result.ai_provider).toBe('gemini');
    expect(result.fallback_triggered).toBe(1);
  });

  it('SQLite側の値がstorage側より優先される', () => {
    // ai_provider だけ埋まっていると早期returnするため、
    // 早期returnの対象外である ai_model で優先順位を検証する
    const entry = makeEntry({ created_at: 120_000, ai_model: 'sqlite-model' });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        aiModel: 'storage-model',
      } as SavedUrlEntry],
    ]);

    expect(enrichEntryWithChromeStorage(entry, map).ai_model).toBe('sqlite-model');
  });

  it('fallbackTriggeredがfalseなら0になる', () => {
    const entry = makeEntry({ created_at: 120_000 });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        fallbackTriggered: false,
      } as SavedUrlEntry],
    ]);

    expect(enrichEntryWithChromeStorage(entry, map).fallback_triggered).toBe(0);
  });
});

describe('filterRowsByTag', () => {
  it('カンマ区切りタグの部分一致で絞り込む', () => {
    const rows = [
      makeEntry({ id: 1, tags: 'typescript,testing' }),
      makeEntry({ id: 2, tags: 'rust' }),
      makeEntry({ id: 3, tags: 'test' }),
    ];
    expect(filterRowsByTag(rows, 'test').map(r => r.id)).toEqual([1, 3]);
  });

  it('タグ前後の空白を無視する', () => {
    const rows = [makeEntry({ id: 1, tags: 'a, spaced ,b' })];
    expect(filterRowsByTag(rows, 'spaced')).toHaveLength(1);
  });

  it('tagsが未設定の行は除外する', () => {
    const rows = [makeEntry({ id: 1 }), makeEntry({ id: 2, tags: '' })];
    expect(filterRowsByTag(rows, 'x')).toEqual([]);
  });

  it('一致が無ければ空配列を返す', () => {
    const rows = [makeEntry({ tags: 'a,b' })];
    expect(filterRowsByTag(rows, 'zzz')).toEqual([]);
  });
});

describe('dateRangeFromSelectedDate', () => {
  it('未選択なら空オブジェクト（全期間）を返す', () => {
    expect(dateRangeFromSelectedDate(null)).toEqual({});
  });

  it('選択日をその日1日分のrangeに変換する', () => {
    const range = dateRangeFromSelectedDate('2026-08-08');
    const start = new Date('2026-08-08T00:00:00').getTime();
    expect(range.since).toBe(start);
    expect(range.until).toBe(start + 86_400_000 - 1);
  });

  it('untilはその日の終わりで、翌日の開始と重ならない', () => {
    const day = dateRangeFromSelectedDate('2026-08-08');
    const next = dateRangeFromSelectedDate('2026-08-09');
    expect(day.until! + 1).toBe(next.since!);
  });
});
