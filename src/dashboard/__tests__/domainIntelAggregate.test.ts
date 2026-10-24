/**
 * domainIntelAggregate.test.ts
 * PBI 2026-10-23-10 — 情報源の偏りと見直し提案.
 * Pins: the share formula (算出式), the advisory proposal conditions
 * (自動除外はしない), the few-records 縮退, and the unknown-bucket exclusion.
 */
import { describe, it, expect } from 'vitest';
import { aggregateDomainAnalysis } from '../domainAnalysisAggregate.js';
import {
  buildNoiseProposals,
  computeSourceBias,
  MIN_RECORDS_FOR_BIAS,
  NOISE_PROPOSAL_MAX,
  NOISE_SHARE_THRESHOLD,
  periodBasisLabel,
  shareFormulaText,
  sharePercent,
  sharePercentOf,
} from '../domainIntelAggregate.js';

function makeAgg(counts: Record<string, number>, total?: number): ReturnType<typeof aggregateDomainAnalysis> {
  const rows = Object.entries(counts).flatMap(([domain, n]) =>
    Array.from({ length: n }, (_, i) => ({ domain, url: `https://${domain}/p${i}` })),
  );
  const agg = aggregateDomainAnalysis(rows);
  return { ...agg, totalCount: total ?? agg.totalCount };
}

describe('computeSourceBias — 偏り判定 (件数・期間・算出式の根拠表示)', () => {
  it('computes the top domain share with the formula basis', () => {
    const agg = makeAgg({ 'a.example': 60, 'b.example': 40 });
    const bias = computeSourceBias(agg, { since: 1000, until: 2000 });
    expect(bias.enough).toBe(true);
    expect(bias.total).toBe(100);
    expect(bias.topDomain).toBe('a.example');
    expect(bias.topShare).toBeCloseTo(0.6);
    // 算出式が根拠として載る (断定口調にしない).
    expect(bias.formula).toContain('上位ドメイン割合(%)');
    expect(bias.formula).toContain('60');
  });

  it('degrades below the minimum record count (少件数の縮退)', () => {
    const agg = makeAgg({ 'a.example': 3, 'b.example': 2 });
    const bias = computeSourceBias(agg, { since: 1000, until: 2000 });
    expect(MIN_RECORDS_FOR_BIAS).toBe(10);
    expect(bias.enough).toBe(false);
    expect(bias.topDomain).toBeNull();
    expect(bias.formula).toBe('');
  });

  it('skips the unknown bucket from the top judgment', () => {
    const agg = makeAgg({ 'a.example': 60, 'b.example': 40 });
    const withUnknown = { ...agg, domains: [{ name: '(unknown)', count: 200 }, ...agg.domains] };
    const bias = computeSourceBias(withUnknown, { since: null, until: null });
    expect(bias.topDomain).toBe('a.example');
  });
});

describe('shareFormulaText + periodBasisLabel (根拠の表示)', () => {
  it('states the concrete numbers in the formula', () => {
    const text = shareFormulaText(60, 100);
    expect(text).toContain('= 60 ÷ 100 × 100 = 60%');
  });

  it('labels unbounded period endpoints honestly', () => {
    const fmt = (ts: number) => new Date(ts).toISOString().slice(0, 10);
    expect(periodBasisLabel(0, 1000, fmt)).toContain(' - ');
    expect(periodBasisLabel(null, null, fmt)).toBe('すべての期間');
    expect(periodBasisLabel(0, null, fmt)).toBe('1970-01-01 -');
  });
});

describe('sharePercent + sharePercentOf — rounding boundary table (Math.round unchanged)', () => {
  it.each([
    [0, 0],
    [1, 100],
    [0.6, 60],
    [0.024, 2],
    [0.025, 3],
    [0.124, 12],
    [0.125, 13],
    [0.605, 61],
  ])('rounds share %f to %i percent', (share, expected) => {
    expect(sharePercent(share)).toBe(expected);
  });

  it.each([
    [60, 100, 60],
    [1, 40, 3],
    [1, 80, 1],
    [0, 100, 0],
    [0, 0, 0],
    [5, 0, 0],
  ])('computes part %i of total %i as %i percent', (part, total, expected) => {
    expect(sharePercentOf(part, total)).toBe(expected);
  });

  it('matches the legacy inline Math.round expression on boundary shares', () => {
    const shares = [0, 0.024, 0.025, 0.124, 0.125, 0.6, 0.605, 1];
    for (const share of shares) {
      expect(sharePercent(share)).toBe(Math.round(share * 100));
    }
  });
});

describe('buildNoiseProposals — 見直し提案 (自動除外はしない)', () => {
  it('proposes only the domains above the share threshold', () => {
    const agg = makeAgg({ 'a.example': 60, 'b.example': 25, 'c.example': 15 });
    const proposals = buildNoiseProposals(agg);
    expect(NOISE_SHARE_THRESHOLD).toBe(0.5);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.domain).toBe('a.example');
    expect(proposals[0]?.share).toBeCloseTo(0.6);
  });

  it('returns no proposals below the minimum record count', () => {
    const agg = makeAgg({ 'a.example': 5, 'b.example': 2 });
    expect(buildNoiseProposals(agg)).toEqual([]);
  });

  it('caps the proposal count', () => {
    const agg = makeAgg({
      'a.example': 40,
      'b.example': 30,
      'c.example': 30,
      'd.example': 20,
    });
    const proposals = buildNoiseProposals(agg);
    expect(NOISE_PROPOSAL_MAX).toBe(3);
    expect(proposals.length).toBeLessThanOrEqual(NOISE_PROPOSAL_MAX);
  });
});
