/**
 * domainIntelAggregate.ts
 *
 * Pure aggregation for the domain-intel section (PBI 2026-10-23-10).
 * 情報源の偏りと見直し提案: the concentration of reads across the sources the
 * panel fetched, plus exclusion proposals for the loudest ones. The judgment's
 * basis (record count, period, formula) rides every result so the UI shows why
 * a bias was decided instead of asserting one (断定口調にしない).
 *
 * 縮退の出口: a fetch below MIN_RECORDS_FOR_BIAS reports enough=false — the
 * panel shows the reason instead of a bias line built on a handful of rows.
 * Proposals are advisory only (自動除外はしない): applying one is a user
 * action with an undo, never an automatic write.
 */

import { UNKNOWN_DOMAIN_LABEL, type DomainAnalysisAggregation } from './domainAnalysisAggregate.js';

/** Records below this count do not support a share judgment (少件数の縮退). */
export const MIN_RECORDS_FOR_BIAS = 10;

/** A domain whose share reaches this fraction of the fetch becomes a proposal. */
export const NOISE_SHARE_THRESHOLD = 0.5;

/** Proposals shown per intel section (the loudest few, capped). */
export const NOISE_PROPOSAL_MAX = 3;

/** Basis of one bias judgment: the numbers the share was computed from. */
export interface SourceBias {
  /** Total fetched records the judgment is built on. */
  total: number;
  /** Local day range the fetch covered; null = an unbounded endpoint. */
  since: number | null;
  until: number | null;
  /** Loudest domain and its fraction of the total (0-1). */
  topDomain: string | null;
  topShare: number;
  /** Human-readable formula the share was computed with (算出式). */
  formula: string;
  /** False when the fetch is too small to judge (縮退の出口). */
  enough: boolean;
}

/** One exclusion proposal: advisory, applied only by the user. */
export interface NoiseProposal {
  domain: string;
  count: number;
  /** Fraction of the total fetch (0-1) — the proposal's own basis. */
  share: number;
}

/** The local date string a period endpoint maps to (basis display). */
export function periodBasisLabel(
  since: number | null,
  until: number | null,
  format: (ts: number) => string,
): string {
  const from = since !== null ? format(since) : '';
  const to = until !== null ? format(until) : '';
  if (from === '' && to === '') return 'すべての期間';
  if (from === '') return `- ${to}`;
  if (to === '') return `${from} -`;
  return `${from} - ${to}`;
}

/** Share formula text, resolved with the concrete numbers (算出式の表示). */
export function shareFormulaText(topCount: number, total: number): string {
  const percent = total > 0 ? Math.round((topCount / total) * 100) : 0;
  return `上位ドメイン割合(%) = 上位件数 ÷ 総件数 × 100 = ${topCount} ÷ ${total} × 100 = ${percent}%`;
}

/**
 * Concentration judgment for one fetched subset. 縮退の出口: below the
 * minimum the judgment reports enough=false and no share is asserted.
 */
export function computeSourceBias(
  agg: DomainAnalysisAggregation,
  period: { since: number | null; until: number | null },
): SourceBias {
  const enough = agg.totalCount >= MIN_RECORDS_FOR_BIAS;
  const top = agg.domains.find((row) => row.name !== UNKNOWN_DOMAIN_LABEL) ?? null;
  const topShare = top !== null && agg.totalCount > 0 ? top.count / agg.totalCount : 0;
  return {
    total: agg.totalCount,
    since: period.since,
    until: period.until,
    topDomain: enough ? top?.name ?? null : null,
    topShare: enough ? topShare : 0,
    formula: enough ? shareFormulaText(top?.count ?? 0, agg.totalCount) : '',
    enough,
  };
}

/**
 * Exclusion proposals for the loudest domains. Advisory only: the caller
 * must never apply them without a user action (自動除外はしない).
 */
export function buildNoiseProposals(agg: DomainAnalysisAggregation): NoiseProposal[] {
  if (agg.totalCount < MIN_RECORDS_FOR_BIAS) return [];
  return agg.domains
    .filter((row) => row.name !== UNKNOWN_DOMAIN_LABEL)
    .map((row) => ({ domain: row.name, count: row.count, share: row.count / agg.totalCount }))
    .filter((p) => p.share >= NOISE_SHARE_THRESHOLD)
    .slice(0, NOISE_PROPOSAL_MAX);
}
