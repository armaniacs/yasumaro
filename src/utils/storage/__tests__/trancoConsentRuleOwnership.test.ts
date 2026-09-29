/**
 * trancoConsent single-owner contract test (PBI 2026-09-29-38).
 *
 * The 30-day retry rule and the three-key consent delta write had two
 * implementations (popup banner, dashboard panel). They disagreed inside the
 * boundary window, because the dashboard rounded elapsed days up while the
 * popup compared raw milliseconds. `src/utils/storage/trancoConsent.ts` is now
 * the only owner; this scan fails if a caller grows its own copy.
 *
 * Source scan, not a runtime spy: a re-introduced rule is an inline expression
 * inside a view function, and only a static scan sees the arithmetic no test
 * happens to exercise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RULE_OWNER = 'src/utils/storage/trancoConsent.ts';
const CALLERS = ['src/popup/trancoNotification.ts', 'src/dashboard/trancoConsent.ts'];

const projectRoot = resolve(import.meta.dirname, '../../../..');

function readRepoSource(rel: string): string {
  return readFileSync(join(projectRoot, ...rel.split('/')), 'utf8');
}

/** Day-to-millisecond arithmetic, in either operand order: how both copies
 *  computed the retry window. */
const DAY_ARITHMETIC = /\d+\s*\*\s*60\s*\*\s*60\s*\*\s*\d+/;

/** The elapsed-day variable name the old rule implementations used. */
const ELAPSED_DAYS = /\belapsedDays\b/;

/** The deny-reason literal: part of the three-key write, owned by the module. */
const DENY_REASON_LITERAL = /['"]deny['"]/;

const OWNED_BY_RULE_MODULE = [DAY_ARITHMETIC, ELAPSED_DAYS, DENY_REASON_LITERAL];

function findViolations(source: string): string[] {
  return OWNED_BY_RULE_MODULE.filter((pattern) => pattern.test(source)).map((p) => String(p));
}

describe('Tranco consent rule ownership', () => {
  it('keeps the rule and the consent write in one module', () => {
    const owner = readRepoSource(RULE_OWNER);

    expect(owner).toContain('export function evaluateTrancoConsent(');
    expect(owner).toContain('export async function persistTrancoConsentGrant(');
    expect(owner).toContain('export async function persistTrancoConsentDeny(');
    // The owner's own day arithmetic is the point: one copy, not zero.
    expect(DAY_ARITHMETIC.test(owner)).toBe(true);
  });

  it('finds no second rule implementation in the callers', () => {
    for (const caller of CALLERS) {
      expect(findViolations(readRepoSource(caller)), `${caller} must not re-own the rule`).toEqual([]);
    }
  });

  it('makes both callers import the shared module', () => {
    for (const caller of CALLERS) {
      expect(readRepoSource(caller)).toMatch(/utils\/storage\/trancoConsent\.js/);
    }
  });

  it('still flags a caller that re-introduces the rule', () => {
    // A source scan is only a contract if it can fail: feed the detector the
    // exact arithmetic the dashboard used to carry inline.
    const source = [
      'const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);',
      "const retryDaysRemaining = Math.max(0, 30 - Math.ceil(elapsedDays));",
      "await save({ tranco_consent_denied_reason: 'deny' });",
    ].join('\n');

    expect(findViolations(source)).toHaveLength(3);
    expect(findViolations(OWNED_BY_RULE_MODULE[0].source)).toEqual([]);
  });
});
