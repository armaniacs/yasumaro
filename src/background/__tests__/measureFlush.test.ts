/**
 * measureFlush.test.ts — queue pre-flush 計測ヘルパ (PBI 2026-10-05-23)。
 *
 * load失敗と「空」の区別・空時のflushスキップ・recoveredログの文言を
 * 両ラベル ("writes" / "records") で固定する。実時間待ちなし。
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  }),
);

import { measureFlush } from '../pendingChromeStorageQueue.js';

describe('measureFlush', () => {
  it('logs recovered/remaining with the chrome-queue wording', async () => {
    const { LogType } = await import('../../utils/logger/types.js');
    const { addLog } = await import('../../utils/logger/core.js');

    const load = vi.fn().mockResolvedValue([1, 2, 3]);
    const flush = vi.fn().mockResolvedValue([3]);

    await measureFlush('pendingChromeStorageQueue', load, flush);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(LogType.INFO, 'pendingChromeStorageQueue: flushed queued writes', {
      recovered: 2,
      remaining: 1,
    });
  });

  it('logs recovered/remaining with the sqlite-queue wording', async () => {
    const { LogType } = await import('../../utils/logger/types.js');
    const { addLog } = await import('../../utils/logger/core.js');

    const load = vi.fn().mockResolvedValue(['a', 'b']);
    const flush = vi.fn().mockResolvedValue([]);

    await measureFlush('pendingSqliteQueue', load, flush);

    expect(addLog).toHaveBeenCalledWith(LogType.INFO, 'pendingSqliteQueue: flushed queued records', {
      recovered: 2,
      remaining: 0,
    });
  });

  it('skips flush and logging when the queue is empty', async () => {
    const { addLog } = await import('../../utils/logger/core.js');

    const load = vi.fn().mockResolvedValue([]);
    const flush = vi.fn();

    await measureFlush('pendingChromeStorageQueue', load, flush);

    expect(flush).not.toHaveBeenCalled();
    expect(addLog).not.toHaveBeenCalled();
  });

  it('treats a failed load as an error, not as an empty queue', async () => {
    const { LogType } = await import('../../utils/logger/types.js');
    const { addLog } = await import('../../utils/logger/core.js');

    const load = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const flush = vi.fn();

    await expect(
      measureFlush('pendingSqliteQueue', load, flush),
    ).resolves.toBeUndefined();

    expect(flush).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      LogType.ERROR,
      'pendingSqliteQueue: failed to load queue for flush',
      expect.objectContaining({ error: expect.stringContaining('storage unavailable') }),
    );
  });

  it('stays silent when nothing recovered', async () => {
    const { addLog } = await import('../../utils/logger/core.js');

    await measureFlush(
      'pendingChromeStorageQueue',
      () => Promise.resolve([1]),
      () => Promise.resolve([1]),
    );

    expect(addLog).not.toHaveBeenCalled();
  });
});
