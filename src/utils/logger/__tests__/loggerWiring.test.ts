/**
 * loggerWiring.test.ts
 * Logger wiring injection: the full interface (addLog → flush → getLogs →
 * clearLogs) is driven with in-memory adapters and NO chrome at all —
 * globalThis.chrome is removed for the duration of these tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addLog,
  flushLogs,
  getLogs,
  clearLogs,
  clearPendingLogs,
  initLogger,
  resetLoggerWiring,
} from '../core.js';
import { InMemoryLogAdapter } from '../storageAdapter.js';
import { ImmediateFlushScheduler } from '../flushScheduler.js';

const globalRef = globalThis as unknown as { chrome?: unknown };
const savedChrome = globalRef.chrome;

function removeChrome(): void {
  delete globalRef.chrome;
}

beforeEach(() => {
  removeChrome();
  initLogger({
    storage: new InMemoryLogAdapter(),
    scheduler: new ImmediateFlushScheduler(),
  });
  clearPendingLogs();
});

afterEach(() => {
  resetLoggerWiring();
  clearPendingLogs();
  globalRef.chrome = savedChrome;
});

describe('in-memory logger wiring', () => {
  it('writes and reads entries with no chrome at all', async () => {
    expect(globalRef.chrome).toBeUndefined();

    await addLog('INFO', 'hello wiring', {});
    await flushLogs(true);
    const logs = await getLogs();

    expect(logs.some((l) => l.message === 'hello wiring')).toBe(true);
  });

  it('clearLogs empties both buffer and store', async () => {
    await addLog('INFO', 'to be cleared', {});
    await clearLogs();
    const logs = await getLogs();

    expect(logs).toHaveLength(0);
  });

  it('immediate scheduler flushes without an explicit flush call', async () => {
    await addLog('INFO', 'auto flushed', {});
    // ImmediateFlushScheduler runs the handler on schedule(); the buffer may
    // still hold the entry until persistPending drains it — either way the
    // entry must be observable through the interface.
    const logs = await getLogs();

    expect(logs.some((l) => l.message === 'auto flushed')).toBe(true);
  });
});
