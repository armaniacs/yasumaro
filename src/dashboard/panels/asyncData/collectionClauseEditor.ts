import { serializeClausesQuery, parseCollectionQueryV2, type CollectionQueryV2 } from './savedCollectionQuery.js';

export interface EditorClause {
  search: string;
  tag: string | null;
  date: string | null;
}

const EMPTY_ROW: EditorClause = { search: '', tag: null, date: null };

function isEmptyRow(row: EditorClause): boolean {
  return row.search === '' && row.tag === null && row.date === null;
}

export interface ClauseEditor {
  getClauses(): EditorClause[];
  getOp(): 'and' | 'or';
  setOp(op: 'and' | 'or'): void;
  addRow(): void;
  removeRow(index: number): void;
  updateRow(index: number, patch: Partial<EditorClause>): void;
  loadSaved(raw: unknown): void;
  toSavedQuery(): Record<string, unknown>;
}

export function createClauseEditor(): ClauseEditor {
  let rows: EditorClause[] = [{ ...EMPTY_ROW }];
  let op: 'and' | 'or' = 'and';

  return {
    getClauses: () => rows.map((r) => ({ ...r })),
    getOp: () => op,
    setOp: (next) => { op = next; },
    addRow: () => { rows = [...rows, { ...EMPTY_ROW }]; },
    removeRow: (index) => {
      if (rows.length <= 1) {
        rows = [{ ...EMPTY_ROW }];
        return;
      }
      rows = rows.filter((_, i) => i !== index);
    },
    updateRow: (index, patch) => {
      const current = rows[index];
      if (!current) return;
      rows = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    },
    loadSaved: (raw) => {
      const parsed: CollectionQueryV2 = parseCollectionQueryV2(raw);
      op = parsed.op;
      rows = parsed.clauses.length > 0
        ? parsed.clauses.map((c) => ({ search: c.search, tag: c.tag, date: c.date }))
        : [{ ...EMPTY_ROW }];
    },
    toSavedQuery: () => serializeClausesQuery(op, rows.filter((r) => !isEmptyRow(r))),
  };
}
