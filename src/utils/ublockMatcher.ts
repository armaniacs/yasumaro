// ublockMatcher.ts
// Implements URL block checking based on uBlock Origin filter rules.
// This module is used by domainUtils.js to extend domain filtering with uBlock rules.

import { extractDomain, matchesPattern } from './domainUtils.js';
import type { UblockRules, UblockRule } from './types.js';

interface RuleWithDomain {
  domain: string;
  options: Record<string, any>;
}

/**
 * Rule index for fast lookup (UF-302 performance optimization).
 * 軽量化版: ドメイン配列のみを使用したSetベースの高速マッチング
 */
class RuleIndex {
  blockRulesByDomain: Map<string, RuleWithDomain[]>;
  exceptionRulesByDomain: Map<string, RuleWithDomain[]>;
  wildcardBlockRules: RuleWithDomain[];
  wildcardExceptionRules: RuleWithDomain[];

  constructor(ublockRules: UblockRules) {
    this.blockRulesByDomain = new Map();
    this.exceptionRulesByDomain = new Map();
    this.wildcardBlockRules = [];
    this.wildcardExceptionRules = [];

    this.buildIndex(ublockRules);
  }

  /**
   * Build indices from rule sets.
   * @param {UblockRules} ublockRules - 軽量化版ルールセット（ドメイン配列）または旧形式
   */
  buildIndex(ublockRules: UblockRules) {
    // 【修正】: 移行前の元のルールを直接使用する
    const rules = ublockRules;

    // 【優先度設定】: 新しい軽量形式（blockDomains）が存在する場合は、古い形式（blockRules）を処理しない
    const hasBlockDomains = rules.blockDomains && rules.blockDomains.length > 0;
    const shouldProcessBlockRules = !hasBlockDomains && rules.blockRules;

    if (shouldProcessBlockRules && rules.blockRules) {
      // Handle blockRules (old format)
      for (const rule of rules.blockRules) {
        if (!rule.domain) continue;
        // Normalize to RuleWithDomain
        const ruleObj: RuleWithDomain = {
          domain: rule.domain,
          options: rule.options || {}
        };

        if (rule.domain.includes('*')) {
          this.wildcardBlockRules.push(ruleObj);
        } else {
          if (!this.blockRulesByDomain.has(rule.domain)) {
            this.blockRulesByDomain.set(rule.domain, []);
          }
          this.blockRulesByDomain.get(rule.domain)!.push(ruleObj);
        }
      }
    }

    // Handle blockDomains (new lightweight format)
    if (rules.blockDomains) {
      for (const domain of rules.blockDomains) {
        if (domain.includes('*')) {
          this.wildcardBlockRules.push({ domain, options: {} });
        } else {
          if (!this.blockRulesByDomain.has(domain)) {
            this.blockRulesByDomain.set(domain, []);
          }
          this.blockRulesByDomain.get(domain)!.push({ domain, options: {} });
        }
      }
    }

    // 【優先度設定】: 例外ルールについても同様の優先度設定
    const hasExceptionDomains = rules.exceptionDomains && rules.exceptionDomains.length > 0;
    const shouldProcessExceptionRules = !hasExceptionDomains && rules.exceptionRules;

    if (shouldProcessExceptionRules && rules.exceptionRules) {
      // Handle exceptionRules (old format)
      for (const rule of rules.exceptionRules) {
        if (!rule.domain) continue;
        const ruleObj: RuleWithDomain = {
          domain: rule.domain,
          options: rule.options || {}
        };

        if (rule.domain.includes('*')) {
          this.wildcardExceptionRules.push(ruleObj);
        } else {
          if (!this.exceptionRulesByDomain.has(rule.domain)) {
            this.exceptionRulesByDomain.set(rule.domain, []);
          }
          this.exceptionRulesByDomain.get(rule.domain)!.push(ruleObj);
        }
      }
    }

    // Handle exceptionDomains (new lightweight format)
    if (rules.exceptionDomains) {
      for (const domain of rules.exceptionDomains) {
        if (domain.includes('*')) {
          this.wildcardExceptionRules.push({ domain, options: {} });
        } else {
          if (!this.exceptionRulesByDomain.has(domain)) {
            this.exceptionRulesByDomain.set(domain, []);
          }
          this.exceptionRulesByDomain.get(domain)!.push({ domain, options: {} });
        }
      }
    }
  }

