/**
 * openReport.test.ts — auto-open decision matrix.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { shouldAutoOpen } from '../openReport.mjs';

describe('shouldAutoOpen', () => {
  it('opens for an interactive local session', () => {
    expect(shouldAutoOpen({ stdoutIsTTY: true })).toBe(true);
  });
  it('skips with --no-open', () => {
    expect(shouldAutoOpen({ noOpen: true, stdoutIsTTY: true })).toBe(false);
  });
  it('skips in CI', () => {
    expect(shouldAutoOpen({ ci: '1', stdoutIsTTY: true })).toBe(false);
  });
  it('skips without a TTY', () => {
    expect(shouldAutoOpen({ stdoutIsTTY: false })).toBe(false);
  });
});
