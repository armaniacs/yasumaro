/**
 * mergeTrustDatabase.ts
 * CAS-safe merge of a locally-mutated Trust Database snapshot onto the
 * database currently in storage.
 *
 * withOptimisticLock passes the current stored value to the updateFn. A
 * writer that ignores it and returns its own captured snapshot silently
 * discards any delta another writer committed in between (CAS degrades to
 * last-writer-wins, VULN-029 / CWE-362). This helper takes `current` as
 * the base and overlays only the fields this writer owns, unioning the
 * user-editable lists so concurrent additions from both writers survive.
 */

import type { TrustDatabase } from './trustDbSchema.js';

function union(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

/**
 * Merge `local` (this writer's intended state) onto `current` (the value
 * just read from storage inside the CAS critical section).
 *
 * Never mutates either argument; always returns a new object.
 */
export function mergeTrustDatabase(
  current: TrustDatabase | undefined,
  local: TrustDatabase
): TrustDatabase {
  // First write for this key: nothing to merge against.
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
      tlds: local.jpAnchor.tlds,
      userTlds: union(current.jpAnchor.userTlds, local.jpAnchor.userTlds),
    },
    sensitive: {
      presets: {
        finance: union(current.sensitive.presets.finance, local.sensitive.presets.finance),
        gaming: union(current.sensitive.presets.gaming, local.sensitive.presets.gaming),
        sns: union(current.sensitive.presets.sns, local.sensitive.presets.sns),
      },
      userBlacklist: union(current.sensitive.userBlacklist, local.sensitive.userBlacklist),
      whitelist: union(current.sensitive.whitelist, local.sensitive.whitelist),
    },
  };
}
