// @vitest-environment jsdom
//
// Verify that SQLITE_SEARCH dispatches through the unified recordsRepo.query()
// with a StorageQuery containing text, and SQLITE_QUERY passes through
// without text.  Both message types now route to the same query(q: StorageQuery)
// in recordsRepo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: queryMock,
  update: vi.fn(),
  hardDelete: vi.fn(),
  toggleStar: vi.fn(),
  getCount: vi.fn(),
  getStatus: vi.fn(),
  serialize: vi.fn(),
  clearAll: vi.fn(),
}));

import { handleOffscreenMessage } from '../offscreen.js';

const EXTENSION_ID = 'test-extension-id';

if (!(globalThis as Record<string, unknown>).chrome) {
  (globalThis as Record<string, unknown>).chrome = {};
}
const g = globalThis as Record<string, unknown>;
if (!(g.chrome as Record<string, unknown>).runtime) {
  (g.chrome as Record<string, unknown>).runtime = {};
}
(g.chrome as Record<string, Record<string, unknown>>).runtime.id = EXTENSION_ID;

function makeMessage(type: string, payload?: Record<string, unknown>) {
  return { target: 'offscreen', type, payload };
}

function makeSenderNoTab() {
  return { id: EXTENSION_ID } as chrome.runtime.MessageSender;
}

describe('handleOffscreenMessage - SQLITE_SEARCH forwards to unified query()', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('SQLITE_SEARCH converts payload to StorageQuery and calls recordsRepo.query()', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_SEARCH', {
        query: 'test query',
        limit: 20,
        offset: 5,
        orderBy: 'created_at',
        orderDir: 'ASC',
      }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));

    expect(queryMock).toHaveBeenCalledWith({
      text: 'test query',
      limit: 20,
      offset: 5,
      orderBy: 'created_at',
      orderDir: 'ASC',
    });
  });

  it('SQLITE_SEARCH handles absent orderBy/orderDir', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_SEARCH', { query: 'test query' }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));

    expect(queryMock).toHaveBeenCalledWith({
      text: 'test query',
      limit: undefined,
      offset: undefined,
      orderBy: undefined,
      orderDir: undefined,
    });
  });

  it('SQLITE_QUERY forwards StorageQuery fields', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_QUERY', {
        limit: 30,
        offset: 10,
        domain: 'example.com',
        orderBy: 'created_at',
        orderDir: 'DESC',
      }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));

    expect(queryMock).toHaveBeenCalledWith({
      limit: 30,
      offset: 10,
      domain: 'example.com',
      orderBy: 'created_at',
      orderDir: 'DESC',
      starred: undefined,
      excludeDeleted: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      ids: undefined,
      tag: undefined,
      gistSynced: undefined,
      text: undefined,
    });
  });
});
