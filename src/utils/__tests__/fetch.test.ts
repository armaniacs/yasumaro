import { fetchWithTimeout, isUrlAllowed, isPrivateIpAddress, validateUrlForFilterImport, validateUrlForAIRequests, fetchWithRetry } from '../fetch.js';
import { normalizeUrl } from '../urlUtils.js';

// Mock dependencies
jest.mock('../cspValidator.js', () => ({
  CSPValidator: {
    isInitialized: jest.fn(() => false),
    initializeFromSettings: jest.fn(),
    isUrlAllowed: jest.fn(() => true),
  },
  getCspErrorMessage: jest.fn(() => null),
}));

jest.mock('../storage.js', () => ({
  getSettings: jest.fn(async () => ({
    conditional_csp_enabled: true,
  })),
  StorageKeys: {
    CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
  },
}));

jest.mock('../logger.js', () => ({
  logDebug: jest.fn(),
  logWarn: jest.fn(),
}));

describe('fetchWithTimeout', () => {
  test('正常レスポンスを返す', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    const response = await fetchWithTimeout('https://example.com', { skipCspValidation: true }, 1000);
    expect(response.ok).toBe(true);
  });

  test('成功率ンスでタイマーをクリアする', async () => {
    let clearTimeoutCalled = false;
    const originalClearTimeout = global.clearTimeout;

    global.clearTimeout = jest.fn(() => {
      clearTimeoutCalled = true;
    });

    try {
      const mockResponse = { ok: true } as Response;
      global.fetch = jest.fn(() => Promise.resolve(mockResponse));

      const response = await fetchWithTimeout('https://example.com', { skipCspValidation: true }, 1000);
      expect(response.ok).toBe(true);
      expect(clearTimeoutCalled).toBe(true);
    } finally {
      global.clearTimeout = originalClearTimeout;
    }
  });

  test('fetchエラーをスローする', async () => {
    const testError = new Error('Network error');
    global.fetch = jest.fn(() => Promise.reject(testError));

    await expect(fetchWithTimeout('https://example.com', { skipCspValidation: true }, 1000))
      .rejects.toBe(testError);
  });

  test('デフォルトのタイムアウトは30000ms', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    let actualTimeout = 0;
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = jest.fn((callback, ms) => {
      actualTimeout = ms;
      return 999 as unknown as NodeJS.Timeout;
    });

    try {
      const response = await fetchWithTimeout('https://example.com', { skipCspValidation: true });
      expect(actualTimeout).toBe(30000);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  test('カスタムタイムアウトを設定できる', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    let actualTimeout = 0;
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = jest.fn((callback, ms) => {
      actualTimeout = ms;
      return 999 as unknown as NodeJS.Timeout;
    });

    try {
      const response = await fetchWithTimeout('https://example.com', { skipCspValidation: true }, 5000);
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

  test('無効なURLの場合はエラーを投げる', () => {
    expect(() => normalizeUrl('not-a-url')).toThrow('Invalid URL');
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

  test('無効なURLの場合はfalseを返す', () => {
    const allowedUrls = new Set(['https://example.com']);
    expect(isUrlAllowed('not-a-url', allowedUrls)).toBe(false);
    expect(isUrlAllowed('javascript:alert(1)', allowedUrls)).toBe(false);
    expect(isUrlAllowed('data:text/html,<script>alert(1)</script>', allowedUrls)).toBe(false);
  });
});

// タスク #10: IPv4アドレス検証の脆弱性修正に関するテスト
describe('isPrivateIpAddress', () => {
  describe('有効なプライベートIPv4アドレス', () => {
    test('10.x.x.x (10.0.0.0/8) を検出する', () => {
      expect(isPrivateIpAddress('10.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('10.255.255.254')).toBe(true);
      expect(isPrivateIpAddress('10.123.45.67')).toBe(true);
    });

    test('172.16.x.x - 172.31.x.x (172.16.0.0/12) を検出する', () => {
      expect(isPrivateIpAddress('172.16.0.1')).toBe(true);
      expect(isPrivateIpAddress('172.31.255.254')).toBe(true);
      expect(isPrivateIpAddress('172.20.123.45')).toBe(true);
      // 範囲外は検出しない
      expect(isPrivateIpAddress('172.15.255.255')).toBe(false);
      expect(isPrivateIpAddress('172.32.0.1')).toBe(false);
    });

    test('192.168.x.x (192.168.0.0/16) を検出する', () => {
      expect(isPrivateIpAddress('192.168.0.1')).toBe(true);
      expect(isPrivateIpAddress('192.168.255.254')).toBe(true);
      expect(isPrivateIpAddress('192.168.1.1')).toBe(true);
    });

    test('127.x.x.x (ループバック) を検出する', () => {
      expect(isPrivateIpAddress('127.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('127.255.255.255')).toBe(true);
      expect(isPrivateIpAddress('127.0.0.5')).toBe(true);
    });

    test('169.254.x.x (リンクローカル) を検出する', () => {
      expect(isPrivateIpAddress('169.254.0.1')).toBe(true);
      expect(isPrivateIpAddress('169.254.255.254')).toBe(true);
      expect(isPrivateIpAddress('169.254.169.254')).toBe(true); // AWSメタデータエンドポイント
    });
  });

  describe('有効なパブリックIPv4アドレス', () => {
    test('8.8.8.8 (Google DNS) はパブリック', () => {
      expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
    });

    test('1.1.1.1 (Cloudflare DNS) はパブリック', () => {
      expect(isPrivateIpAddress('1.1.1.1')).toBe(false);
    });

    test('172.15.x.x はパブリック', () => {
      expect(isPrivateIpAddress('172.15.0.1')).toBe(false);
    });

    test('172.32.x.x はパブリック', () => {
      expect(isPrivateIpAddress('172.32.0.1')).toBe(false);
    });

    test('192.169.x.x はパブリック', () => {
      expect(isPrivateIpAddress('192.169.0.1')).toBe(false);
    });

    test('169.255.x.x はパブリック', () => {
      expect(isPrivateIpAddress('169.255.0.1')).toBe(false);
    });
  });

  describe('タスク #10: 無効なIPv4アドレス（0-255範囲外）', () => {
    test('999.999.999.999 は無効なIPv4として扱われプライベートではない', () => {
      // 各オクテットが255を超えるため、無効なIPv4として扱われる
      expect(isPrivateIpAddress('999.999.999.999')).toBe(false);
    });

    test('300.1.1.1 は無効なIPv4として扱われる', () => {
      expect(isPrivateIpAddress('300.1.1.1')).toBe(false);
    });

    test('256.0.0.0 は無効なIPv4として扱われる', () => {
      expect(isPrivateIpAddress('256.0.0.0')).toBe(false);
    });

    test('10.256.1.1 は無効なIPv4として扱われる', () => {
      expect(isPrivateIpAddress('10.256.1.1')).toBe(false);
    });

    test('192.168.300.1 は無効なIPv4として扱われる', () => {
      expect(isPrivateIpAddress('192.168.300.1')).toBe(false);
    });

    test('負の値を含むIPは無効として扱われる', () => {
      // -1 を含む正規表現マッチは発生しないが、念のため
      expect(isPrivateIpAddress('-1.0.0.0')).toBe(false);
    });
  });

  describe('IPv6アドレス', () => {
    test('::1 (IPv6 localhost) を検出する', () => {
      expect(isPrivateIpAddress('::1')).toBe(true);
    });

    test('::ffff:127.0.0.1 (IPv4-mapped IPv6 localhost) を検出する', () => {
      expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('::ffff:127.0.0.5')).toBe(true);
    });

    test('fe80::1 (リンクローカル) を検出する', () => {
      expect(isPrivateIpAddress('fe80::1')).toBe(true);
      expect(isPrivateIpAddress('fe80::abcd:ef12')).toBe(true);
    });

    test('パブリックIPv6アドレスは検出しない', () => {
      expect(isPrivateIpAddress('2001:4860:4860::8888')).toBe(false);
    });
  });

  describe('ドメイン名', () => {
    test('example.com はIPアドレスではない', () => {
      expect(isPrivateIpAddress('example.com')).toBe(false);
    });

    test('localhost はIPv6形式のマッチには一致しない', () => {
      // 注: localhost は別途ドメイン形式でチェックされる
      expect(isPrivateIpAddress('localhost')).toBe(false);
    });
  });
});

describe('validateUrlForFilterImport', () => {
  test('プライベートIPアドレスをブロックする（タスク #10修正）', () => {
    expect(() => validateUrlForFilterImport('http://10.0.0.1/filters.txt'))
      .toThrow('Access to private network address is not allowed');
    expect(() => validateUrlForFilterImport('http://192.168.1.1/filters.txt'))
      .toThrow('Access to private network address is not allowed');
  });

  test('無効なIPアドレスを含むURLは通常のURLとして扱う（タスク #10修正：エラーにならない）', () => {
    // 999.999.999.999などはisPrivateIpAddressでfalseを返すため、
    // validateUrlForFilterImportはプライベートIPチェックをスルーする
    // URLが有効であればエラーにはならないはずだが、
    // 999.999.999.999は無効なホスト名なのでnew URL()でエラーになる
    expect(() => validateUrlForFilterImport('http://999.999.999.999/filters.txt'))
      .toThrow(); // 無効なホスト名なのでURLパースエラー
  });

  test('localhostをブロックする', () => {
    expect(() => validateUrlForFilterImport('http://localhost/filters.txt'))
      .toThrow('Access to localhost is not allowed for filter imports');
    expect(() => validateUrlForFilterImport('http://my.localhost/filters.txt'))
      .toThrow('Access to localhost is not allowed for filter imports');
  });

  test('パブリックURLを許可する', () => {
    expect(() => validateUrlForFilterImport('https://example.com/filters.txt'))
      .not.toThrow();
    expect(() => validateUrlForFilterImport('https://raw.githubusercontent.com/user/repo/main/filters.txt'))
      .not.toThrow();
  });

  test('不支持的プロトコルをブロックする', () => {
    expect(() => validateUrlForFilterImport('ftp://example.com/filters.txt'))
      .toThrow('Unsupported protocol');
  });
});

describe('validateUrlForAIRequests', () => {
  test('プライベートIPアドレスをブロックする（タスク #10修正）', () => {
    expect(() => validateUrlForAIRequests('http://10.0.0.1/api'))
      .toThrow('Access to private network address is not allowed');
    expect(() => validateUrlForAIRequests('https://172.16.0.1/v1/chat'))
      .toThrow('Access to private network address is not allowed');
  });

  test('パブリックAIプロバイダーURLを許可する', () => {
    expect(() => validateUrlForAIRequests('https://api.openai.com/v1/chat'))
      .not.toThrow();
    expect(() => validateUrlForAIRequests('https://groq.com/openai/v1'))
      .not.toThrow();
  });

  test('localhostを許可する（開発環境用）', () => {
    expect(() => validateUrlForAIRequests('http://localhost:11434/api'))
      .not.toThrow();
  });
});

describe('fetchWithRetry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('初回成功でレスポンスを返す', async () => {
    const mockResponse = { ok: true, status: 200, statusText: 'OK' } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    const response = await fetchWithRetry('https://example.com/api', { skipCspValidation: true });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test('HTTPエラーでリトライして最終的にthrowする', async () => {
    const mockResponse = { ok: false, status: 500, statusText: 'Internal Server Error' } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    await expect(
      fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
        maxRetryCount: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('HTTP 500');
  });

  test('ネットワークエラーでリトライして最終的にthrowする', async () => {
    const testError = new Error('Network failure');
    global.fetch = jest.fn(() => Promise.reject(testError));

    await expect(
      fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
        maxRetryCount: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('Network failure');
  });

  test('リトライ後に成功する', async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.reject(new Error('Temporary failure'));
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK' } as Response);
    });

    const response = await fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
      maxRetryCount: 3,
      initialDelayMs: 10,
      maxDelayMs: 50,
      shouldRetry: () => true,
    });

    expect(response.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  test('shouldRetry=false でリトライしない', async () => {
    const testError = new Error('Fatal error');
    global.fetch = jest.fn(() => Promise.reject(testError));

    await expect(
      fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
        maxRetryCount: 3,
        initialDelayMs: 10,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('Fatal error');

    // shouldRetry=false なので初回のみ呼び出し
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('maxRetryCount=0 でリトライしない', async () => {
    const mockResponse = { ok: false, status: 404, statusText: 'Not Found' } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    await expect(
      fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
        maxRetryCount: 0,
      })
    ).rejects.toThrow('HTTP 404');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('429 Too Many Requestsでリトライする', async () => {
    const mockResponse = { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    await expect(
      fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
        maxRetryCount: 1,
        initialDelayMs: 10,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('HTTP 429');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('リトライ成功時にデバッグログが出力される', async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.reject(new Error('Temporary failure'));
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK' } as Response);
    });

    const { logDebug } = require('../logger.js');

    const response = await fetchWithRetry('https://example.com/api', { skipCspValidation: true }, {
      maxRetryCount: 3,
      initialDelayMs: 10,
      maxDelayMs: 50,
      shouldRetry: () => true,
    });

    expect(response.ok).toBe(true);
    expect(logDebug).toHaveBeenCalled();
  });
});

describe('fetchWithTimeout - validateUrl edge cases', () => {
  test('無効なURLでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('not-a-url', { skipCspValidation: true }, 1000)
    ).rejects.toThrow('Invalid URL');
  });

  test('サポートされていないプロトコルでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('ftp://example.com', { skipCspValidation: true }, 1000)
    ).rejects.toThrow('Unsupported protocol');
  });

  test('httpプロトコルを許可する', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    const response = await fetchWithTimeout('http://example.com', { skipCspValidation: true }, 1000);
    expect(response.ok).toBe(true);
  });
});

describe('fetchWithTimeout - validateTimeout', () => {
  test('数値以外のタイムアウトでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('https://example.com', { skipCspValidation: true }, 'abc' as any)
    ).rejects.toThrow('Timeout must be a number');
  });

  test('無限大のタイムアウトでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('https://example.com', { skipCspValidation: true }, Infinity)
    ).rejects.toThrow('Timeout must be a finite number');
  });

  test('最小値未満のタイムアウトでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('https://example.com', { skipCspValidation: true }, 50)
    ).rejects.toThrow('Timeout must be at least 100ms');
  });

  test('最大値を超えるタイムアウトでエラーを投げる', async () => {
    await expect(
      fetchWithTimeout('https://example.com', { skipCspValidation: true }, 400000)
    ).rejects.toThrow('Timeout must not exceed 300000ms');
  });
});

