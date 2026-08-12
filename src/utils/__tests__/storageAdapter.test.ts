import { InMemoryLogAdapter } from '../logger/storageAdapter.js';
import type { LogEntry } from '../logger/types.js';

function makeEntry(id: string): LogEntry {
  return { id, timestamp: Date.now(), type: 'INFO', message: id };
}

describe('InMemoryLogAdapter', () => {
  it('appends, loads, and prunes by retention', async () => {
    const adapter = new InMemoryLogAdapter();
    const old = makeEntry('old');
    old.timestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    await adapter.append([old, makeEntry('new')]);
    const loaded = await adapter.load();
    expect(loaded.map((e) => e.id)).toEqual(['new']); // old pruned by retention
  });

  it('clears all', async () => {
    const adapter = new InMemoryLogAdapter();
    await adapter.append([makeEntry('a')]);
    await adapter.clear();
    expect(await adapter.load()).toEqual([]);
  });
});
