/**
 * trustDbRepair.ts
 * Pure repair function for TrustDatabase — extracted from TrustDb.repairDatabase
 * to make the 15-field补完 testable and avoid in-place mutation + partial save races.
 *
 * Previously: TrustDb.repairDatabase(db: Record<string,unknown>) mutated the same
 * object and wasRepaired was derived via JSON.stringify before/after. On
 * bloomFilter corrupt, bloomFilterFromData threw after wasRepaired→save() had
 * already persisted a half-repaired DB.
 *
 * Now: pure function `repairTrustDatabase(db) -> TrustDatabase` returns a new
 * object. Caller decides to persist once.
 */

import { DB_VERSION } from './trustDbVersion.js';
import { JP_ANCHOR_TLDS } from './presets.js';

const JP_ANCHOR_TLDS_PRESET = [...JP_ANCHOR_TLDS] as readonly string[];

export function repairTrustDatabase(input: Record<string, unknown>): Record<string, unknown> {
  // Shallow clone top level to avoid mutating the caller's object
  const db: Record<string, unknown> = { ...input };

  // Top-level
  if (!db.version) db.version = DB_VERSION;
  if (!db.lastUpdated) db.lastUpdated = new Date().toISOString();

  // jpAnchor
  const jpAnchor = { ...((db.jpAnchor ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  if (!Array.isArray(jpAnchor.tlds)) jpAnchor.tlds = [...JP_ANCHOR_TLDS_PRESET];
  if (!Array.isArray(jpAnchor.userTlds)) jpAnchor.userTlds = [];
  db.jpAnchor = jpAnchor;

  // sensitive — presets
  const sensitive = { ...((db.sensitive ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const presets = { ...((sensitive.presets ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  if (!Array.isArray(presets.finance)) presets.finance = [];
  if (!Array.isArray(presets.gaming)) presets.gaming = [];
  if (!Array.isArray(presets.sns)) presets.sns = [];
  sensitive.presets = presets;
  if (!Array.isArray(sensitive.userBlacklist)) sensitive.userBlacklist = [];
  if (!Array.isArray(sensitive.whitelist)) sensitive.whitelist = [];
  db.sensitive = sensitive;

  // tranco
  const tranco = { ...((db.tranco ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  if (!tranco.tier) tranco.tier = 'top10k';
  if (!Array.isArray(tranco.domains)) tranco.domains = [];
  if (typeof tranco.count !== 'number') tranco.count = (tranco.domains as unknown[]).length;
  if (typeof tranco.sizeBytes !== 'number') tranco.sizeBytes = 0;
  db.tranco = tranco;

  // bloomFilter — if missing or not an object, caller will rebuild via presets
  // Keep existing if present; do not mutate here — bloomFilterFromData will throw
  // on corrupt data and caller can then rebuild.
  // We ensure the key exists as an object at least to avoid undefined downstream
  if (!db.bloomFilter || typeof db.bloomFilter !== 'object') {
    // Leave as undefined so caller can detect and rebuild; do not fabricate empty
  }

  return db;
}

export function needsRepair(original: Record<string, unknown>, repaired: Record<string, unknown>): boolean {
  return JSON.stringify(original) !== JSON.stringify(repaired);
}
