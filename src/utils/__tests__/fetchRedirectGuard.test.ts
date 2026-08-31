import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('../logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logger.js')>();
  return {
    ...actual,
    logDebug: vi.fn().mockResolvedValue(undefined),
    logWarn: vi.fn().mockResolvedValue(undefined),
  };
});

import { fetchWithRedirectGuard } from '../fetch.js';

function makeResponse(init: {
  status: number;
  location?: string | null;
  url?: string;
  body?: string;
}): Response {
  const headers = new Map<string, string>();
  if (init.location != null) {
    headers.set('location', init.location);
  }
  return {
    status: init.status,
    url: init.url ?? '',
    redirected: false,
    ok: init.status >= 200 && init.status < 300,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    text: vi.fn().mockResolvedValue(init.body ?? ''),
  } as unknown as Response;
}

describe('fetchWithRedirectGuard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response when there is no redirect', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 200, url: 'https://example.com/list.txt', body: 'ok' }),
    );

    const res = await fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it('follows a same-origin http->https upgrade redirect after re-validation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({ status: 301, location: 'https://example.com/list.txt' }),
      )
      .mockResolvedValueOnce(makeResponse({ status: 200, body: 'upgraded' }));

    const res = await fetchWithRedirectGuard('http://example.com/list.txt', { method: 'GET' });
    expect(await res.text()).toBe('upgraded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/list.txt');
  });

  it('follows a redirect that changes port on a public host', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({ status: 302, location: 'https://example.com:8443/list.txt' }),
      )
      .mockResolvedValueOnce(makeResponse({ status: 200, body: 'port-changed' }));

    const res = await fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' });
    expect(await res.text()).toBe('port-changed');
  });

  it('resolves a relative Location against the current hop URL', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({ status: 302, location: '/mirror/list.txt' }))
      .mockResolvedValueOnce(makeResponse({ status: 200, body: 'relative-ok' }));

    const res = await fetchWithRedirectGuard('https://example.com/a/b.txt', { method: 'GET' });
    expect(await res.text()).toBe('relative-ok');
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/mirror/list.txt');
  });

  it('rejects a redirect to 127.0.0.1', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 302, location: 'http://127.0.0.1:9222/json' }),
    );

    await expect(
      fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' }),
    ).rejects.toThrow(/private|redirect/i);
  });

  it('rejects a redirect to a private 10.x address', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 301, location: 'http://10.0.0.5/secret' }),
    );

    await expect(
      fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' }),
    ).rejects.toThrow(/private/i);
  });

  it('rejects a redirect to link-local cloud metadata 169.254.169.254', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }),
    );

    await expect(
      fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' }),
    ).rejects.toThrow(/private/i);
  });

  it('rejects a redirect to localhost by name', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 302, location: 'http://localhost:9222/json' }),
    );

    await expect(
      fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' }),
    ).rejects.toThrow(/localhost/i);
  });

  it('rejects a redirect response with a missing Location header', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 302, location: null }));

    await expect(
      fetchWithRedirectGuard('https://example.com/list.txt', { method: 'GET' }),
    ).rejects.toThrow(/location/i);
  });

  it('rejects when the redirect chain exceeds the hop limit (loop)', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 302, location: 'https://example.com/loop' }),
    );

    await expect(
      fetchWithRedirectGuard('https://example.com/loop', { method: 'GET' }),
    ).rejects.toThrow(/too many redirects/i);
  });
});
