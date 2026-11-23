/**
 * Conditional write wiring: ETag detected on the GET is sent as If-Match on the
 * PUT; absence or weakness of the ETag keeps the unconditional write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObsidianClient } from '../obsidianClient.js';
import { resolveFailure } from '../../utils/failureTaxonomy.js';
import type { ObsidianConfig } from '../../utils/obsidianConfigBuilder.js';

type Init = { method?: string; headers?: HeadersInit };

function textBody(text: string) {
  let sent = false;
  return {
    getReader: () => ({
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (sent) return Promise.resolve({ done: true });
        sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(text) });
      },
      cancel: async () => {},
    }),
  };
}

function response(status: number, etag: string | null, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    body: textBody(body),
    headers: { get: (n: string) => (n.toLowerCase() === 'etag' ? etag : null) },
  } as unknown as Response;
}

function createClient(): ObsidianClient {
  const config = {
    baseUrl: 'http://127.0.0.1:27123',
    headers: { Authorization: 'Bearer k' },
    settings: { OBSIDIAN_DAILY_PATH: '' },
  } as unknown as ObsidianConfig;
  return new ObsidianClient({ configReader: async () => config });
}

function putCalls(fetchMock: ReturnType<typeof vi.fn>): Init[] {
  return (fetchMock.mock.calls as [string, Init][]).map(([, init]) => init).filter((i) => i.method === 'PUT');
}

function ifMatchOf(init: Init): string | null {
  return new Headers(init.headers).get('If-Match');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('ObsidianClient conditional write', () => {
  describe('appendToDailyNote', () => {
    it.each([
      ['strong ETag', '"v1"', '"v1"'],
      ['weak ETag', 'W/"v1"', null],
      ['no ETag', null, null],
    ])('sends If-Match for %s as %s', async (_label, etag, expected) => {
      fetchMock.mockImplementation((_u: string, init: Init) =>
        Promise.resolve(init.method === 'GET' ? response(200, etag, '# note') : response(204, null)),
      );

      await createClient().appendToDailyNote('line');

      const puts = putCalls(fetchMock);
      expect(puts).toHaveLength(1);
      expect(ifMatchOf(puts[0]!)).toBe(expected);
    });

    it('does not send If-Match for a new note (404 on GET)', async () => {
      fetchMock.mockImplementation((_u: string, init: Init) =>
        Promise.resolve(init.method === 'GET' ? response(404, null) : response(204, null)),
      );

      await createClient().appendToDailyNote('line');

      expect(ifMatchOf(putCalls(fetchMock)[0]!)).toBeNull();
    });

    it('surfaces a 412 as a structured PUT conflict without resending in place', async () => {
      fetchMock.mockImplementation((_u: string, init: Init) =>
        Promise.resolve(init.method === 'GET' ? response(200, '"v1"', 'x') : response(412, null, 'precondition')),
      );

      const error = await createClient().appendToDailyNote('line').catch((e: unknown) => e);

      expect(resolveFailure(error)).toMatchObject({ kind: 'http', status: 412, method: 'PUT' });
      expect(putCalls(fetchMock)).toHaveLength(1);
    });
  });
});
