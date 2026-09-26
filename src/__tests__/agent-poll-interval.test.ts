/**
 * agent-poll-interval.test.ts
 *
 * Agents wait on a lot of external processes — CI runs, watch mode, readiness
 * probes. Every one of those waits is paced by a polling interval, and the
 * interval is the WORST-case latency of a single wait: it is the slice of wall
 * clock that can be spent doing nothing before the next check.
 *
 * A 30-second interval is therefore not "three times slower", it is up to 30
 * seconds of dead time per wait, paid again on every poll and again on every
 * wait in the session. None of that cost is visible in the output, so the
 * instinct to "raise the interval so the log is quieter" quietly buys nothing
 * and costs a lot.
 *
 * This test cannot police an agent's ad-hoc shell command, so it does the two
 * things that are actually checkable:
 *
 *   1. the rule is present in the files every agent reads, so it cannot be
 *      deleted quietly, and
 *   2. no file in the repository passes an interval above the cap to a
 *      watch/poll flag.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';

const CAP_SECONDS = 10;

/**
 * The rule of record. Tracked, so a fresh clone and CI both get it, and read by
 * every agent that works in this repository.
 */
const RULE_OF_RECORD = 'AGENTS.md';

/**
 * Local agent-config mirrors. These are matched by `.gitignore`'s `.*` rule and
 * are deliberately NOT tracked, so they cannot be the rule of record — a rule
 * that only lives in an ignored file does not exist for CI or for a teammate.
 * They are still checked, but only when present.
 */
const LOCAL_MIRRORS = ['.kilorules', '.kilocode/rules.md'];

function ruleFilesInRepo(): string[] {
  return [RULE_OF_RECORD, ...LOCAL_MIRRORS].filter((f) => existsSync(f));
}

/** Flags that take a polling / pacing interval in seconds. */
const INTERVAL_FLAGS = [
  '--interval',
  '--repeat-each-interval',
  '--poll-interval',
  '--watch-interval',
  '--retry-interval',
  '--timeout', // only for the watch-style tools that accept it as a pace
];

/** Directories that hold no first-party source to police. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.output',
  'graphify-out',
  'bench',
  'test-results',
  'playwright-report',
  'testDir/test-results',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh',
  '.yml', '.yaml', '.json', '.md', '.mk', '.toml',
]);

/**
 * Markdown is excluded from the flag scan on purpose. This rule's own text has
 * to SHOW the violating form (`--interval 30`) next to the compliant one, or
 * nobody can tell what the cap means. Scanning prose would report the rule as a
 * violation of itself. Prose is still covered from the other side: the two
 * "shows a compliant and a violating example" cases require both forms to be
 * present in the rule files.
 */
const SCANNED_EXTENSIONS = new Set([...TEXT_EXTENSIONS].filter((e) => e !== '.md'));

/** @returns repo-relative POSIX paths of every scannable text file. */
function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink (e.g. a node_modules link in a worktree)
    }
    if (st.isDirectory()) {
      collectFiles(full, acc);
    } else if (st.isFile() && SCANNED_EXTENSIONS.has(extname(entry))) {
      acc.push(full);
    }
  }
  return acc;
}

describe('agent polling interval rule', () => {
  it('keeps the rule of record in a tracked file', () => {
    // A rule that only lives in a gitignored dotfile does not exist for CI or
    // for the next person who clones the repository.
    const tracked = execFileSync('git', ['ls-files', RULE_OF_RECORD], {
      encoding: 'utf-8',
    }).trim();
    expect(tracked, `${RULE_OF_RECORD} must be tracked`).toBe(RULE_OF_RECORD);
  });

  it('does not let a local mirror become the rule of record', () => {
    for (const mirror of LOCAL_MIRRORS) {
      if (!existsSync(mirror)) continue;
      // `git check-ignore` exits 0 when the path is ignored.
      const { status } = spawnSync('git', ['check-ignore', '-q', mirror]);
      expect(
        status,
        `${mirror} exists but is not gitignored — either track it and make it a rule file, or delete it`,
      ).toBe(0);
    }
  });

  it.each(ruleFilesInRepo())('%s states the interval cap', (file) => {
    const text = readFileSync(file, 'utf-8');
    expect(text, `${file} must state the cap`).toMatch(/10\s*(秒|seconds?)/i);
    expect(text, `${file} must name the cap as a hard limit`).toMatch(
      /10\s*(秒|seconds?)\s*(以下|or less|以下\b)/i,
    );
  });

  it.each(ruleFilesInRepo())('%s shows a compliant and a violating example', (file) => {
    const text = readFileSync(file, 'utf-8');
    expect(text).toMatch(/--interval\s+10\b/);
    expect(text).toMatch(/--interval\s+30\b/);
  });

  it.each(ruleFilesInRepo())('%s explains why a long interval is costly', (file) => {
    // The cap without the reason gets "fixed" the first time someone wants a
    // quieter log.
    const text = readFileSync(file, 'utf-8');
    expect(text).toMatch(/worst[- ]case|最悪/i);
    expect(text).toMatch(/wall[- ]clock|wall clock/i);
  });

  it('keeps every interval flag in the repository at or below the cap', () => {
    const files = collectFiles(process.cwd());
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // Comments and prose inside a source file carry the rule's own
        // "here is the bad form" example, and an executable command never lives
        // on one of these lines.
        if (/^\s*(?:\/\/|\/\*|\*|#|<!--)/.test(line)) continue;
        for (const flag of INTERVAL_FLAGS) {
          const re = new RegExp(`${flag}[= ]\\s*(\\d+)`, 'g');
          for (const m of line.matchAll(re)) {
            const seconds = Number(m[1]);
            if (seconds > CAP_SECONDS) {
              violations.push(
                `${file}:${i + 1}  ${flag} ${seconds}  >  ${CAP_SECONDS}`,
              );
            }
          }
        }
      }
    }

    expect(
      violations,
      `polling intervals above ${CAP_SECONDS}s:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('scans a non-trivial number of files, so a broken collector cannot pass silently', () => {
    const files = collectFiles(process.cwd());
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('ci.yml'))).toBe(true);
  });
});
