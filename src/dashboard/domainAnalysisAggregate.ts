/**
 * domainAnalysisAggregate.ts
 * Pure aggregation for the domain-analysis panel (PBI 2026-09-24-03).
 *
 * Groups fetched rows by the stored `domain` and by the raw `url`, ranking
 * both by record count. The `domain` column holds a full hostname as written
 * by extractHostname (www. stripped only — no eTLD+1 rollup; that is a
 * future extension per the PBI). Tag+period narrowing happens at query time
 * (tagFilter + since/until), so this module only sees the fetched subset.
 *
 * Null/blank-domain rows are kept in the ranking as an UNKNOWN_DOMAIN_LABEL
 * bucket instead of being dropped, and their count is reported separately for
 * the UI notice.
 */

/** Minimal row shape the aggregation reads (subset of BrowsingLogEntry). */
export interface DomainAnalysisInput {
  domain?: string | null;
  url?: string | null;
}

export interface DomainAnalysisRankRow {
  name: string;
  count: number;
}

/** Rows shown per ranking table (both tables truncate independently). */
export const DOMAIN_ANALYSIS_TOP_N = 20;

/** Bucket key for rows with a null/blank domain. */
export const UNKNOWN_DOMAIN_LABEL = '(unknown)';

export interface DomainAnalysisAggregation {
  domains: DomainAnalysisRankRow[];
  urls: DomainAnalysisRankRow[];
  totalCount: number;
  /** Distinct domains (including the unknown bucket) before top-N truncation. */
  domainTotal: number;
  /** Distinct URLs before top-N truncation. */
  urlTotal: number;
  domainsTruncated: boolean;
  urlsTruncated: boolean;
  /** Records with a null/blank domain — they form the unknown bucket. */
  unknownDomainCount: number;
}

interface Counter {
  count: number;
}

function toRanked(
  map: Map<string, Counter>,
  topN: number,
): { rows: DomainAnalysisRankRow[]; truncated: boolean } {
  const all: DomainAnalysisRankRow[] = [...map.entries()].map(([name, acc]) => ({
    name,
    count: acc.count,
  }));
  // WHY: equal counts are common on real corpora — count desc then name asc
  // keeps the order deterministic across reruns instead of input-order
  // dependent (Map iteration order).
  all.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { rows: all.slice(0, topN), truncated: all.length > topN };
}

export function aggregateDomainAnalysis(
  rows: readonly DomainAnalysisInput[],
  topN: number = DOMAIN_ANALYSIS_TOP_N,
): DomainAnalysisAggregation {
  const domains = new Map<string, Counter>();
  const urls = new Map<string, Counter>();
  let unknownDomainCount = 0;

  for (const row of rows) {
    const domain = row.domain?.trim();
    if (!domain) unknownDomainCount += 1;
    const domainKey = domain ? domain : UNKNOWN_DOMAIN_LABEL;
    const domainAcc = domains.get(domainKey) ?? { count: 0 };
    domainAcc.count += 1;
    domains.set(domainKey, domainAcc);

    // WHY: url is NOT NULL in the schema, so the blank guard is defensive
    // only — a blank url has no stable identity and is skipped from the URL
    // ranking (the record still counts toward its domain and the total).
    const url = row.url?.trim();
    if (url) {
      const urlAcc = urls.get(url) ?? { count: 0 };
      urlAcc.count += 1;
      urls.set(url, urlAcc);
    }
  }

  const domainRanked = toRanked(domains, topN);
  const urlRanked = toRanked(urls, topN);

  return {
    domains: domainRanked.rows,
    urls: urlRanked.rows,
    totalCount: rows.length,
    domainTotal: domains.size,
    urlTotal: urls.size,
    domainsTruncated: domainRanked.truncated,
    urlsTruncated: urlRanked.truncated,
    unknownDomainCount,
  };
}
