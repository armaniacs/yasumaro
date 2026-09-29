/**
 * searchExecution.ts
 * Single owner of the search execution skeleton, shared by both SQL backends.
 *
 * handleSearchFts / handleSearchLike were the same six steps with only the
 * statement builder and the tag-filter path ('fts' / 'like') differing, so a
 * params-order / tag+text / deleted-filter fix had to be applied twice — and
 * IdbVfsBackend.query carried a third copy of the same steps. This module owns
 * the whole skeleton: extra-where build, tag-filter select, order-clause apply,
 * statement build, count exec, rows exec, row collection — and callers pass the
 * discriminated input plus the two policies that genuinely differ per backend.
 *
 * SQL text assembly stays in queryPlan.ts (builders, read-only here).
 *
 * What is NOT unified, and why:
 * - Row shape. `engine.query` hands the worker named rows and hands the IDB
 *   host positional values, so each backend supplies its own `SearchRowSource`
 *   over the same skeleton. Reading named rows positionally would make the
 *   mapping depend on the driver's key order.
 * - Invalid-order policy. 'coerce' (normalize to DESC) on the worker,
 *   'error' (fail closed) on the host — the host rejects before it gets here,
 *   so it must keep the stricter clause builder. See buildSearchOrderClause.
 * - Filter qualification. The FTS statements join `browsing_logs AS b`, so
 *   filter columns need a `b.` prefix there and must not have one on the
 *   unaliased LIKE path. `per-path` qualifies the FTS projection only; `none`
 *   leaves both unqualified, which is what the worker has always emitted.
 */

import {
  buildExtraWhereSql,
  buildLikePattern,
  buildSearchOrderClause,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  selectTagFilter,
  type ExtraWhereQuery,
  type InvalidOrderPolicy,
} from './queryPlan.js';
import type { SqliteValue } from './sqliteEngine.js';

/**
 * Discriminated search input. The `path` + `searchInput: string` pair this
 * replaced carried two meanings in one field (built MATCH query for fts, raw
 * term for like) distinguished only by prose — a raw term passed with path
 * 'fts' typechecked and misqueried silently. Folding `path` into the union
 * makes the wrong combination unrepresentable: fts accepts only
 * `buildFtsMatchQuery` output, like accepts only the raw term
 * (`buildLikePattern` is applied at the single union-consumption point).
 */
export type SearchInput =
  | { path: 'fts'; ftsQuery: string }
  | { path: 'like'; rawTerm: string };

/** Whether the filter columns carry the FTS join alias, per backend. */
export type ExtraQualification = 'per-path' | 'none';

/**
 * The two engine-specific halves of a search: how to run a statement and get
 * its rows back, and how to read one of those rows. `TRow` is the backend's
 * raw row (`SqliteRow` on the worker, `SqliteValue[]` on the host) and `TOut`
 * the decoded row it returns.
 */
export interface SearchRowSource<TRow, TOut> {
  run(sql: string, params: SqliteValue[], onRow: (row: TRow) => void): Promise<void>;
  /** The single scalar of a COUNT row. */
  count(row: TRow): number;
  decode(row: TRow): TOut;
}

export interface RunSearchArgs<TRow, TOut> {
  reader: SearchRowSource<TRow, TOut>;
  input: SearchInput;
  /** Filter fields plus the tag; text/paging are already resolved by the caller. */
  query: ExtraWhereQuery & { tag?: string | undefined };
  limit: number;
  offset: number;
  orderBy?: string | undefined;
  orderDir?: string | undefined;
  onInvalid: InvalidOrderPolicy;
  extraQualification: ExtraQualification;
  /** Engine capability, not per-path: the LIKE path downgrades it itself. */
  fts5Available: boolean;
}

export async function runSearch<TRow, TOut>(
  args: RunSearchArgs<TRow, TOut>,
): Promise<{ rows: TOut[]; total: number }> {
  const { reader, input, limit, offset, fts5Available } = args;
  const isFts = input.path === 'fts';

  const extra = buildExtraWhereSql(args.query, {
    qualified: args.extraQualification === 'per-path' && isFts,
  });
  const tagFilter = args.query.tag
    ? selectTagFilter(args.query.tag, input.path, fts5Available)
    : null;
  const { orderClause } = buildSearchOrderClause(
    { orderBy: args.orderBy, orderDir: args.orderDir },
    { fts: isFts, onInvalid: args.onInvalid },
  );

  const stmts = input.path === 'fts'
    ? buildFtsSearchStatements(extra, { ftsQuery: input.ftsQuery, orderClause, limit, offset, tagFilter })
    : buildLikeSearchStatements(extra, {
        likePattern: buildLikePattern(input.rawTerm),
        orderClause,
        limit,
        offset,
        tagFilter,
      });

  let total = 0;
  await reader.run(stmts.countSql, stmts.countParams, (row) => { total = reader.count(row); });

  const rows: TOut[] = [];
  await reader.run(stmts.rowsSql, stmts.rowsParams, (row) => { rows.push(reader.decode(row)); });

  return { rows, total };
}
