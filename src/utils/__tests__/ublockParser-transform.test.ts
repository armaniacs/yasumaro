/**
 * ublockParser-transform.test.ts
 * uBlock Parser - Transformモジュールのユニットテスト
 */

import {
  buildRuleObject,
  createEmptyRuleset,
  transformParseDomainList
} from '../ublockParser/index.js';

import { parseRuleOptions } from '../ublockParser/options.js';
import type { UblockRule, ParsedUblockRuleset } from '../ublockParser/transform.js';

describe('ublockParser - Transform Module', () => {
  // ============================================================================
  // buildRuleObject
  // ============================================================================

  describe('buildRuleObject', () => {
    test('builds a minimal rule object', () => {
      const rule = buildRuleObject('||example.com^', 'block', 'example.com');
      // 【PBI 2026-10-21-06】: the write-only id field was removed from the
      // intermediate format, so the rule object must not carry an id.
      expect(rule).not.toHaveProperty('id');
      expect(rule).toHaveProperty('domain', 'example.com');
      expect(rule).toHaveProperty('options');
      expect(rule).toHaveProperty('type');
    });

    test('builds a block rule', () => {
      const rule = buildRuleObject('||example.com^', 'block', 'example.com');
      expect(rule.type).toBe('block');
    });

    test('builds an exception rule', () => {
      const rule = buildRuleObject('@@||example.com^', 'exception', 'example.com');
      expect(rule.type).toBe('exception');
    });

    test('builds a rule with options', () => {
      const rule = buildRuleObject('||example.com^$domain=test.com,3p', 'block', 'example.com');
      expect(rule.options.domains).toEqual(['test.com']);
      expect(rule.options.thirdParty).toBe(true);
    });

    test('handles a wildcard domain', () => {
      const rule = buildRuleObject('||*.example.com^', 'block', '*.example.com');
      expect(rule.domain).toBe('*.example.com');
    });
  });

  // ============================================================================
  // createEmptyRuleset
  // ============================================================================

  describe('createEmptyRuleset', () => {
    test('creates an empty ruleset', () => {
      const ruleset: ParsedUblockRuleset = createEmptyRuleset();
      const firstRule: UblockRule | undefined = ruleset.blockRules[0];
      expect(firstRule).toBeUndefined();
      expect(ruleset).toHaveProperty('blockRules');
      expect(ruleset).toHaveProperty('exceptionRules');
      expect(ruleset).toHaveProperty('metadata');
      expect(Array.isArray(ruleset.blockRules)).toBe(true);
      expect(Array.isArray(ruleset.exceptionRules)).toBe(true);
      expect(typeof ruleset.metadata).toBe('object');
    });

    test('creates empty arrays', () => {
      const ruleset = createEmptyRuleset();
      expect(ruleset.blockRules).toHaveLength(0);
      expect(ruleset.exceptionRules).toHaveLength(0);
    });

    test('includes default values in metadata', () => {
      const ruleset = createEmptyRuleset();
      expect(ruleset.metadata).toHaveProperty('source');
      expect(ruleset.metadata).toHaveProperty('importedAt');
      expect(ruleset.metadata).toHaveProperty('lineCount');
      expect(ruleset.metadata).toHaveProperty('ruleCount');
    });

    test('sets metadata ruleCount to 0', () => {
      const ruleset = createEmptyRuleset();
      expect(ruleset.metadata.ruleCount).toBe(0);
    });

    test('holds default values in metadata', () => {
      const ruleset = createEmptyRuleset();
      expect(ruleset.metadata.source).toBeDefined();
      expect(typeof ruleset.metadata.importedAt).toBe('number');
      expect(ruleset.metadata.lineCount).toBe(0);
    });
  });

  // ============================================================================
  // parseDomainList (transformParseDomainList)
  // ============================================================================

  describe('parseDomainList (transform)', () => {
    test('parses a basic pipe-separated domain list', () => {
      const domains = transformParseDomainList('example.com|another.com');
      expect(domains).toEqual(['example.com', 'another.com']);
    });

    test('skips empty segments', () => {
      const domains = transformParseDomainList('example.com||another.com');
      expect(domains).toEqual(['example.com', 'another.com']);
    });

    test('handles an empty string', () => {
      const domains = transformParseDomainList('');
      expect(domains).toEqual([]);
    });

    test('handles null/undefined (with type assertions)', () => {
      // この関数は文字列のみを受け取るが、既存のテストでは型アサーションを使用
      expect(transformParseDomainList(null as never)).toEqual([]);
      expect(transformParseDomainList(undefined as never)).toEqual([]);
    });

    test('parses a list containing wildcard domains', () => {
      const domains = transformParseDomainList('*.example.com|sub.example.com');
      expect(domains).toEqual(['*.example.com', 'sub.example.com']);
    });

    test('trims entries', () => {
      const domains = transformParseDomainList('  example.com  |  another.com  ');
      expect(domains).toEqual(['  example.com  ', '  another.com  ']);
    });

    test('handles many domains', () => {
      const input = Array(1000).fill(0).map((_, i) => `domain${i}.com`).join('|');
      const domains = transformParseDomainList(input);
      expect(domains).toHaveLength(1000);
    });
  });

  // ============================================================================
  // ルールオブジェクトの整合性
  // ============================================================================

  describe('Rule Object Consistency', () => {
    test('builds a rule object without an ID field', () => {
      // 【PBI 2026-10-21-06】: the 32bit-hash id (disguised as a UUID) was removed
      // because it is write-only. The pin asserts the intermediate format carries
      // no id field instead of the former uniqueness pin at lines 186-187.
      const rule = buildRuleObject('||example.com^', 'block', 'example.com');
      expect(rule).not.toHaveProperty('id');
      expect(rule).toHaveProperty('rawLine', '||example.com^');
      expect(rule).toHaveProperty('pattern', 'example.com');
    });
  });
});