import { addLog, getLogs, clearLogs, flushLogs } from '../logger/core.js';

describe('core orchestrator', () => {
  beforeEach(async () => {
    await clearLogs();
  });

  it('addLog pushes to buffer and getLogs returns the entry', async () => {
    await addLog('INFO', 'hello');
    const logs = await getLogs();
    expect(logs.some((l) => l.message === 'hello')).toBe(true);
  });
});

describe('flush alarm lifecycle', () => {
  beforeEach(async () => {
    await clearLogs();
    vi.clearAllMocks();
  });

  it('clears the scheduled alarm after a successful flush', async () => {
    await addLog('INFO', 'test message 1');
    // BATCH_FLUSH_SIZE に満たない場合は addLog が scheduler.schedule() を
    // 呼ぶだけでまだ flush されない。flushLogs(true) で明示的にフラッシュする。
    await flushLogs(true);

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });

  it('clears the scheduled alarm when clearLogs is called', async () => {
    await clearLogs();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });
});
