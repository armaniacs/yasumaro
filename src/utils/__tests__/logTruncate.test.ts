import { describe, it, expect } from 'vitest';
import { truncateForLog, MAX_LOG_BODY_CHARS } from '../logTruncate.js';

describe('truncateForLog (Red-Team: Obsidian error body log hygiene)', () => {
  it('keeps short bodies intact', () => {
    expect(truncateForLog('not found')).toBe('not found');
  });

  it('caps a 1MB-class server-controlled body to a few hundred chars', () => {
    const huge = 'x'.repeat(1024 * 1024);
    const out = truncateForLog(huge);
    expect(out.length).toBeLessThanOrEqual(MAX_LOG_BODY_CHARS + 32);
    expect(out.length).toBeLessThan(huge.length);
  });

  it('marks truncation so the log stays honest', () => {
    const out = truncateForLog('y'.repeat(MAX_LOG_BODY_CHARS + 10));
    expect(out).toContain('truncated');
  });

  it('never returns a multi-line log fragment', () => {
    const out = truncateForLog('line1\nline2\r\nline3' + 'z'.repeat(MAX_LOG_BODY_CHARS));
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\r');
  });
});
