/**
 * ruleLabelMessages.test.ts
 *
 * Verifies the locale files actually carry a label for every cleansing rule.
 * `buildRuleLabelMap` has a Japanese fallback, so a missing message would not
 * surface in unit tests — but it would leave the English UI showing a raw key
 * such as "popup". Reading the real message files is the only way to catch it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLEANSING_RULE_KEYS } from '../rules.js';
import { ruleMessageKey } from '../ruleLabels.js';

const LOCALES = ['ja', 'en'] as const;

function loadMessages(locale: string): Record<string, { message: string }> {
  const path = resolve(process.cwd(), 'public/_locales', locale, 'messages.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('rule label messages', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      const messages = loadMessages(locale);

      it('defines a message for every cleansing rule', () => {
        const missing = CLEANSING_RULE_KEYS.filter(key => !messages[ruleMessageKey(key)]);
        expect(missing, `missing ${locale} labels`).toEqual([]);
      });

      it('gives every rule a non-empty label', () => {
        for (const key of CLEANSING_RULE_KEYS) {
          const entry = messages[ruleMessageKey(key)];
          expect(entry?.message?.trim(), `${locale}: ${key}`).toBeTruthy();
        }
      });

      it('still defines the multiple/none reasons', () => {
        expect(messages.historyAiSummaryCleansedReasonMultiple?.message).toBeTruthy();
        expect(messages.historyAiSummaryCleansedReasonNone?.message).toBeTruthy();
      });
    });
  }

  it('uses distinct labels per rule within a locale', () => {
    // Copy-paste when adding a rule would otherwise show two rules the same way.
    for (const locale of LOCALES) {
      const messages = loadMessages(locale);
      const labels = CLEANSING_RULE_KEYS.map(k => messages[ruleMessageKey(k)]?.message);
      expect(new Set(labels).size, `${locale} has duplicate labels`).toBe(labels.length);
    }
  });
});
