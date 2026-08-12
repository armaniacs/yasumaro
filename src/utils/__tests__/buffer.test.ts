import { LogBuffer } from '../logger/buffer.js';
import type { LogEntry } from '../logger/types.js';

function makeEntry(id: string): LogEntry {
  return { id, timestamp: Date.now(), type: 'INFO', message: id };
}

describe('LogBuffer', () => {
  it('pushes and drains entries', () => {
    const buf = new LogBuffer(10);
    buf.push(makeEntry('a'));
    buf.push(makeEntry('b'));
    expect(buf.size()).toBe(2);
    const drained = buf.drain();
    expect(drained.map(e => e.id)).toEqual(['a', 'b']);
    expect(buf.size()).toBe(0);
  });

  it('drops oldest when over capacity', () => {
    const buf = new LogBuffer(2);
    buf.push(makeEntry('a'));
    buf.push(makeEntry('b'));
    buf.push(makeEntry('c'));
    expect(buf.size()).toBe(2);
    expect(buf.drain().map(e => e.id)).toEqual(['b', 'c']);
  });

  it('clear empties the buffer', () => {
    const buf = new LogBuffer(5);
    buf.push(makeEntry('a'));
    buf.clear();
    expect(buf.size()).toBe(0);
  });
});