  /**
   * Check if domain is blocked (fast Set lookup + wildcard check).
   * @param {string} domain - The domain to check.
   * @param {UblockMatcherContext} context
   * @returns {Object} - { isBlocked, isException }
   */
  checkDomain(domain: string, context: UblockMatcherContext): { isBlocked: boolean; isException: boolean } {
    // 例外チェック（優先）
    const exactExceptions = this.exceptionRulesByDomain.get(domain) || [];
    for (const rule of exactExceptions) {
      if (evaluateOptions(rule, context)) {
        return { isBlocked: false, isException: true };
      }
    }
    for (const rule of this.wildcardExceptionRules) {
      if (matchesPattern(domain, rule.domain) && evaluateOptions(rule, context)) {
        return { isBlocked: false, isException: true };
      }
    }

    // ブロックチェック
    const exactBlocks = this.blockRulesByDomain.get(domain) || [];
    for (const rule of exactBlocks) {
      if (evaluateOptions(rule, context)) {
        return { isBlocked: true, isException: false };
      }
    }
    for (const rule of this.wildcardBlockRules) {
      if (matchesPattern(domain, rule.domain) && evaluateOptions(rule, context)) {
        return { isBlocked: true, isException: false };
      }
    }

    return { isBlocked: false, isException: false };
  }
}

// Global index cache for performance (WeakMap for automatic cleanup)
const RULE_INDEX_CACHE = new WeakMap<object, RuleIndex>();

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
export async function isUrlBlocked(url: string, ublockRules: UblockRules, context: UblockMatcherContext = {}): Promise<boolean> {
  // Guard against invalid input – safe fallback to not block.
  if (typeof url !== 'string' || !url) {
    return false;
  }

  const domain = extractDomain(url);
  if (!domain) {
    return false;
  }

  // Get or create rule index for performance (UF-302 optimization)
  // Cast to object to use WeakMap key
  const rulesObj = ublockRules as object;
  let index = RULE_INDEX_CACHE.get(rulesObj);
  if (!index) {
    index = new RuleIndex(ublockRules);
    RULE_INDEX_CACHE.set(rulesObj, index);
  }

  // Perform matching with context
  const result = index.checkDomain(domain, context);
  return result.isBlocked;
}

/**
 * Evaluate a single rule against a domain.
 * @param {string} urlDomain - Domain extracted from the URL.
 * @param {RuleWithDomain} rule - A rule object produced by ublockParser.js.
 * @param {UblockMatcherContext} context - Matching context.
 * @returns {boolean} - true if the rule matches the URL.
 */
function matchRule(urlDomain: string, rule: RuleWithDomain, context: UblockMatcherContext): boolean {
  // Basic domain pattern match (supports wildcards via matchesPattern).
  if (!matchesPattern(urlDomain, rule.domain)) {
    return false;
  }

  // Evaluate optional rule options if present.
  if (rule.options && Object.keys(rule.options).length > 0) {
    return evaluateOptions(rule, context);
  }

  // No options → rule matches.
  return true;
}

/**
 * Evaluate rule options such as $domain, $~domain, $3p, $1p, $important.
 * The implementation covers the most common options required for UF‑103.
 * @param {RuleWithDomain} rule - Rule object with an `options` field.
 * @param {UblockMatcherContext} context - Matching context.
 * @returns {boolean} - true if all specified options are satisfied.
 */
function evaluateOptions(rule: RuleWithDomain, context: UblockMatcherContext): boolean {
  const opts = rule.options;
  if (!opts) return true; // No options means rule matches domain.
  // $domain=example.com|other.com – allow only when currentDomain matches one of the list.
  if (opts.domains && Array.isArray(opts.domains) && opts.domains.length > 0) {
    if (!context.currentDomain) return false;
    const allowed = opts.domains.some((d: string) => matchesPattern(context.currentDomain!, d));
    if (!allowed) return false;
  }

  // $~domain=example.com|other.com – block when currentDomain matches any of the list.
  if (opts.negatedDomains && Array.isArray(opts.negatedDomains) && opts.negatedDomains.length > 0) {
    if (!context.currentDomain) return false;
    const blocked = opts.negatedDomains.some((d: string) => matchesPattern(context.currentDomain!, d));
    if (blocked) return false;
  }

  // $3p – only match when request is third‑party.
  if (opts.thirdParty) {
    if (!context.isThirdParty) return false;
  }

  // $1p – only match when request is first‑party.
  if (opts.firstParty) {
    if (context.isThirdParty) return false;
  }

  return true;
}
