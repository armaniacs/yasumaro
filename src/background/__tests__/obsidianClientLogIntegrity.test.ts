/**
 * Integration: an Obsidian error body containing newlines / control chars is
 * single-lined by the logger persistence boundary before it is stored
 * (VULN-044, transitive fix via logger neutralization).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObsidianClient } from '../obsidianClient.js';
import { getLogs, clearLogs, flushLogs } from '../../utils/logger/core.js';
import { fetchWithTimeout } from '../../utils/fetch.js';

vi.mock('../../utils/fetch.js', () => ({
  fetchWithTimeout: vi.fn(),
  CONNECTION_TEST_CACHE_MODE: 'no-cache',
}));

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

describe('ObsidianClient error path × logger', () => {
  it('persists a forged multi-line error body as a single log line', async () => {
    const client = new ObsidianClient();
    const forgedBody = `500 Internal Error\n[Logger:ERROR] fake entry injected${NUL}`;

    const response = {
      ok: false,
      status: 500,
      text: async () => forgedBody,
      headers: { get: () => null },
    } as unknown as Response;
    vi.mocked(fetchWithTimeout).mockResolvedValue(response);

    await expect(
      client._writeContent('https://127.0.0.1:27124/note.md', {}, 'body', 'trace-1'),
    ).rejects.toThrow();
    await flushLogs(true);

    const entry = (await getLogs()).find((l) => l.message.includes('Obsidian API Error'));
    expect(entry).toBeDefined();
    expect(entry?.message).not.toContain('\n');
    expect(entry?.message).not.toContain(NUL);
    expect(entry?.message).toContain('[Logger:ERROR] fake entry injected');
  });
});
