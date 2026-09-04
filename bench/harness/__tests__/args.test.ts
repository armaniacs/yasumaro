/**
 * args.test.ts — parseArgs contract for the bench CLI.
 *
 * Covers every documented usage plus the '--filter' / '--check'
 * flag-collision case that the old 'NEXT' sentinel mishandled.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../args.mjs';

describe('parseArgs', () => {
  it('defaults to micro mode with no args', () => {
    expect(parseArgs([])).toEqual({
      mode: 'micro',
      filter: null,
      check: false,
      updateBaseline: false,
      quick: false,
      noOpen: false,
    });
  });

  it('takes the first non-flag arg as the mode', () => {
    expect(parseArgs(['micro']).mode).toBe('micro');
    expect(parseArgs(['--quick', 'micro']).mode).toBe('micro');
  });

  it('supports the --filter= form', () => {
    const opts = parseArgs(['micro', '--filter=c2,c7']);
    expect(opts.filter).toEqual(['c2', 'c7']);
    expect(opts.check).toBe(false);
  });

  it('supports the bare --filter form with one value token', () => {
    expect(parseArgs(['micro', '--filter', 'c2']).filter).toEqual(['c2']);
    expect(parseArgs(['micro', '--filter', 'c2,c7']).filter).toEqual(['c2', 'c7']);
  });

  it('does not swallow a following flag after bare --filter', () => {
    const opts = parseArgs(['micro', '--filter', '--check']);
    expect(opts.check).toBe(true);
    expect(opts.filter).toBeNull();
  });

  it('leaves filter null when bare --filter has no next token', () => {
    expect(parseArgs(['micro', '--filter']).filter).toBeNull();
  });

  it('sets each boolean flag', () => {
    const opts = parseArgs(['micro', '--check', '--update-baseline', '--quick', '--no-open']);
    expect(opts.check).toBe(true);
    expect(opts.updateBaseline).toBe(true);
    expect(opts.quick).toBe(true);
    expect(opts.noOpen).toBe(true);
  });

  it('ignores unknown args silently', () => {
    const opts = parseArgs(['micro', '--bogus', '--filter=c2', 'extra-positional']);
    expect(opts.filter).toEqual(['c2']);
    expect(opts.check).toBe(false);
  });

  it('handles a combined real-world invocation', () => {
    const opts = parseArgs(['micro', '--filter', 'c2', '--quick', '--no-open']);
    expect(opts).toEqual({
      mode: 'micro',
      filter: ['c2'],
      check: false,
      updateBaseline: false,
      quick: true,
      noOpen: true,
    });
  });
});
