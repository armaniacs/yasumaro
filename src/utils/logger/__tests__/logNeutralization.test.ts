import { describe, it, expect } from 'vitest';
import { neutralizeLogText, LINE_BREAK_REPLACEMENT } from '../neutralize.js';

const ESC = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);

describe('neutralizeLogText', () => {
  it('replaces LF with a visible separator (not removal)', () => {
    expect(neutralizeLogText('a\nb')).toBe(`a${LINE_BREAK_REPLACEMENT}b`);
  });

  it('replaces CRLF and lone CR with a single separator each', () => {
    expect(neutralizeLogText('a\r\nb\rc')).toBe(
      `a${LINE_BREAK_REPLACEMENT}b${LINE_BREAK_REPLACEMENT}c`,
    );
  });

  it('handles empty string', () => {
    expect(neutralizeLogText('')).toBe('');
  });

  it('collapses consecutive newlines into consecutive separators', () => {
    expect(neutralizeLogText('a\n\n\nb')).toBe(
      `a${LINE_BREAK_REPLACEMENT}${LINE_BREAK_REPLACEMENT}${LINE_BREAK_REPLACEMENT}b`,
    );
  });

  it('removes ANSI CSI colour sequences but keeps the wrapped text', () => {
    expect(neutralizeLogText(`${ESC}[31mred${ESC}[0m`)).toBe('red');
  });

  it('removes NUL and DEL control characters', () => {
    expect(neutralizeLogText(`a${NUL}b${DEL}c`)).toBe('abc');
  });

  it('handles mixed ANSI, control chars and newlines together', () => {
    const forged = `${ESC}[32mok${NUL}\n[Logger:fake] forged${ESC}[0m`;
    const out = neutralizeLogText(forged);
    expect(out).not.toContain('\n');
    expect(out).not.toContain(ESC);
    expect(out).not.toContain(NUL);
    expect(out).toBe(`ok${LINE_BREAK_REPLACEMENT}[Logger:fake] forged`);
  });

  it('preserves emoji and other multi-byte characters', () => {
    expect(neutralizeLogText('done 🎉 完了')).toBe('done 🎉 完了');
  });

  it('leaves a lone ESC without a CSI intro (removed as a control char, no over-eating)', () => {
    expect(neutralizeLogText(`press ${ESC} then A`)).toBe('press  then A');
  });

  it('is a pure function over a huge body without throwing', () => {
    const huge = ('x\n'.repeat(100_000));
    const out = neutralizeLogText(huge);
    expect(out).not.toContain('\n');
    expect(out.startsWith(`x${LINE_BREAK_REPLACEMENT}x`)).toBe(true);
  });
});
