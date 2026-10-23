/**
 * webhookExportPayload.test.ts
 * PBI 2026-10-22-05 ― 最小Webhookエクスポート.
 * Pins: the minimal payload (要約・タグ・URLのみ・raw contentなし), the
 * transfer-condition table (転送条件), the https-only fail-closed gate
 * (未宣言origin/非httpsは遮断), and the persisted post-cleansing summary only.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWebhookExportPayload,
  isWebhookUrlAllowed,
  matchesWebhookExportCondition,
  normalizeWebhookExportTags,
  webhookUrlOrigin,
  type WebhookExportRecord,
} from '../webhookExportPayload.js';

function makeRecord(overrides: Partial<WebhookExportRecord> = {}): WebhookExportRecord {
  return {
    id: 'r1',
    title: 'Example',
    url: 'https://example.com/p1',
    summary: 'cleansed summary',
    tags: 'obsidian,web',
    ...overrides,
  };
}

describe('buildWebhookExportPayload (最小ペイロード: 要約・タグ・URLのみ)', () => {
  it('builds 要約・タグ・URL without raw page content', () => {
    const payload = buildWebhookExportPayload(makeRecord());
    expect(payload?.text).toContain('https://example.com/p1');
    expect(payload?.text).toContain('cleansed summary');
    expect(payload?.tags).toEqual(['obsidian', 'web']);
    expect(Object.keys(payload ?? {})).not.toContain('content');
  });

  it('drops empty fields instead of carrying placeholders', () => {
    const payload = buildWebhookExportPayload(makeRecord({ summary: undefined, tags: undefined }));
    expect(payload?.summary).toBeUndefined();
    expect(payload?.tags).toBeUndefined();
  });

  it('returns null for an empty url (縮退の出口)', () => {
    expect(buildWebhookExportPayload(makeRecord({ url: '' }))).toBeNull();
  });
});

describe('matchesWebhookExportCondition (転送条件: タグ/エンゲージメント)', () => {
  it('matches a tag with the leading # stripped', () => {
    expect(matchesWebhookExportCondition(makeRecord(), { tag: '#obsidian' })).toBe(true);
    expect(matchesWebhookExportCondition(makeRecord(), { tag: 'missing' })).toBe(false);
  });

  it('fails closed when the record has no tags but a tag is required', () => {
    expect(matchesWebhookExportCondition(makeRecord({ tags: undefined }), { tag: 'obsidian' })).toBe(false);
  });

  it('applies the engagement thresholds', () => {
    const record = makeRecord();
    expect(matchesWebhookExportCondition(record, { minScrollDepth: 50 }, { scrollDepth: 80 })).toBe(true);
    expect(matchesWebhookExportCondition(record, { minScrollDepth: 50 }, { scrollDepth: 20 })).toBe(false);
    expect(matchesWebhookExportCondition(record, { minVisitDuration: 30 }, { visitDuration: 10 })).toBe(false);
    // 縮退の出口: an absent engagement never passes a set threshold.
    expect(matchesWebhookExportCondition(record, { minScrollDepth: 50 }, {})).toBe(false);
  });
});

describe('isWebhookUrlAllowed (未宣言origin/非httpsは遮断)', () => {
  it('allows only https destinations', () => {
    expect(isWebhookUrlAllowed('https://hooks.example.com/abc')).toBe(true);
    expect(isWebhookUrlAllowed('http://hooks.example.com/abc')).toBe(false);
    expect(isWebhookUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isWebhookUrlAllowed('')).toBe(false);
    expect(isWebhookUrlAllowed('not a url')).toBe(false);
  });

  it('returns the origin for the permission grant, null on unknown shapes', () => {
    expect(webhookUrlOrigin('https://hooks.example.com/abc')).toBe('https://hooks.example.com');
    expect(webhookUrlOrigin('')).toBeNull();
  });
});

describe('normalizeWebhookExportTags (stored shape normalization)', () => {
  it('normalizes both the CSV string and list shapes', () => {
    expect(normalizeWebhookExportTags('a, b,,c')).toEqual(['a', 'b', 'c']);
    expect(normalizeWebhookExportTags(['a', ' b ', '', 'c'])).toEqual(['a', 'b', 'c']);
    expect(normalizeWebhookExportTags(undefined)).toEqual([]);
  });
});