describe('fetchWithTimeout - AbortError', () => {
  test('AbortErrorでユーザーフレンドリーなエラーメッセージを返す', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    global.fetch = jest.fn(() => Promise.reject(abortError));

    await expect(
      fetchWithTimeout('https://example.com', { skipCspValidation: true }, 1000)
    ).rejects.toThrow('Request timed out');
  });
});

describe('fetchWithTimeout - CSP validation', () => {
  test('CSP検証が有効な場合にURLを検証する', async () => {
    const { CSPValidator, getCspErrorMessage } = require('../cspValidator.js');
    const { getSettings } = require('../storage.js');

    getSettings.mockResolvedValueOnce({ conditional_csp_enabled: true });
    CSPValidator.isInitialized.mockReturnValueOnce(false);
    CSPValidator.isUrlAllowed.mockReturnValueOnce(false);
    getCspErrorMessage.mockReturnValueOnce('CSP blocked');

    await expect(
      fetchWithTimeout('https://blocked.example.com/api', {}, 1000)
    ).rejects.toThrow('CSP blocked');
  });

  test('CSPエラーメッセージがない場合は汎用エラーを返す', async () => {
    const { CSPValidator, getCspErrorMessage } = require('../cspValidator.js');
    const { getSettings } = require('../storage.js');

    getSettings.mockResolvedValueOnce({ conditional_csp_enabled: true });
    CSPValidator.isInitialized.mockReturnValueOnce(true);
    CSPValidator.isUrlAllowed.mockReturnValueOnce(false);
    getCspErrorMessage.mockReturnValueOnce(null);

    await expect(
      fetchWithTimeout('https://blocked.example.com/api', {}, 1000)
    ).rejects.toThrow('URL blocked by CSP policy');
  });

  test('allowedUrlsで許可されていないURLを拒否する', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    await expect(
      fetchWithTimeout('https://other.com/api', {
        skipCspValidation: true,
        allowedUrls: new Set(['https://allowed.com']),
      }, 1000)
    ).rejects.toThrow('URL is not allowed');
  });

  test('allowedUrlsがnullの場合は検証をスキップする', async () => {
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    const response = await fetchWithTimeout('https://example.com', {
      skipCspValidation: true,
      allowedUrls: null,
    }, 1000);
    expect(response.ok).toBe(true);
  });
});

describe('isPrivateIpAddress - 追加IPv6', () => {
  test('fe80:: (リンクローカル) を検出する', () => {
    expect(isPrivateIpAddress('fe80::1')).toBe(true);
    expect(isPrivateIpAddress('fe80::abcd:ef12:3456:7890')).toBe(true);
    expect(isPrivateIpAddress('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
  });

  test('fc00::/7 (ユニークローカル) を検出する', () => {
    expect(isPrivateIpAddress('fc00::1')).toBe(true);
    expect(isPrivateIpAddress('fd00::1')).toBe(true);
    expect(isPrivateIpAddress('fd12:3456:7890::1')).toBe(true);
  });

  test('::ffff:127.0.0.1 を検出する', () => {
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
  });
});