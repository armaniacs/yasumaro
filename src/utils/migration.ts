/**
 * migration.ts
 * Data migration functions for uBlock format rules (old to lightweight format).
 *
 * Old format (v2.2.4 and earlier):
 * { blockRules: [{domain, options, ...}], exceptionRules: [{domain, options, ...}], metadata }
 *
 * New lightweight format (v2.2.5+):
 * { blockDomains: ['domain1', 'domain2', ...], exceptionDomains: ['domain1', 'domain2', ...], metadata }
 */

interface OldRule {
  domain: string;
  options?: any;
  [key: string]: any;
}

interface OldFormat {
  blockRules?: OldRule[];
  exceptionRules?: OldRule[];
  metadata?: any;
  // Potentially already migrated keys
  blockDomains?: string[];
  exceptionDomains?: string[];
}

interface NewFormat {
  blockDomains: string[];
  exceptionDomains: string[];
  metadata: {
    importedAt: number;
    ruleCount: number;
    migrated: true;
    [key: string]: any;
  };
}

/**
 * Migrate old format uBlock rules to new lightweight format.
 * @param {OldFormat} oldRules - Old format {blockRules, exceptionRules, metadata}
 * @returns {OldFormat | NewFormat} - New format {blockDomains, exceptionDomains, metadata} or oldRules if already migrated
 */
export function migrateToLightweightFormat(oldRules: OldFormat): OldFormat | NewFormat {
  // Check that new format exists AND old format does NOT exist
  // This avoids incorrectly detecting a mixed object as already migrated
  if (oldRules.blockDomains && oldRules.exceptionDomains &&
    !oldRules.blockRules && !oldRules.exceptionRules) {
    return oldRules;
  }

  // Filter out rules without domain property before mapping
  const blockDomains = (oldRules.blockRules || [])
    .filter(r => r.domain)
    .map(r => r.domain);
  const exceptionDomains = (oldRules.exceptionRules || [])
    .filter(r => r.domain)
    .map(r => r.domain);

  return {
    blockDomains,
    exceptionDomains,
    metadata: {
      ...(oldRules.metadata || {}),
      importedAt: oldRules.metadata?.importedAt || Date.now(),
      ruleCount: blockDomains.length + exceptionDomains.length,
      migrated: true
    }
  };
}

/**
 * Migrate uBlock settings in storage to new lightweight format.
 * @returns {Promise<boolean>} - true if migration was performed, false otherwise
 */
export async function migrateUblockSettings(): Promise<boolean> {
  // Use hardcoded key to avoid dynamic import in Service Worker context
  const UBLOCK_RULES_KEY = 'ublock_rules';

  const result = await chrome.storage.local.get([UBLOCK_RULES_KEY]);
  const ublockRules = result[UBLOCK_RULES_KEY] as OldFormat;

  // If already in new format (and NOT in old format) or no data exists, nothing to do
  if (!ublockRules ||
    (ublockRules.blockDomains && ublockRules.exceptionDomains && !ublockRules.blockRules && !ublockRules.exceptionRules)) {
    return false;
  }

  // Perform migration
  const newRules = migrateToLightweightFormat(ublockRules);
  await chrome.storage.local.set({ [UBLOCK_RULES_KEY]: newRules });

  return true;
}