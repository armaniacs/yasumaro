import { localDayRangeFromDateString } from '../../../utils/localDate.js';
import type { CollectionQueryV2 } from './savedCollectionQuery.js';

/** mergeClauseResults is owned by the V2 shape module (background-safe import); re-exported here so existing dashboard import paths keep working. */
export { mergeClauseResults } from '../../../utils/collectionQueryV2.js';

export interface ClauseStorageQuery {
  text?: string;
  tagFilter?: string;
  dateFrom?: number;
  dateTo?: number;
}

export function resolveCollectionQueries(query: CollectionQueryV2): ClauseStorageQuery[] {
  return query.clauses.map((clause) => {
    const out: ClauseStorageQuery = {};
    if (clause.search !== '') out.text = clause.search;
    if (clause.tag !== null) out.tagFilter = clause.tag;
    if (clause.date !== null) {
      const range = localDayRangeFromDateString(clause.date);
      out.dateFrom = range.since;
      out.dateTo = range.until;
    }
    return out;
  });
}
