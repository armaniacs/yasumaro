import * as logger from '../logger.js';

describe('log source passthrough', () => {
  it('uses explicit source without stack parsing', async () => {
    await logger.logError('test msg', { x: 1 }, 'UNKN_001', 'myModule');
    // resolveLogSource is removed from the public API.
    expect((logger as Record<string, unknown>).resolveLogSource).toBeUndefined();
  });
});
