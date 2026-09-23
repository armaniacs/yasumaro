/**
 * domainAnalysisAggregate unit tests: domain/URL grouping, null-domain
 * bucket, deterministic tie order, top-N truncation, defensive blank URL.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateDomainAnalysis,
  DOMAIN_ANALYSIS_TOP_N,
  UNKNOWN_DOMAIN_LABEL,
  type DomainAnalysisInput,
} from '../../../domainAnalysisAggregate.js';

function row(domain: string | null, url: string | null): DomainAnalysisInput {
  return { domain, url };
}

describe('aggregateDomainAnalysis — grouping', () => {
  it('counts records per domain and per URL, sorted desc by count', () => {
    const agg = aggregateDomainAnalysis([
      row('a.com', 'https://a.com/1'),
      row('a.com', 'https://a.com/2'),
      row('b.com', 'https://b.com/1'),
    ]);
    expect(agg.totalCount).toBe(3);
    expect(agg.domains).toEqual([
      { name: 'a.com', count: 2 },
      { name: 'b.com', count: 1 },
    ]);
    expect(agg.urls).toEqual([
      { name: 'https://a.com/1', count: 1 },
      { name: 'https://a.com/2', count: 1 },
      { name: 'https://b.com/1', count: 1 },
    ]);
    expect(agg.domainTotal).toBe(2);
    expect(agg.urlTotal).toBe(3);
    expect(agg.domainsTruncated).toBe(false);
    expect(agg.urlsTruncated).toBe(false);
    expect(agg.unknownDomainCount).toBe(0);
  });

  it('keeps full-hostname granularity (no eTLD+1 rollup)', () => {
    const agg = aggregateDomainAnalysis([
      row('www.example.com', 'https://www.example.com/a'),
      row('example.com', 'https://example.com/b'),
    ]);
    expect(agg.domains).toHaveLength(2);
    expect(agg.domainTotal).toBe(2);
  });

  it('groups null and blank domains under the unknown bucket with a count', () => {
    const agg = aggregateDomainAnalysis([
      row(null, 'https://a.com/1'),
      row('  ', 'https://a.com/2'),
      row('a.com', 'https://a.com/3'),
    ]);
    expect(agg.unknownDomainCount).toBe(2);
    expect(agg.domains).toEqual([
      { name: UNKNOWN_DOMAIN_LABEL, count: 2 },
      { name: 'a.com', count: 1 },
    ]);
    expect(agg.domainTotal).toBe(2);
  });

  it('skips blank urls from the URL ranking but keeps the record in totals', () => {
    const agg = aggregateDomainAnalysis([row('a.com', '   '), row('a.com', null)]);
    expect(agg.totalCount).toBe(2);
    expect(agg.domains).toEqual([{ name: 'a.com', count: 2 }]);
    expect(agg.urls).toEqual([]);
    expect(agg.urlTotal).toBe(0);
  });

  it('returns empty rankings for empty input', () => {
    const agg = aggregateDomainAnalysis([]);
    expect(agg.domains).toEqual([]);
    expect(agg.urls).toEqual([]);
    expect(agg.totalCount).toBe(0);
    expect(agg.unknownDomainCount).toBe(0);
    expect(agg.domainsTruncated).toBe(false);
    expect(agg.urlsTruncated).toBe(false);
  });
});

describe('aggregateDomainAnalysis — ordering and truncation', () => {
  it('breaks count ties by name ascending, deterministically', () => {
    const input = [
      row('c.com', 'https://c.com/1'),
      row('a.com', 'https://a.com/1'),
      row('b.com', 'https://b.com/1'),
    ];
    const first = aggregateDomainAnalysis(input);
    const second = aggregateDomainAnalysis([...input].reverse());
    expect(first.domains.map((r) => r.name)).toEqual(['a.com', 'b.com', 'c.com']);
    expect(second.domains.map((r) => r.name)).toEqual(first.domains.map((r) => r.name));
    expect(first.urls.map((r) => r.name)).toEqual([
      'https://a.com/1',
      'https://b.com/1',
      'https://c.com/1',
    ]);
  });

  it('truncates both tables to top N independently and flags it', () => {
    const topN = 3;
    const input: DomainAnalysisInput[] = [];
    for (let i = 0; i < 5; i++) {
      // b.com gets 4 records, a.com 3, and the rest 1 each.
      const count = i === 0 ? 4 : i === 1 ? 3 : 1;
      for (let j = 0; j < count; j++) {
        input.push(row(`d${i}.com`, `https://d${i}.com/${j}`));
      }
    }
    const agg = aggregateDomainAnalysis(input, topN);
    expect(agg.domains.map((r) => r.name)).toEqual(['d0.com', 'd1.com', 'd2.com']);
    expect(agg.domainsTruncated).toBe(true);
    expect(agg.domainTotal).toBe(5);
    // 10 records spread over 10 distinct URLs: truncated to 3 as well.
    expect(agg.urls).toHaveLength(topN);
    expect(agg.urlsTruncated).toBe(true);
    expect(agg.urlTotal).toBe(10);
  });

  it('uses the default top N of 20', () => {
    expect(DOMAIN_ANALYSIS_TOP_N).toBe(20);
    const input: DomainAnalysisInput[] = [];
    for (let i = 0; i < 25; i++) {
      input.push(row(`d${i}.com`, `https://d${i}.com/`));
    }
    const agg = aggregateDomainAnalysis(input);
    expect(agg.domains).toHaveLength(20);
    expect(agg.domainsTruncated).toBe(true);
    expect(agg.urls).toHaveLength(20);
    expect(agg.urlsTruncated).toBe(true);
  });
});
