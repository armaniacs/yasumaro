/**
 * mergeTrustDatabase.ts
 * CAS-safe merge of locally-mutated Trust Database state onto the
 * database currently in storage.
 *
 * withOptimisticLock passes the current stored value to the updateFn. A
 * writer that ignores it and returns its own captured snapshot silently
 * discards any delta another writer committed in between (CAS degrades to
 * last-writer-wins, VULN-029 / CWE-362). This helper takes `current` as
 * the base and overlays only the fields this writer owns.
 *
 * Operation-aware merge (PBI 2026-10-18-06): a pure union cannot express a
 * removal. A writer that deleted an entry from a user-editable list had that
 * deletion resurrected on every save (the union re-added the element the
 * stored base still held), so the removed domain kept being recorded and the
 * user's un-trust decision was permanently reversed. The kernel records
 * pending add/remove intents (`TrustDbListOp`) while mutating its in-memory
 * lists; for a list with intents this merge applies those intents in order
 * to the stored base, so concurrent deltas from other writers survive while
 * this writer's removals take effect. Lists without intents keep the union
 * contract (concurrent additions from both writers survive).
 */

import type { TrustDatabase } from './trustDbSchema.js';

/**
 * User-editable list a pending operation targets. Presets are bulk data and
 * are never locally edited through the managed lists, so they carry no
 * intents and keep the union merge.
 */
export type TrustDbListName = 'userTlds' | 'userBlacklist' | 'whitelist';

/**
 * A pending user operation the kernel recorded before saving. `item` is the
 * value as stored in the list (normalized on add, raw on remove).
 */
export interface TrustDbListOp {
  list: TrustDbListName;
  kind: 'add' | 'remove';
  item: string;
}

function union(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

/**
 * Apply add/remove intents in order to the stored base. Add is a set union
 * (skips an existing entry) and remove drops every occurrence, so both are
 * idempotent: re-running the updater after a CAS conflict never double-applies
 * an intent. Concurrent deltas already committed to the base survive because
 * the intents operate on the base, not on the writer's snapshot.
 */
function applyListOps(base: readonly string[] | undefined, ops: readonly TrustDbListOp[]): string[] {
  let items = [...(base ?? [])];
  for (const op of ops) {
    if (op.kind === 'add') {
      if (!items.includes(op.item)) items.push(op.item);
    } else {
      items = items.filter((entry) => entry !== op.item);
    }
  }
  return items;
}

function mergeList(
  list: TrustDbListName,
  currentItems: readonly string[] | undefined,
  localItems: readonly string[] | undefined,
  ops: readonly TrustDbListOp[]
): string[] {
  const listOps = ops.filter((op) => op.list === list);
  if (listOps.length === 0) return union(currentItems, localItems);
  return applyListOps(currentItems, listOps);
}

/**
 * Merge `local` (this writer's intended state) onto `current` (the value
 * just read from storage inside the CAS critical section), applying the
 * writer's pending `ops` in order.
 *
 * Never mutates any argument; always returns a new object.
 */
export function mergeTrustDatabase(
  current: TrustDatabase | undefined,
  local: TrustDatabase,
  ops: readonly TrustDbListOp[] = []
): TrustDatabase {
  // First write for this key: the local snapshot already reflects the
  // pending intents, so there is nothing to merge against.
  if (!current) {
    return structuredClone(local);
  }

  // Tranco data and the bloom filter are bulk-replaced snapshots, not
  // incremental lists: keep whichever side was updated more recently.
  const localNewer =
    Date.parse(local.lastUpdated || '') >= Date.parse(current.lastUpdated || '');
  const trancoSource = localNewer ? local : current;

  return {
    version: local.version,
    lastUpdated: localNewer ? local.lastUpdated : current.lastUpdated,
    tranco: structuredClone(trancoSource.tranco),
    bloomFilter: structuredClone(trancoSource.bloomFilter),
    jpAnchor: {
      tlds: local.jpAnchor?.tlds ?? [],
      userTlds: mergeList('userTlds', current.jpAnchor?.userTlds, local.jpAnchor?.userTlds, ops),
    },
    sensitive: {
      presets: {
        finance: union(current.sensitive.presets.finance, local.sensitive.presets.finance),
        gaming: union(current.sensitive.presets.gaming, local.sensitive.presets.gaming),
        sns: union(current.sensitive.presets.sns, local.sensitive.presets.sns),
      },
      userBlacklist: mergeList(
        'userBlacklist',
        current.sensitive.userBlacklist,
        local.sensitive.userBlacklist,
        ops
      ),
      whitelist: mergeList('whitelist', current.sensitive.whitelist, local.sensitive.whitelist, ops),
    },
  };
}
