import type { UblockRules } from './types.js';
/**
 * Context information for rule evaluation.
 */
export interface UblockMatcherContext {
    currentDomain?: string;
    isThirdParty?: boolean;
}
/**
 * Determine if a URL is blocked by the provided uBlock rules.
 * 軽量化版: Setベースの高速マッチング対応
 * @param {string} url - The URL to evaluate.
 * @param {UblockRules} ublockRules - 軽量化版ルールセットまたは旧形式
 * @param {UblockMatcherContext} [context={}] - Optional matching context (軽量版では未使用).
 * @returns {Promise<boolean>} - true if the URL is blocked, false otherwise.
 */
export declare function isUrlBlocked(url: string, ublockRules: UblockRules, context?: UblockMatcherContext): Promise<boolean>;
//# sourceMappingURL=ublockMatcher.d.ts.map