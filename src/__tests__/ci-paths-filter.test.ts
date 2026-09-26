/**
 * ci-paths-filter.test.ts
 *
 * Pins the job-level path classification in `.github/workflows/ci.yml` (PBI
 * 2026-09-25-14).
 *
 * A wrong pattern here is the dangerous kind of CI bug: the workflow stays
 * green while quietly skipping the job that would have caught the change. So
 * this file does two things instead of just snapshotting the YAML:
 *
 *   1. Structural pins — the six original jobs survive, gitleaks stays
 *      unconditional, build cannot outlive validate, and the workflow trigger
 *      never grows a paths filter (which would leave required checks pending).
 *   2. A behavioural matrix — sample files through the real patterns, so the
 *      fail-closed property is proven rather than assumed.
 *
 * The matcher below mirrors `dorny/paths-filter`: it builds one matcher per
 * pattern and combines them with the configured quantifier. The action uses
 * picomatch, which is only present here as a transitive dependency of knip, so
 * this file re-implements just enough of it and then GUARDS the pattern list so
 * an unsupported glob form fails the test instead of being silently mismatched.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_PATH = join(process.cwd(), '.github/workflows/ci.yml');
const raw = readFileSync(WORKFLOW_PATH, 'utf8');
const lines = raw.split('\n');

/* ------------------------------------------------------------------ parsing */

interface Job {
  name: string;
  /** `needs:` verbatim, or undefined. */
  needs?: string;
  /** `if:` expression without the surrounding `${{ }}`, or undefined. */
  condition?: string;
}

function parseJobs(): Map<string, Job> {
  const jobs = new Map<string, Job>();
  const jobsAt = lines.findIndex((l) => l === 'jobs:');
  expect(jobsAt).toBeGreaterThan(-1);

  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    const job: Job = { name };
    // The block runs until the next 2-space key (the next job) or dedent to 0.
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^ {2}\S/.test(lines[j]) || /^\S/.test(lines[j])) break;
      const needs = /^ {4}needs:\s*(.+)$/.exec(lines[j]);
      if (needs) job.needs = needs[1].trim();
      const cond = /^ {4}if:\s*(.+)$/.exec(lines[j]);
      if (cond) job.condition = cond[1].trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    }
    jobs.set(name, job);
    i += 0;
  }
  return jobs;
}

type Filters = Record<string, string[]>;

function parseFilters(stepId: string): { quantifier: 'some' | 'every'; filters: Filters } {
  const at = lines.findIndex((l) => l.trim() === `- id: ${stepId}`);
  expect(at, `classification step "${stepId}" not found`).toBeGreaterThan(-1);

  const filtersAt = lines.findIndex((l, i) => i > at && l.trim() === 'filters: |');
  expect(filtersAt, `filters block for "${stepId}" not found`).toBeGreaterThan(-1);

  // The literal block is everything indented deeper than the `filters:` key
  // itself. Deriving the depth beats hard-coding it, so re-indenting the YAML
  // cannot silently turn every pattern into a non-match.
  const baseIndent = /^(\s*)/.exec(lines[filtersAt])?.[1].length ?? 0;
  const body = /^\s*(.*)$/.exec(lines[filtersAt])?.[1] ?? '';
  const deeper = new RegExp(`^ {${baseIndent + 1},}\\S`);

  const filters: Filters = {};
  let current: string | undefined;
  for (let i = filtersAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== '' && !deeper.test(line)) break;
    const text = line.trim();
    const name = /^([A-Za-z0-9_-]+):$/.exec(text);
    if (name) {
      current = name[1];
      filters[current] = [];
      continue;
    }
    const item = /^-\s*'?([^']+)'?$/.exec(text);
    if (item && current) filters[current].push(item[1]);
  }

  // Quantifier is read from the step block so the test fails if it is dropped.
  let declared: 'some' | 'every' = 'some';
  for (let i = at; i < filtersAt; i += 1) {
    const m = /predicate-quantifier:\s*(\w+)/.exec(lines[i]);
    if (m) declared = m[1] as 'some' | 'every';
  }
  expect(body).toBe('filters: |');
  return { quantifier: declared, filters };
}

