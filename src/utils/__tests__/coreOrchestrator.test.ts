import { addLog, getLogs, clearLogs } from '../logger/core.js';

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
