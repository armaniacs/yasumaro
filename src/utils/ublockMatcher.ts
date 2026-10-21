// ublockMatcher.ts
// Implements URL block checking based on uBlock Origin filter rules.
// This module is used by domainUtils.js to extend domain filtering with uBlock rules.

import { extractDomain, matchesPattern } from './domainUtils.js';
import { logWarn } from './logger/api.js';
import type { UblockRules } from './types.js';

/**
 * uBlock ルールオプションの型定義
 * evaluateOptions で使用されるプロパティを明示的に定義
 */
interface UblockRuleOptions {
  domains?: string[];
  negatedDomains?: string[];
  thirdParty?: boolean;
  firstParty?: boolean;
}

interface RuleWithDomain {
  domain: string;
  options: UblockRuleOptions;
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
   * Place normalized rules into the wildcard list or the exact-domain map
   * (UF-302 index construction). The single loop behind all four rule sets
   * (legacy/new × block/exception), so wildcard and map handling cannot
   * drift. The built index is unchanged.
   */
  private indexRules(
    entries: RuleWithDomain[],
    wildcardRules: RuleWithDomain[],
    byDomain: Map<string, RuleWithDomain[]>,
  ): void {
    for (const entry of entries) {
      if (entry.domain.includes('*')) {
        wildcardRules.push(entry);
      } else {
        if (!byDomain.has(entry.domain)) {
          byDomain.set(entry.domain, []);
        }
        byDomain.get(entry.domain)!.push(entry);
      }
    }
  }

  /**
   * Build indices from rule sets.
   * @param {UblockRules} ublockRules - 軽量化版ルールセット（ドメイン配列）または旧形式
   */
  buildIndex(ublockRules: UblockRules) {
    // 【修正】: 移行前の元のルールを直接使用する
    const rules = ublockRules;

    // 【優先度設定】: 新しい軽量形式（blockDomains）が存在する場合は、古い形式（blockRules）を処理しない。
    // PBI 2026-09-12-08: 両形式が混在する store（移行残骸）では旧形式が無警告で無視されて
    // いたため、最低限の観測可能性として警告を残す。挙動（優先規則）自体は意図的に不変。
    const hasBlockDomains = rules.blockDomains && rules.blockDomains.length > 0;
    const shouldProcessBlockRules = !hasBlockDomains && rules.blockRules;
    if (hasBlockDomains && rules.blockRules && rules.blockRules.length > 0) {
      logWarn(
        'UblockRules carry both legacy blockRules and blockDomains — legacy rules are ignored by design',
        { blockRules: rules.blockRules.length, blockDomains: rules.blockDomains.length },
        undefined,
        'ublockMatcher'
      );
    }

    if (shouldProcessBlockRules && rules.blockRules) {
      // Handle blockRules (old format): skip entries without a domain,
      // defaulting the rule options the same way as before.
      this.indexRules(
        rules.blockRules
          .filter((rule) => rule.domain)
          .map((rule) => ({ domain: rule.domain, options: (rule.options || {}) as UblockRuleOptions })),
        this.wildcardBlockRules,
        this.blockRulesByDomain,
      );
    }

    // Handle blockDomains (new lightweight format)
    if (rules.blockDomains) {
      this.indexRules(
        rules.blockDomains.map((domain) => ({ domain, options: {} })),
        this.wildcardBlockRules,
        this.blockRulesByDomain,
      );
    }

    // 【優先度設定】: 例外ルールについても同様の優先度設定
    const hasExceptionDomains = rules.exceptionDomains && rules.exceptionDomains.length > 0;
    const shouldProcessExceptionRules = !hasExceptionDomains && rules.exceptionRules;
    if (hasExceptionDomains && rules.exceptionRules && rules.exceptionRules.length > 0) {
      logWarn(
        'UblockRules carry both legacy exceptionRules and exceptionDomains — legacy rules are ignored by design',
        { exceptionRules: rules.exceptionRules.length, exceptionDomains: rules.exceptionDomains.length },
        undefined,
        'ublockMatcher'
      );
    }

    if (shouldProcessExceptionRules && rules.exceptionRules) {
      // Handle exceptionRules (old format)
      this.indexRules(
        rules.exceptionRules
          .filter((rule) => rule.domain)
          .map((rule) => ({ domain: rule.domain, options: (rule.options || {}) as UblockRuleOptions })),
        this.wildcardExceptionRules,
        this.exceptionRulesByDomain,
      );
    }

    // Handle exceptionDomains (new lightweight format)
    if (rules.exceptionDomains) {
      this.indexRules(
        rules.exceptionDomains.map((domain) => ({ domain, options: {} })),
        this.wildcardExceptionRules,
        this.exceptionRulesByDomain,
      );
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
 * @returns {boolean} - true if the URL is blocked, false otherwise.
 */
export function isUrlBlocked(url: string, ublockRules: UblockRules, context: UblockMatcherContext = {}): boolean {
  // Guard against invalid input – safe fallback to not block.
  if (typeof url !== 'string' || !url) {
    return false;
  }

  const domain = extractDomain(url);
  if (!domain) {
    return false;
  }

  // Get or create rule index for performance (UF-302 optimization)
  let index = RULE_INDEX_CACHE.get(ublockRules);
  if (!index) {
    index = new RuleIndex(ublockRules);
    RULE_INDEX_CACHE.set(ublockRules, index);
  }

  // Perform matching with context
  const result = index.checkDomain(domain, context);
  return result.isBlocked;
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

  // $~domain=example.com|other.com – skip the rule when currentDomain matches any
  // of the list: the listed domains are excluded from this rule, not blocked by it.
  if (opts.negatedDomains && Array.isArray(opts.negatedDomains) && opts.negatedDomains.length > 0) {
    if (!context.currentDomain) return false;
    const isExcludedDomain = opts.negatedDomains.some((d: string) => matchesPattern(context.currentDomain!, d));
    if (isExcludedDomain) return false;
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
