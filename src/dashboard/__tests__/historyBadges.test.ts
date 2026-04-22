// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { makeRecordTypeBadge, makeMaskBadge, makeCleansedBadge } from '../historyBadges.js';

vi.mock('../popup/i18n.js', () => ({
  getMessage: (key: string) => key,
}));

describe('makeRecordTypeBadge', () => {
  it('creates manual badge', () => {
    const badge = makeRecordTypeBadge('manual');
    expect(badge.className).toContain('history-badge-manual');
  });

  it('creates auto badge by default', () => {
    const badge = makeRecordTypeBadge();
    expect(badge.className).toContain('history-badge-auto');
  });
});

describe('makeMaskBadge', () => {
  it('returns null for undefined count', () => {
    expect(makeMaskBadge(undefined)).toBeNull();
  });

  it('returns null for zero count', () => {
    expect(makeMaskBadge(0)).toBeNull();
  });

  it('creates badge for positive count', () => {
    const badge = makeMaskBadge(5);
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain('history-badge-masked');
  });
});

describe('makeCleansedBadge', () => {
  it('returns null for none', () => {
    expect(makeCleansedBadge('none')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(makeCleansedBadge(undefined)).toBeNull();
  });

  it('creates hard badge', () => {
    const badge = makeCleansedBadge('hard');
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain('history-badge-cleansed');
  });

  it('creates keyword badge', () => {
    const badge = makeCleansedBadge('keyword');
    expect(badge).not.toBeNull();
  });

  it('creates both badge', () => {
    const badge = makeCleansedBadge('both');
    expect(badge).not.toBeNull();
  });
});
