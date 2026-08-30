/**
 * Integration: the logger persistence boundary neutralizes untrusted text.
 * Covers VULN-044 (multi-line / ANSI / control-char injection into the log) and
 * the PII-mask ordering contract (mask first, neutralize second).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addLog, flushLogs, getLogs, clearLogs } from '../core.js';

const ESC = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0x00);
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  await clearLogs();
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('logger persistence boundary neutralization', () => {
  it('single-lines a multi-line Obsidian-style error body (VULN-044)', async () => {
    const obsidianBody = `Obsidian API Error: 500\n[Logger:fake] forged entry\n${NUL}`;
    await addLog('ERROR', obsidianBody, {});
    await flushLogs(true);

    const [entry] = await getLogs();
    expect(entry.message).not.toContain('\n');
    expect(entry.message).not.toContain(NUL);
    expect(entry.message).toContain('[Logger:fake] forged entry');
  });

  it('strips ANSI escape sequences from a persisted message', async () => {
    await addLog('ERROR', `${ESC}[31mObsidian API Error: 401${ESC}[0m`, {});
    await flushLogs(true);

    const [entry] = await getLogs();
    expect(entry.message).not.toContain(ESC);
    expect(entry.message).toBe('Obsidian API Error: 401');
  });

  it('neutralizes multi-line strings nested in details', async () => {
    await addLog('ERROR', 'Obsidian API Error', { errorText: `line1\nline2` });
    await flushLogs(true);

    const [entry] = await getLogs();
    expect(String(entry.details?.errorText)).not.toContain('\n');
  });

  it('PII regression: a PII string is still masked identically when combined with neutralization (mask before neutralize)', async () => {
    await addLog('ERROR', 'auth failed for user@example.com\nretrying', {});
    await addLog('INFO', 'plain user@example.com', {});
    await flushLogs(true);

    const logs = await getLogs();
    const combined = logs.find((l) => l.type === 'ERROR');
    const plain = logs.find((l) => l.type === 'INFO');
    expect(combined?.message).not.toContain('user@example.com');
    expect(combined?.message).not.toContain('\n');
    // The mask runs before neutralization, so the masked token is identical to
    // the newline-free case.
    expect(plain?.message).not.toContain('user@example.com');
    const maskedToken = plain?.message.replace('plain ', '');
    expect(combined?.message).toContain(maskedToken as string);
  });
});
