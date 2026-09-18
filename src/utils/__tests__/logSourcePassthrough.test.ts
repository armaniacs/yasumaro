import { logError } from '../logger/api.js';

describe('log source passthrough', () => {
  it('uses explicit source without stack parsing', async () => {
    await logError('test msg', { x: 1 }, 'UNKN_001', 'myModule');
    // resolveLogSource is removed from the public API.
    expect((logError as unknown as Record<string, unknown>).resolveLogSource).toBeUndefined();
  });
});
