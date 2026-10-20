/**
 * rowCapNotice.ts
 * The one fetch-cap notice publisher for the dashboard panels.
 *
 * WHY shared: queryLogs caps every fetch, so a period holding more rows than
 * the cap analyzes a prefix, and every capped panel has to say so with the
 * same substitution map. The publisher previously lived inside the SVG
 * cluster renderer (the wrong home for a notice seam) while four panels
 * still hand-wired their own copy, which is where the 'cap' vs 'rowCap'
 * notice-key drift came from (PBI 2026-10-20-17). The notice scope key
 * `rowCap` is owned here, so the panels cannot disagree about it; only the
 * message key and the fallback tail differ per panel.
 */

import { getMessageWithSubstitutions } from '../../utils/i18n.js';
import type { PanelNotices } from './PanelNotices.js';

export interface RowCapNoticeOptions {
  /** Notice scope owning the panel's registered `rowCap` element. */
  notices: PanelNotices;
  messageKey: string;
  /** Panel-specific tail wording, used when the key has no translation. */
  fallback: string;
  /** Rows this fetch actually returned. */
  shown?: number;
  /** Rows the period holds in total. */
  total?: number;
  /** The fetch limit that was hit. */
  limit: number;
}

/**
 * Publishes the fetch-cap notice under the shared `rowCap` notice scope
 * key. `shown` / `total` stay optional: panels that page a whole window
 * (fetchAllPeriodRows) never learn the period total, and an absent key
 * rides as no substitution instead of an undefined-valued one (the
 * key-omission convention fetchPeriodRows already states).
 */
export function showRowCapNotice(options: RowCapNoticeOptions): void {
  const substitutions: Record<string, string | number> = { max: options.limit };
  if (options.shown !== undefined) substitutions.shown = options.shown;
  if (options.total !== undefined) substitutions.total = options.total;
  options.notices.setMessage(
    'rowCap',
    getMessageWithSubstitutions(options.messageKey, substitutions, options.fallback),
  );
  options.notices.show('rowCap');
}
