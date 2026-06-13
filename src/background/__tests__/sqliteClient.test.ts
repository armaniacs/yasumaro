import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteClient } from '../sqliteClient.js';

describe('SqliteClient', () => {
  let client: SqliteClient;
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let hasDocumentMock: ReturnType<typeof vi.fn>;
  let createDocumentMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageMock = vi.fn();
    hasDocumentMock = vi.fn().mockResolvedValue(true);
    createDocumentMock = vi.fn().mockResolvedValue(undefined);

    // Mock chrome API
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: sendMessageMock,
        lastError: undefined,
      },
      offscreen: {
        hasDocument: hasDocumentMock,
        createDocument: createDocumentMock,
        Reason: {
          WORKERS: 'WORKERS',
        },
      },
    };

    client = new SqliteClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('sends SQLITE_INIT message to offscreen', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, initialized: true });
        }
      );

      const result = await client.init();
      expect(result).toBe(true);
      expect(sendMessageMock).toHaveBeenCalledWith(
        { type: 'SQLITE_INIT', target: 'offscreen', payload: {} },
        expect.any(Function)
      );
    });

    it('returns false when init fails', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: false, error: 'Init failed' });
        }
      );

      const result = await client.init();
      expect(result).toBe(false);
    });

    // Timeout test omitted: the msgOffscreen timeout is 10s which makes
    // this test impractical without complex timer mocking. The error handling
    // path is exercised by the 'returns false when init fails' test above.
  });

  describe('insert', () => {
    it('sends SQLITE_INSERT message with record data', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, id: 42 });
        }
      );

      const record = {
        url: 'https://example.com',
        title: 'Example Page',
        summary: 'A test summary',
        created_at: Date.now(),
      };

      const result = await client.insert(record);
      expect(result).toEqual({ id: 42 });
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_INSERT',
          target: 'offscreen',
          payload: record,
        }),
        expect.any(Function)
      );
    });

    it('returns null when insert fails', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: false, error: 'Insert failed' });
        }
      );

      const result = await client.insert({
        url: 'https://example.com',
        created_at: Date.now(),
      });
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('sends SQLITE_QUERY message with options', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({
            success: true,
            rows: [{ id: 1, url: 'https://example.com', title: 'Test' }],
            total: 1,
          });
        }
      );

      const result = await client.query({ limit: 10, offset: 0 });
      expect(result).not.toBeNull();
      expect(result!.rows).toHaveLength(1);
      expect(result!.total).toBe(1);
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_QUERY',
          payload: { limit: 10, offset: 0 },
        }),
        expect.any(Function)
      );
    });
  });

  describe('search', () => {
    it('sends SQLITE_SEARCH message with query', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({
            success: true,
            rows: [],
            total: 0,
          });
        }
      );

      const result = await client.search('typescript', 20, 0);
      expect(result).not.toBeNull();
      expect(result!.total).toBe(0);
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_SEARCH',
          payload: { query: 'typescript', limit: 20, offset: 0 },
        }),
        expect.any(Function)
      );
    });
  });

  describe('update', () => {
    it('sends SQLITE_UPDATE message with id and changes', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true });
        }
      );

      const result = await client.update(1, { title: 'Updated Title' });
      expect(result).toBe(true);
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_UPDATE',
          payload: { id: 1, title: 'Updated Title' },
        }),
        expect.any(Function)
      );
    });
  });

  describe('delete', () => {
    it('sends SQLITE_DELETE message with id', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true });
        }
      );

      const result = await client.delete(1);
      expect(result).toBe(true);
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_DELETE',
          payload: { id: 1 },
        }),
        expect.any(Function)
      );
    });
  });

  describe('toggleStar', () => {
    it('sends SQLITE_TOGGLE_STAR message with id', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, is_starred: 1 });
        }
      );

      const result = await client.toggleStar(1);
      expect(result).toEqual({ is_starred: 1 });
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SQLITE_TOGGLE_STAR',
          payload: { id: 1 },
        }),
        expect.any(Function)
      );
    });
  });

  describe('getCount', () => {
    it('sends SQLITE_COUNT message', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, count: 42 });
        }
      );

      const result = await client.getCount();
      expect(result).toBe(42);
      expect(sendMessageMock).toHaveBeenCalledWith(
        { type: 'SQLITE_COUNT', target: 'offscreen', payload: {} },
        expect.any(Function)
      );
    });
  });

  describe('getStatus', () => {
    it('sends SQLITE_STATUS message', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, initialized: true, path: 'yasumaro.db', fallback: false });
        }
      );

      const result = await client.getStatus();
      expect(result).toEqual({ initialized: true, path: 'yasumaro.db', fallback: false });
    });
  });

  describe('msgOffscreen — timeout lifecycle (H1)', () => {
    let h1Client: SqliteClient;

    beforeEach(() => {
      h1Client = new SqliteClient();
      (h1Client as unknown as { offscreenAlive: boolean }).offscreenAlive = true;
    });

    it('clears the timeout when a response arrives before expiry', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          setTimeout(() => callback({ success: true, rows: [], total: 0 }), 10);
        }
      );
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const result = await h1Client.msgOffscreen('SQLITE_STATUS');
      expect(result).toEqual({ success: true, rows: [], total: 0 });
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('rejects the promise on timeout (not double-resolution)', async () => {
      sendMessageMock.mockImplementation(
        (_msg: unknown, _callback: (response: unknown) => void) => {
          // never invoke callback
        }
      );

      // Shrink the 10s timeout so the test runs fast
      const originalSetTimeout = globalThis.setTimeout;
      const setTimeoutSpy = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((cb: () => void, ms?: number, ...args: unknown[]) => {
          if (ms === 10000) {
            return originalSetTimeout(cb, 50, ...args) as unknown as ReturnType<typeof setTimeout>;
          }
          return originalSetTimeout(cb, ms as number, ...args) as unknown as ReturnType<typeof setTimeout>;
        });

      await expect(h1Client.msgOffscreen('SQLITE_STATUS')).rejects.toThrow(/timed out/);

      setTimeoutSpy.mockRestore();
    });
  });

  describe('offscreen document management', () => {
    it('creates offscreen document if not already present', async () => {
      hasDocumentMock.mockResolvedValue(false);
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true });
        }
      );

      await client.init();

      expect(hasDocumentMock).toHaveBeenCalled();
      expect(createDocumentMock).toHaveBeenCalledWith({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: expect.any(String),
      });
    });

    it('skips creating offscreen document if already present', async () => {
      hasDocumentMock.mockResolvedValue(true);
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true });
        }
      );

      await client.init();

      expect(hasDocumentMock).toHaveBeenCalled();
      expect(createDocumentMock).not.toHaveBeenCalled();
    });
  });
});
