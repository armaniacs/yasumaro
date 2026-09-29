/**
 * aiTestRunner single-owner contract test.
 *
 * The AI connection test loop (runId generation → progress subscription →
 * elapsed interval → TEST_AI → provider result rows) and its in-flight guard
 * had two implementations, one per surface. `src/dashboard/aiTestRunner.ts` is
 * now the only owner; this scan fails if a caller grows its own copy.
 *
 * Source scan, not a runtime spy: a re-introduced loop is an inline sequence
 * inside a click handler, and only a static scan sees the steps no test happens
 * to exercise (a duplicated guard that shadows the shared one, for instance,
 * produces no observable difference in a passing test).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUNNER = 'src/dashboard/aiTestRunner.ts';
const CALLERS = [
  'src/dashboard/generalSettings/connectionTests.ts',
  'src/dashboard/panels/diagnostic/diagnosticsActions.ts',
];

const projectRoot = resolve(import.meta.dirname, '../../..');

function readRepoSource(rel: string): string {
  return readFileSync(join(projectRoot, ...rel.split('/')), 'utf8');
}

/** Every step of the loop plus the guard, all owned by the runner. */
const OWNED_BY_RUNNER = [
  /aiTestInFlight/,
  /subscribeAiTestProgress\(/,
  /generateAiTestRunId\(/,
  /buildAiTestProgressView\(/,
  /renderAiTestProgress/,
  /setInterval\(/,
  /formatProviderHeadline\(/,
  /formatProviderDetailLines\(/,
];

function findViolations(source: string): string[] {
  return OWNED_BY_RUNNER.filter((pattern) => pattern.test(source)).map((pattern) => pattern.source);
}

function dashboardSources(dir = 'src/dashboard'): string[] {
  return readdirSync(join(projectRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : dashboardSources(rel);
    return entry.name.endsWith('.ts') ? [rel] : [];
  });
}

describe('AI test runner ownership', () => {
  it('keeps the loop and the guard in one module', () => {
    const runner = readRepoSource(RUNNER);

    expect(runner).toContain('export async function runAiConnectionTest(');
    expect(runner).toContain('export function renderAiTestProviderLines(');
    // The runner's own steps are the point: one copy, not zero.
    for (const pattern of OWNED_BY_RUNNER) {
      expect(pattern.test(runner), `${pattern.source} must stay in the runner`).toBe(true);
    }
  });

  it('finds no second loop implementation in the callers', () => {
    for (const caller of CALLERS) {
      expect(findViolations(readRepoSource(caller)), `${caller} must not re-own the loop`).toEqual([]);
    }
  });

  it('makes both callers run through the shared runner', () => {
    for (const caller of CALLERS) {
      expect(readRepoSource(caller)).toMatch(/from '(\.\.\/)+aiTestRunner\.js'/);
      expect(readRepoSource(caller)).toContain('run: testAiConnection');
      expect(readRepoSource(caller)).toContain('runAiConnectionTest({');
    }
  });

  it('leaves no third surface subscribing to the progress protocol on its own', () => {
    const subscribers = dashboardSources().filter((rel) =>
      /from '(\.\/)+aiTestProgressClient\.js'/.test(readRepoSource(rel)),
    );

    expect(subscribers).toEqual([RUNNER]);
  });

  it('still flags a caller that re-introduces the loop', () => {
    // A source scan is only a contract if it can fail: feed the detector the
    // exact sequence the diagnostics handler used to carry inline.
    const source = [
      'let aiTestInFlight = false;',
      'const runId = generateAiTestRunId();',
      'const view = buildAiTestProgressView(connectionResult);',
      'unsubscribe = subscribeAiTestProgress(runId, onProgress);',
      'renderAiTestProgressLabel(view, latestProgress);',
      'elapsedTimer = setInterval(() => updateView(false), 200);',
      'row.textContent = formatProviderHeadline(provider);',
      'for (const line of formatProviderDetailLines(provider)) { /* ... */ }',
    ].join('\n');

    expect(findViolations(source)).toHaveLength(OWNED_BY_RUNNER.length);
    expect(findViolations(readRepoSource(RUNNER))).toHaveLength(OWNED_BY_RUNNER.length);
    // ...and it does not fire on a caller that only resolves the drawing target.
    expect(findViolations("const target = document.getElementById('status');")).toEqual([]);
  });
});
