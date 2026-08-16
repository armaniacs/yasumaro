// @vitest-environment jsdom
//
// Task 5: verify the SQLITE_SEARCH dispatcher forwards orderBy/orderDir from
// msg.payload into recordsRepo's search() 4th `options` param. The main
// offscreen-sqlite.test.ts suite exercises the real recordsRepo.ts against a
// failing engine init, so backend.search() is never reached there and
// forwarding can't be observed. This file mocks recordsRepo.js directly to
// assert the call arguments, following the same handleOffscreenMessage
// dispatch pattern as the rest of the suite.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: vi.fn(),
  search: searchMock,
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

describe('handleOffscreenMessage - SQLITE_SEARCH forwards orderBy/orderDir', () => {
  beforeEach(() => {
    searchMock.mockClear();
  });

  it('forwards orderBy/orderDir from msg.payload into recordsRepo.search()', async () => {
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

    expect(searchMock).toHaveBeenCalledWith('test query', 20, 5, {
      orderBy: 'created_at',
      orderDir: 'ASC',
    });
  });

  it('forwards undefined orderBy/orderDir when absent from msg.payload', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_SEARCH', { query: 'test query' }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));

    expect(searchMock).toHaveBeenCalledWith('test query', 50, 0, {
      orderBy: undefined,
      orderDir: undefined,
    });
  });
});
