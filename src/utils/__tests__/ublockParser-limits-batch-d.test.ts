/**
 * ublockParser-limits-batch-d.test.ts — PBI 2026-11-08-16 (item 3) pins.
 *
 * The paste size caps live in utils/limits.ts (MAX_UBLOCK_FILTER_BYTES /
 * MAX_UBLOCK_FILTER_LINES); the parser references them instead of its own
 * literals. Values and rejection behavior are unchanged — pinned here.
 */
import { describe, it, expect } from 'vitest';
import { parseUblockFilterListWithErrors } from '../ublockParser/index.js';
import { MAX_UBLOCK_FILTER_BYTES, MAX_UBLOCK_FILTER_LINES } from '../limits.js';

describe('ublockParser shared limit caps (PBI 2026-11-08-16 item 3)', () => {
  it('keeps the long-standing 10MB / 500000 caps', () => {
    expect(MAX_UBLOCK_FILTER_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_UBLOCK_FILTER_LINES).toBe(500000);
  });

  it('rejects input one byte over the shared byte cap', () => {
    const text = 'x'.repeat(MAX_UBLOCK_FILTER_BYTES + 1);
    const result = parseUblockFilterListWithErrors(text);
    expect(result.rules.blockRules).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('10MB limit');
  });

  it('accepts input at exactly the shared byte cap without a size error', () => {
    const text = 'x'.repeat(MAX_UBLOCK_FILTER_BYTES);
    const result = parseUblockFilterListWithErrors(text);
    expect(result.errors.some((e) => e.message.includes('limit'))).toBe(false);
  });

  it('rejects input one line over the shared line cap', () => {
    const text = Array.from({ length: MAX_UBLOCK_FILTER_LINES + 1 }, () => '||example.com^').join('\n');
    const result = parseUblockFilterListWithErrors(text);
    expect(result.rules.blockRules).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain(`${MAX_UBLOCK_FILTER_LINES} limit`);
  });
});
