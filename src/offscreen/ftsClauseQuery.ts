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

export function matchesClausesLike(haystack: string, terms: string[], op: ClauseOp): boolean {
  const needles = terms.map((t) => sanitizeFtsTerm(t)).filter((t) => t !== '');
  if (needles.length === 0 || haystack === '') return false;
  const lowered = haystack.toLowerCase();
  if (op === 'or') return needles.some((n) => lowered.includes(n.toLowerCase()));
  return needles.every((n) => lowered.includes(n.toLowerCase()));
}