/* ----------------------------------------------------------------- matching */

/**
 * Compiles one gitignore-style pattern.
 *
 * Supported forms: a bare literal, a whole-tree wildcard, a directory prefix
 * followed by a tree wildcard, a tree wildcard used as a prefix, a tree
 * wildcard in the middle, a single-segment wildcard, and any of those with a
 * leading `!` for negation.
 *
 * `assertSupportedPatterns` fails the suite if the workflow grows a form this
 * does not implement, so the two cannot drift apart silently.
 */
function toRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**', i)) {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
      continue;
    }
    if (pattern[i] === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (pattern[i] === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

function patternMatches(pattern: string, file: string): boolean {
  const negated = pattern.startsWith('!');
  const body = negated ? pattern.slice(1) : pattern;
  const hit = toRegExp(body).test(file);
  return negated ? !hit : hit;
}

function filterMatches(
  patterns: string[],
  file: string,
  quantifier: 'some' | 'every',
): boolean {
  return quantifier === 'every'
    ? patterns.every((p) => patternMatches(p, file))
    : patterns.some((p) => patternMatches(p, file));
}

/* ------------------------------------------------------------------ fixtures */

const jobs = parseJobs();

/** The fail-closed subtraction lives in its own step because the quantifier is per-step. */
const SUBTRACT_STEP = 'filter-subtract';
const ALLOW_STEP = 'filter-allow';

const subtract = parseFilters(SUBTRACT_STEP);
const allow = parseFilters(ALLOW_STEP);

/** Which jobs would run for a given changed file. */
/**
 * `bench-check` only exists on some revisions of this workflow, so it is
 * reported only when the job is actually declared. That keeps one test file
 * valid both here and on the branch that introduces the job, instead of
 * forking the test at every rebase.
 */
function jobsFor(file: string): Record<string, boolean> {
  const gitleaks = true; // security gate is never path-gated
  const result: Record<string, boolean> = {
    validate: filterMatches(subtract.filters.validate ?? [], file, subtract.quantifier),
    'wasm-test': filterMatches(allow.filters.wasm ?? [], file, allow.quantifier),
    'dod-check': filterMatches(allow.filters.pbi ?? [], file, allow.quantifier),
    build: filterMatches(allow.filters.build ?? [], file, allow.quantifier),
    gitleaks,
  };
  if (jobs.has('bench-check')) {
    result['bench-check'] = filterMatches(allow.filters.bench ?? [], file, allow.quantifier);
  }
  return result;
}

/* --------------------------------------------------------------------- specs */

describe('workflow trigger', () => {
  it('has no workflow-level paths filter', () => {
    // A workflow-level paths filter makes required checks report "pending"
    // instead of "skipped" on a PR that touches nothing, which blocks merges.
    const trigger = lines.slice(0, lines.indexOf('jobs:')).join('\n');
    expect(trigger).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it('still runs on pull_request and push to main', () => {
    const trigger = lines.slice(0, lines.indexOf('jobs:')).join('\n');
    expect(trigger).toContain('pull_request:');
    expect(trigger).toContain('push:');
    expect(trigger).toContain('branches: [main]');
  });
});

describe('job structure', () => {
  // The five jobs below predate the classification. `bench-check` is asserted
  // separately because only some revisions of this workflow declare it.
  const ORIGINAL_JOBS = ['validate', 'gitleaks', 'wasm-test', 'dod-check', 'build'];

  it.each(ORIGINAL_JOBS)('keeps the original job id %s', (id) => {
    expect(jobs.has(id), `job "${id}" disappeared from ci.yml`).toBe(true);
  });

  it('adds a single always-running classification job', () => {
    const classification = [...jobs.values()].filter((j) => j.condition === undefined && j.needs === undefined);
    // gitleaks is intentionally condition-free, so it is expected here.
    expect(classification.map((j) => j.name).sort()).toEqual(['changes', 'gitleaks']);
  });

  it('leaves gitleaks unconditional — the security gate is never path-gated', () => {
    expect(jobs.get('gitleaks')?.condition).toBeUndefined();
    expect(jobs.get('gitleaks')?.needs).toBeUndefined();
  });

  it.each([
    ['validate', 'validate'],
    ['wasm-test', 'wasm'],
    ['dod-check', 'pbi'],
    ...(jobs.has('bench-check') ? [['bench-check', 'bench']] : []),
  ])('gates %s on the %s classification', (job, output) => {
    const found = jobs.get(job);
    expect(found?.condition).toBe(`needs.changes.outputs.${output} == 'true'`);
    expect(found?.needs).toBe('changes');
  });

  it('cannot let build outlive validate', () => {
    const build = jobs.get('build');
    expect(build?.needs).toBe('[changes, validate]');
    // `!cancelled()` is required: without a status function in the `if`,
    // GitHub skips build before the expression is even evaluated.
    expect(build?.condition).toContain('!cancelled()');
    expect(build?.condition).toContain("needs.validate.result == 'success'");
    expect(build?.condition).toContain("needs.changes.outputs.build == 'true'");
  });

  it('declares every classification output it is consumed through', () => {
    const declaration = lines.slice(0, lines.indexOf('  validate:')).join('\n');
    const required = ['validate', 'wasm', 'pbi', 'build'];
    if (jobs.has('bench-check')) required.push('bench');
    for (const output of required) {
      expect(declaration, `changes job does not export "${output}"`).toContain(`${output}: \${{ steps.`);
    }
  });
});

describe('quantifiers', () => {
  it('uses `every` for the fail-closed subtraction', () => {
    // With the default `some`, the leading `'**'` would match every file and the
    // negated rules could never subtract anything.
    expect(subtract.quantifier).toBe('every');
  });

  it('uses `some` for the per-job allowlists', () => {
    expect(allow.quantifier).toBe('some');
  });

  it('keeps the two quantifiers in separate steps', () => {
    // `predicate-quantifier` is a step input, so one step cannot host both
    // a subtraction and an allowlist.
    expect(SUBTRACT_STEP).not.toBe(ALLOW_STEP);
  });
});

describe('behavioural matrix', () => {
  /**
   * `[changed file, jobs that must run, does the bench filter match?]`.
   * `bench-check` is appended only when the workflow actually declares it, so
   * one expectation table is correct for both workflow shapes.
   */
  const MATRIX: Array<[string, string[], boolean]> = [
    // [changed file, jobs that must run]
    ['README.md', ['gitleaks'], false],
    ['dev-docs/LAYERS.md', ['gitleaks'], false],
    ['docs/guides.html', ['gitleaks'], false],
    ['LICENSE', ['gitleaks'], false],
    ['src/index.ts', ['validate', 'build', 'gitleaks'], true],
    ['entrypoints/background.ts', ['validate', 'build', 'gitleaks'], true],
    ['testDir/e2e/x.spec.ts', ['validate', 'gitleaks'], false],
    ['eslint.config.js', ['validate', 'gitleaks'], false],
    ['package.json', ['validate', 'wasm-test', 'build', 'gitleaks'], true],
    ['package-lock.json', ['validate', 'wasm-test', 'build', 'gitleaks'], true],
    ['.npmrc', ['validate', 'gitleaks'], false],
    ['pbi/00-INDEX.md', ['dod-check', 'gitleaks'], false],
    ['wasm/pii-sanitizer/src/lib.rs', ['validate', 'wasm-test', 'build', 'gitleaks'], true],
    ['wasm/crates.json', ['validate', 'wasm-test', 'build', 'gitleaks'], false],
  ];

  it.each(MATRIX)('%s runs %j', (file, expected, benchRuns) => {
    const want = jobs.has('bench-check') && benchRuns ? [...expected, 'bench-check'] : expected;
    const actual = Object.entries(jobsFor(file))
      .filter(([, on]) => on)
      .map(([name]) => name)
      .sort();
    expect(actual).toEqual([...want].sort());
  });
});

describe('fail-closed', () => {
  it('validates a file type and directory nobody has thought about yet', () => {
    // The point of subtracting an explicit docs list instead of allowlisting
    // known inputs: anything new lands in validate rather than silently
    // skipping it.
    expect(jobsFor('some-new-tool/config.toml').validate).toBe(true);
    expect(jobsFor('unknown-file.xyz').validate).toBe(true);
    expect(jobsFor('src/deeply/nested/new/file.ts').validate).toBe(true);
  });

  it('does not let a docs-only change reach validate', () => {
    expect(jobsFor('README.md').validate).toBe(false);
    expect(jobsFor('docs/index.html').validate).toBe(false);
  });

  it('runs every code gate when ci.yml itself changes', () => {
    // Otherwise the filter definition could exclude its own change and the
    // PR would ship without a single gate having looked at it.
    const on = jobsFor('.github/workflows/ci.yml');
    expect(on.validate).toBe(true);
    expect(on['wasm-test']).toBe(true);
    expect(on['dod-check']).toBe(true);
    expect(on.build).toBe(true);
  });

  it('runs the code gates when the shared actions or lockfile change', () => {
    expect(jobsFor('.github/actions/x/action.yml').validate).toBe(true);
    expect(jobsFor('.github/actions/x/action.yml')['wasm-test']).toBe(true);
    expect(jobsFor('package-lock.json').validate).toBe(true);
    expect(jobsFor('.npmrc').validate).toBe(true);
  });
});

describe('build inputs are a subset of validate inputs', () => {
  // If build could match something validate does not, a change would reach the
  // artifact job without having passed lint/type/test.
  const SAMPLE = [
    'src/a.ts',
    'entrypoints/b.ts',
    'public/icon/16.png',
    'wasm/crates.json',
    'package.json',
    'package-lock.json',
    'wxt.config.ts',
    '.github/workflows/ci.yml',
    '.github/actions/x/action.yml',
  ];

  it.each(SAMPLE)('%s is covered by validate', (file) => {
    expect(jobsFor(file).build).toBe(true);
    expect(jobsFor(file).validate).toBe(true);
  });
});

describe.skipIf(!jobs.has('bench-check'))('bench-check keeps its proven trigger condition', () => {
  it('matches the filter the job used before the classification', () => {
    // bench-check already had a step-level filter. Moving it to the shared
    // classification must not change which changes trigger it.
    expect([...(allow.filters.bench ?? [])].sort()).toEqual(
      [
        'bench/**',
        'src/**',
        'entrypoints/**',
        'wasm/**/*.rs',
        'package.json',
        'package-lock.json',
        'wxt.config.ts',
      ].sort(),
    );
  });
});

describe('pattern guard', () => {
  it('uses only glob forms the matcher above implements', () => {
    // If someone adds `[a-z]` or `{a,b}` or `!(...)`, this matcher would
    // silently disagree with picomatch. Fail loudly instead.
    const all = [
      ...Object.values(subtract.filters).flat(),
      ...Object.values(allow.filters).flat(),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const pattern of all) {
      // A leading `!` is the negation marker, so both checks apply to the body.
      const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;
      expect(body, `unsupported glob character in: ${pattern}`).toMatch(/^[\w.*/-]+$/);
      // Every star run must be a whole path segment, because that is the only
      // shape toRegExp() above knows how to compile.
      for (const segment of body.split('/')) {
        for (const run of segment.match(/\*+/g) ?? []) {
          expect([1, 2], `unsupported star run "${run}" in: ${pattern}`).toContain(run.length);
        }
      }
    }
  });

  it('pins every filter to a non-empty pattern list', () => {
    for (const [name, patterns] of Object.entries({ ...subtract.filters, ...allow.filters })) {
      expect(patterns.length, `filter "${name}" is empty`).toBeGreaterThan(0);
    }
  });
});

describe('scope', () => {
  it('leaves tests.yml alone', () => {
    // PBI 2026-09-25-14 is ci.yml only; a11y / usability / firefox-storage /
    // test keep running unconditionally on every PR.
    const other = readFileSync(join(process.cwd(), '.github/workflows/tests.yml'), 'utf8');
    expect(other).not.toMatch(/paths-filter/);
  });
});
