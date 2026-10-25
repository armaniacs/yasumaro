/**
 * check-deps-tiers.test.ts
 * PBI 11: unit tests for the two-tier audit classifier in
 * scripts/release-checks/check-deps.mjs
 * (prod scope = fail, dev-only + memo = warn, dev-only w/o memo = fail).
 */
import { describe, it, expect } from 'vitest';
import { classifyAuditFindings, extractAdvisoryIds } from '../release-checks/check-deps.mjs';

function entry(via) {
  return { severity: 'high', via, range: '>=0.0.0' };
}

const NODE_FORGE = entry([
  'node-forge',
  {
    name: 'node-forge',
    title: 'RSA PKCS#1 v1.5 signature verification bypass',
    url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  },
]);

const MEMO = '### 6.1 node-forge RSA ...\n- 対象: GHSA-86W9-CPQP-85RV（CVSS 7.5）\n- 経路: node-forge@1.4.0 ...';

describe('extractAdvisoryIds', () => {
  it('extracts a GHSA id from an advisory URL, upper-cased', () => {
    expect([...extractAdvisoryIds(NODE_FORGE)]).toEqual(['GHSA-86W9-CPQP-85RV']);
  });

  it('extracts a CVE id from a title', () => {
    const ids = extractAdvisoryIds(entry([{ title: 'flaw CVE-2024-12345 in parser' }]));
    expect([...ids]).toEqual(['CVE-2024-12345']);
  });

  it('returns empty for bare package-name via chains', () => {
    expect(extractAdvisoryIds(entry(['some-pkg'])).size).toBe(0);
  });
});

describe('classifyAuditFindings', () => {
  it('is clean when neither scope reports critical/high', () => {
    const empty = { report: { critical: [], high: [] } };
    expect(classifyAuditFindings(empty, empty, MEMO)).toEqual({ status: 'clean' });
  });

  it('fails when prod scope itself is affected', () => {
    const full = { report: { critical: [], high: [['node-forge', NODE_FORGE]] } };
    const prod = { report: { critical: [], high: [['node-forge', NODE_FORGE]] } };
    const verdict = classifyAuditFindings(full, prod, MEMO);
    expect(verdict.status).toBe('prod-fail');
    expect(verdict.findings).toHaveLength(1);
  });

  it('warns for dev-only findings covered by a memo', () => {
    const full = { report: { critical: [], high: [['node-forge', NODE_FORGE]] } };
    const prod = { report: { critical: [], high: [] } };
    const verdict = classifyAuditFindings(full, prod, MEMO);
    expect(verdict.status).toBe('dev-warn');
    expect(verdict.findings).toHaveLength(1);
  });

  it('fails for dev-only findings without a memo', () => {
    const full = { report: { critical: [], high: [['node-forge', NODE_FORGE]] } };
    const prod = { report: { critical: [], high: [] } };
    const verdict = classifyAuditFindings(full, prod, 'no advisories recorded here');
    expect(verdict.status).toBe('dev-uncovered');
  });

  it('fails when the memo file cannot be read', () => {
    const full = { report: { critical: [], high: [['node-forge', NODE_FORGE]] } };
    const prod = { report: { critical: [], high: [] } };
    const verdict = classifyAuditFindings(full, prod, null);
    expect(verdict.status).toBe('dev-uncovered');
    expect(verdict.detail).toContain('DEPENDINGS.md');
  });

  it('covers id-less entries by package name as fallback', () => {
    const idLess = entry(['left-pad-ish']);
    const full = { report: { critical: [], high: [['left-pad-ish', idLess]] } };
    const prod = { report: { critical: [], high: [] } };
    expect(classifyAuditFindings(full, prod, 'memo mentions left-pad-ish').status).toBe('dev-warn');
    expect(classifyAuditFindings(full, prod, 'unrelated memo').status).toBe('dev-uncovered');
  });

  it('reports scan errors instead of passing', () => {
    const prod = { report: { critical: [], high: [] } };
    expect(classifyAuditFindings({ error: 'EAI_AGAIN' }, prod, MEMO).status).toBe('scan-error');
    expect(classifyAuditFindings({ report: { critical: [], high: [] } }, { error: 'boom' }, MEMO).status).toBe(
      'scan-error'
    );
  });
});
