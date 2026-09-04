/**
 * gitignore.test.ts — guards the tracking boundary: the whole bench/ tree must
 * stay tracked and only bench/reports/ may be ignored. If a bare `bench/` rule
 * sneaks back into .gitignore, the harness silently vanishes from fresh clones.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gitignore = readFileSync(resolve(__dirname, '../../../.gitignore'), 'utf8');

describe('.gitignore bench tracking boundary', () => {
  it('does not contain a bare bench/ ignore rule', () => {
    expect(gitignore.split('\n')).not.toContain('bench/');
  });
  it('ignores only the run artifacts directory', () => {
    expect(gitignore).toContain('bench/reports/');
  });
});
