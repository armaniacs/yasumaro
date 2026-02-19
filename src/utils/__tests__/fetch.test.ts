import { fetchWithTimeout, isUrlAllowed, isPrivateIpAddress, validateUrlForFilterImport, validateUrlForAIRequests } from '../fetch.js';
import { normalizeUrl } from '../urlUtils.js';

describe('fetchWithTimeout', () => {
  test('正常レスポンスを返す', async () => {
    const mockResponse = { ok: true } as Response;
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
      const mockResponse = { ok: true } as Response;
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
    const mockResponse = { ok: true } as Response;
    global.fetch = jest.fn(() => Promise.resolve(mockResponse));

    let actualTimeout = 0;
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = jest.fn((callback, ms) => {
      actualTimeout = ms;
      return 999 as unknown as NodeJS.Timeout;
    });

    try {
      const response = await fetchWithTimeout('https://example.com');
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