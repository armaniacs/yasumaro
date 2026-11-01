import { sanitizeFtsTerm } from './schema.js';

export type ClauseOp = 'and' | 'or';

export function buildSafeFtsClauseQuery(terms: string[], op: ClauseOp): string {
  const joiner = op === 'or' ? ' OR ' : ' AND ';
  const phrases = terms.flatMap((term) => {
    const bare = sanitizeFtsTerm(term);
    return bare === '' ? [] : [`"${bare}"`];
  });
  return phrases.join(joiner);
}
