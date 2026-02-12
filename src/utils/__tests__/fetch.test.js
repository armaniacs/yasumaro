import { fetchWithTimeout, isUrlAllowed } from '../fetch.js';
import { normalizeUrl } from '../urlUtils.js';

describe('fetchWithTimeout', () => {
  test('正常レスポンスを返す', async () => {
    const mockResponse = { ok: true };
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    const response = await fetchWithTimeout('https://example.com', {}, 1000);
    expect(response.ok).toBe(true);
  });

  test('成功率ンスでタイマーをクリアする', async () => {
    let clearTimeoutCalled = false;
    const originalClearTimeout = global.clearTimeout;

    global.clearTimeout = jest.fn(() => {
      clearTimeoutCalled = true;
    });

    try {
      const mockResponse = { ok: true };
      global.fetch = jest.fn(() => Promise.resolve(mockResponse));

      const response = await fetchWithTimeout('https://example.com', {}, 1000);
      expect(response.ok).toBe(true);
      expect(clearTimeoutCalled).toBe(true);
    } finally {
      global.clearTimeout = originalClearTimeout;
    }
  });

  test('fetchエラーをスローする', async () => {
    const testError = new Error('Network error');
    global.fetch = jest.fn(() => Promise.reject(testError));

    await expect(fetchWithTimeout('https://example.com', {}, 1000))
      .rejects.toBe(testError);
  });

  test('デフォルトのタイムアウトは30000ms', async () => {
    const mockResponse = { ok: true };
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    let actualTimeout = 0;
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = jest.fn((callback, ms) => {
      actualTimeout = ms;
      return 999;
    });

    try {
      const response = await fetchWithTimeout('https://example.com');
      expect(actualTimeout).toBe(30000);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  test('カスタムタイムアウトを設定できる', async () => {
    const mockResponse = { ok: true };
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    let actualTimeout = 0;
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = jest.fn((callback, ms) => {
      actualTimeout = ms;
      return 999;
    });

    try {
      const response = await fetchWithTimeout('https://example.com', {}, 5000);
      expect(actualTimeout).toBe(5000);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });
});

describe('normalizeUrl', () => {
  test('末尾のスラッシュを削除する', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  test('プロトコルを小文字に正規化する', () => {
    expect(normalizeUrl('HTTPS://example.com')).toBe('https://example.com');
    expect(normalizeUrl('HTTP://example.com')).toBe('http://example.com');
  });

  test('無効なURLの場合はそのまま返す', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('isUrlAllowed', () => {
  test('完全一致で許可されたURLを判定する', () => {
    const allowedUrls = new Set(['https://example.com', 'https://api.example.com']);
    expect(isUrlAllowed('https://example.com', allowedUrls)).toBe(true);
    expect(isUrlAllowed('https://api.example.com', allowedUrls)).toBe(true);
  });

  test('プレフィックス一致でサブパスを許可する', () => {
    const allowedUrls = new Set(['https://example.com']);
    expect(isUrlAllowed('https://example.com/path', allowedUrls)).toBe(true);
    expect(isUrlAllowed('https://example.com/path/to/resource', allowedUrls)).toBe(true);
  });

  test('許可されていないURLを拒否する', () => {
    const allowedUrls = new Set(['https://example.com']);
    expect(isUrlAllowed('https://other.com', allowedUrls)).toBe(false);
    expect(isUrlAllowed('https://example.org', allowedUrls)).toBe(false);
  });

  test('許可されたURLのリストがない場合は検証をスキップする', () => {
    expect(isUrlAllowed('https://example.com', null)).toBe(true);
    expect(isUrlAllowed('https://example.com', new Set())).toBe(true);
  });

  test('URLの正規化を考慮して判定する', () => {
    const allowedUrls = new Set(['https://example.com']);
    expect(isUrlAllowed('https://example.com/', allowedUrls)).toBe(true);
    expect(isUrlAllowed('HTTPS://example.com', allowedUrls)).toBe(true);
  });
});