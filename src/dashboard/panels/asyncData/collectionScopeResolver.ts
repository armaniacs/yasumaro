import { localDayRangeFromDateString } from '../../../utils/localDate.js';
import type { CollectionQueryV2 } from './savedCollectionQuery.js';

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

export function mergeClauseResults(idSets: number[][], op: 'and' | 'or'): number[] {
  if (idSets.length === 0) return [];
  if (op === 'or') {
    return [...new Set(idSets.flat())].sort((a, b) => a - b);
  }
  const first = new Set(idSets[0]);
  for (const s of idSets.slice(1)) {
    for (const id of [...first]) {
      if (!s.includes(id)) first.delete(id);
    }
  }
  return [...first].sort((a, b) => a - b);
}
