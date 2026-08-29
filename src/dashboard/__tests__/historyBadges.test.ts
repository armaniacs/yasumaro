// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { makeRecordTypeBadge, makeMaskBadge, makeCleansedBadge, makePrivacyModeBadge } from '../historyBadges.js';

const mockGetMessage = vi.hoisted(() => vi.fn((key: string) => key));
vi.mock('../../utils/i18n.js', () => ({
  getMessage: (...args: any[]) => mockGetMessage(...args),
}));

vi.mock('../../utils/i18nPlural.js', () => ({
  getPluralKey: (prefix: string, count: number) => `${prefix}_${count}`,
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

  it('uses fallback text when getMessage returns empty string', () => {
    mockGetMessage.mockReturnValueOnce('').mockReturnValueOnce('');
    const badge = makeRecordTypeBadge('manual');
    expect(badge.textContent).toBe('手動');
    mockGetMessage.mockReturnValueOnce('').mockReturnValueOnce('');
    const badge2 = makeRecordTypeBadge('auto');
    expect(badge2.textContent).toBe('自動');
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

  it('falls back to default label when getMessage returns empty', () => {
    mockGetMessage.mockReturnValue('');
    const badge = makeMaskBadge(3);
    expect(badge?.textContent).toBe('🔒 3');
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

  it('returns null for unknown cleansedReason', () => {
    expect(makeCleansedBadge('unknown' as any)).toBeNull();
  });
});

describe('makePrivacyModeBadge', () => {
  it('returns null for undefined mode', () => {
    expect(makePrivacyModeBadge(undefined)).toBeNull();
  });

  it('returns null for unknown mode', () => {
    expect(makePrivacyModeBadge('unknown')).toBeNull();
  });

  it('creates badge for known modes', () => {
    for (const mode of ['local_only', 'full_pipeline', 'masked_cloud', 'cloud_only']) {
      const badge = makePrivacyModeBadge(mode);
      expect(badge).not.toBeNull();
      expect(badge?.className).toContain('history-badge-privacy-mode');
    }
  });

  it('falls back to mode string when getMessage returns empty', () => {
    mockGetMessage.mockReturnValue('');
    const badge = makePrivacyModeBadge('local_only');
    expect(badge?.textContent).toBe('local_only');
  });
});
