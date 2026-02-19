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
    options?: Record<string, unknown>;
    [key: string]: unknown;
}
interface OldFormat {
    blockRules?: OldRule[];
    exceptionRules?: OldRule[];
    metadata?: Record<string, unknown>;
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
        [key: string]: unknown;
    };
}
/**
 * Migrate old format uBlock rules to new lightweight format.
 * @param {OldFormat} oldRules - Old format {blockRules, exceptionRules, metadata}
 * @returns {OldFormat | NewFormat} - New format {blockDomains, exceptionDomains, metadata} or oldRules if already migrated
 */
export declare function migrateToLightweightFormat(oldRules: OldFormat): OldFormat | NewFormat;
/**
 * Migrate uBlock settings in storage to new lightweight format.
 * @returns {Promise<boolean>} - true if migration was performed, false otherwise
 */
export declare function migrateUblockSettings(): Promise<boolean>;
export {};
//# sourceMappingURL=migration.d.ts.map