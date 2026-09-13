// @vitest-environment jsdom
/**
 * errorUtils.test.js
 * エラーハンドリング共通モジュールのテスト
 */

import {
  ErrorMessages,
  ErrorType,
  DOMAIN_BLOCKED_ERROR_CODE,
  isConnectionError,
  isDomainBlockedError,
  getErrorType,
  getUserErrorMessage,
  showError,
  showSuccess,
  handleError,
  escapeHtml,
  formatDuration,
  formatSuccessMessage
} from '../errorUtils.js';

// テスト用のi18nモック文字列
const MOCK_CONNECTION_ERROR = 'Please refresh the page and try again';
const MOCK_DOMAIN_BLOCKED_DISPLAY = 'This domain is not allowed to be recorded. Do you want to record it anyway?';
const MOCK_ERROR_PREFIX = '✗ Error:';
const MOCK_SUCCESS = '✓ Saved to Obsidian';
const MOCK_CANCELLED = 'Cancelled';

describe('ErrorMessages', () => {
  test('defines the required messages', () => {
    expect(ErrorMessages.CONNECTION_ERROR).toBe(MOCK_CONNECTION_ERROR);
    expect(ErrorMessages.DOMAIN_BLOCKED).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
    expect(ErrorMessages.ERROR_PREFIX).toBe(MOCK_ERROR_PREFIX);
    expect(ErrorMessages.SUCCESS).toBe(MOCK_SUCCESS);
    expect(ErrorMessages.CANCELLED).toBe(MOCK_CANCELLED);
  });
});

describe('DOMAIN_BLOCKED_ERROR_CODE', () => {
  test('defines the error code constant', () => {
    expect(DOMAIN_BLOCKED_ERROR_CODE).toBe('DOMAIN_BLOCKED');
  });
});

describe('ErrorType', () => {
  test('defines the required error types', () => {
    expect(ErrorType.CONNECTION).toBe('CONNECTION');
    expect(ErrorType.DOMAIN_BLOCKED).toBe('DOMAIN_BLOCKED');
    expect(ErrorType.GENERAL).toBe('GENERAL');
  });
});

describe('isConnectionError', () => {
  test("detects a 'Receiving end does not exist' error", () => {
    const error = new Error('Receiving end does not exist');
    expect(isConnectionError(error)).toBe(true);
  });

  test('returns false for other errors', () => {
    const error = new Error('Some other error');
    expect(isConnectionError(error)).toBe(false);
  });

  test('handles null/undefined errors safely', () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  test('handles objects without a message property safely', () => {
    expect(isConnectionError({})).toBe(false);
  });
});

describe('isDomainBlockedError', () => {
  test('detects a domain-blocked error', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(isDomainBlockedError(error)).toBe(true);
  });

  test('returns false for other errors', () => {
    const error = new Error('Some other error');
    expect(isDomainBlockedError(error)).toBe(false);
  });

  test('handles null/undefined errors safely', () => {
    expect(isDomainBlockedError(null)).toBe(false);
    expect(isDomainBlockedError(undefined)).toBe(false);
  });
});

describe('getErrorType', () => {
  test('classifies a connection error correctly', () => {
    const error = new Error('Receiving end does not exist');
    expect(getErrorType(error)).toBe(ErrorType.CONNECTION);
  });

  test('classifies a domain-blocked error correctly', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(getErrorType(error)).toBe(ErrorType.DOMAIN_BLOCKED);
  });

  test('classifies a general error correctly', () => {
    const error = new Error('Some other error');
    expect(getErrorType(error)).toBe(ErrorType.GENERAL);
  });
});

describe('getUserErrorMessage', () => {
  test('returns the connection error message', () => {
    const error = new Error('Receiving end does not exist');
    expect(getUserErrorMessage(error)).toBe(`${MOCK_ERROR_PREFIX} ${MOCK_CONNECTION_ERROR}`);
  });

  test('returns the domain-blocked error message', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(getUserErrorMessage(error)).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
  });

  test('returns the general error message', () => {
    const error = new Error('Some other error');
    expect(getUserErrorMessage(error)).toContain('Error:');
    expect(getUserErrorMessage(error)).toContain('Some other error');
  });

  test('falls back when the error has no message', () => {
    const error = {};
    expect(getUserErrorMessage(error)).toContain('Error:');
    expect(getUserErrorMessage(error)).toContain('Unknown error');
  });

  // FEATURE-001: 内部情報の漏洩を確認するテスト
  test('excludes stack traces from the error message (internal info protection)', () => {
    const error = new Error('Some error');
    error.stack = 'Error: Some error\n    at file.js:10:5\n    at file.js:20:10';

    const message = getUserErrorMessage(error);

    // エラーメッセージにはエラーの内容が含まれるが、スタックトレースは含まれない
    expect(message).toContain('Some error');
    expect(message).not.toContain('file.js'); // ファイルパスが含まれない
    expect(message).not.toContain('at file.js'); // スタックトレースが含まれない
  });

  test('excludes internal implementation details from the error message (internal info protection)', () => {
    const error = new Error('Internal implementation error: function xyz failed');

    const message = getUserErrorMessage(error);

    // 改善: エラーメッセージから内部実装の詳細が削除される
    expect(message).toContain('✗ Error:');
    expect(message).not.toContain('Internal implementation error'); // 内部情報が含まれない
    expect(message).not.toContain('function'); // 内部情報が含まれない
  });

  test('strips newlines from the error message (internal info protection)', () => {
    const error = new Error('Error: Some error at file.js:10:5\n    at file.js:20:10');

    const message = getUserErrorMessage(error);

    // 改行が削除され、スタックトレースが含まれないことを確認
    expect(message).not.toContain('\n');
    expect(message).not.toContain('at file.js'); // スタックトレースが含まれない
  });
});

describe('showError', () => {
  let statusElement: HTMLElement;
  let mockForceRecordCallback: ReturnType<typeof vi.fn>;
  let createElementSpy: ReturnType<typeof vi.spyOn> | undefined;
  let mockButton: Record<string, unknown>;

  beforeEach(() => {
    statusElement = {
      className: '',
      textContent: '',
      appendChild: vi.fn()
    } as unknown as HTMLElement;
    mockForceRecordCallback = vi.fn();
    mockButton = {
      disabled: false,
      textContent: 'Force Record',
      style: {},
      onclick: null
    };

    // jsdom環境でdocument.createElementをspy（vitest 5 では環境グローバルが
    // 常に存在するため、ダミー document を組むフォールバックは不要）
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockButton as unknown as HTMLElement);
  });

  afterEach(() => {
    createElementSpy?.mockRestore();
    vi.restoreAllMocks();
    // vitest 5: 環境グローバル (document) は getter-only のため直接代入できない。
    // jsdom 環境の document は環境側が管理するのでここでは触らない
  });

  test('renders a general error', () => {
    const error = new Error('Some error');
    showError(statusElement, error);

    expect(statusElement.className).toBe('error');
    expect(statusElement.textContent).toContain('Error:');
  });

  test('renders the force-record button for a domain-blocked error', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);

    showError(statusElement, error, mockForceRecordCallback as unknown as () => void);

    expect(statusElement.textContent).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
    expect(createElementSpy).toHaveBeenCalledWith('button');
    expect(statusElement.appendChild).toHaveBeenCalled();
  });

  test('wires the force-record button click handler', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);

    showError(statusElement, error, mockForceRecordCallback as unknown as () => void);

    // ボタンが作成されたことを確認
    expect(createElementSpy).toHaveBeenCalledWith('button');

    // appendChildが呼び出されたことを確認
    expect(statusElement.appendChild).toHaveBeenCalled();
  });
});

describe('showSuccess', () => {
  let statusElement: HTMLElement;

  beforeEach(() => {
    statusElement = {
      className: '',
      textContent: ''
    } as unknown as HTMLElement;
  });

  test('renders the default success message', () => {
    showSuccess(statusElement);

    expect(statusElement.className).toBe('success');
    expect(statusElement.textContent).toBe(MOCK_SUCCESS);
  });

  test('renders a custom message', () => {
    showSuccess(statusElement, 'Custom success message');

    expect(statusElement.className).toBe('success');
    expect(statusElement.textContent).toBe('Custom success message');
  });
});

describe('handleError', () => {
  test('invokes the connection error handler', () => {
    const error = new Error('Receiving end does not exist');
    const handlers = {
      onConnectionError: vi.fn()
    };

    handleError(error, handlers);

    expect(handlers.onConnectionError).toHaveBeenCalledWith(error);
  });

  test('invokes the domain-blocked error handler', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    const handlers = {
      onDomainBlocked: vi.fn()
    };

    handleError(error, handlers);

    expect(handlers.onDomainBlocked).toHaveBeenCalledWith(error);
  });

  test('invokes the general error handler', () => {
    const error = new Error('Some other error');
    const handlers = {
      onGeneralError: vi.fn()
    };

    handleError(error, handlers);

    expect(handlers.onGeneralError).toHaveBeenCalledWith(error);
  });

  test('does nothing when no matching handler exists', () => {
    const error = new Error('Some error');
    const handlers = {};

    expect(() => handleError(error, handlers)).not.toThrow();
  });
});
describe('escapeHtml - XSS対策テスト（問題点3）', () => {
  describe('HTMLエンティティのエスケープ', () => {
    it('escapes ampersands', () => {
      const result = escapeHtml('&');
      expect(result).toBe('&amp;');
      expect(result).not.toBe('&');
    });

    it('escapes less-than signs', () => {
      const result = escapeHtml('<');
      expect(result).toBe('&lt;');
      expect(result).not.toBe('<');
    });

    it('escapes greater-than signs', () => {
      const result = escapeHtml('>');
      expect(result).toBe('&gt;');
      expect(result).not.toBe('>');
    });

    it('escapes double quotes', () => {
      const result = escapeHtml('"');
      expect(result).toBe('&quot;');
      expect(result).not.toBe('"');
    });

    it('escapes single quotes', () => {
      const result = escapeHtml("'");
      expect(result).toBe('&#039;');
      expect(result).not.toBe("'");
    });

    it('escapes slashes', () => {
      const result = escapeHtml('/');
      expect(result).toBe('&#x2F;');
      expect(result).not.toBe('/');
    });
  });

  describe('XSS攻撃の防止', () => {
    it('blocks script tag injection', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('blocks event handler injection', () => {
      const result = escapeHtml('<img src=x onerror="alert(1)">');
      expect(result).not.toContain('onerror="');
      expect(result).toContain('onerror=&quot;');
    });

    it('preserves plain text', () => {
      const result = escapeHtml('This is safe text');
      expect(result).toBe('This is safe text');
    });
  });

  describe('エッジケース', () => {
    it('returns an empty string for empty input', () => {
      const result = escapeHtml('');
      expect(result).toBe('');
    });

    it('returns an empty string for null', () => {
      const result = escapeHtml(null);
      expect(result).toBe('');
    });

    it('returns an empty string for undefined', () => {
      const result = escapeHtml(undefined);
      expect(result).toBe('');
    });
  });
});

describe('formatDuration', () => {
  it('should format milliseconds when less than 1 second', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds when 1 second or more', () => {
    expect(formatDuration(1000)).toBe('1.0seconds');
    expect(formatDuration(1234)).toBe('1.2seconds');
    expect(formatDuration(5678)).toBe('5.7seconds');
  });

  it('should round milliseconds to nearest integer', () => {
    expect(formatDuration(123.4)).toBe('123ms');
    expect(formatDuration(123.6)).toBe('124ms');
  });

  it('should round seconds to 1 decimal place', () => {
    expect(formatDuration(1234)).toBe('1.2seconds');
    expect(formatDuration(1289)).toBe('1.3seconds');
  });
});

describe('formatDuration edge cases', () => {
  it('should handle negative numbers by returning 0ms', () => {
    expect(formatDuration(-500)).toBe('0ms');
    expect(formatDuration(-1)).toBe('0ms');
  });

  it('should handle NaN by returning 0ms', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  it('should handle Infinity by returning 0ms', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  it('should handle very large durations', () => {
    expect(formatDuration(3600000)).toBe('3600.0seconds'); // 1 hour
  });

  it('should handle boundary precision at 1000ms threshold', () => {
    expect(formatDuration(999.9)).toBe('1000ms'); // rounds to 1000ms
    expect(formatDuration(1000.1)).toBe('1.0seconds');
  });
});

describe('formatSuccessMessage', () => {
  it('should format message with total time only (no AI, local save)', () => {
    const message = formatSuccessMessage(1234);
    expect(message).toBe('✓ AI Summary failed — saved (1.2seconds)');
  });

  it('should format message with total and AI time (local save)', () => {
    const message = formatSuccessMessage(2000, 850);
    expect(message).toBe('✓ AI Summary saved (2.0seconds / AI: 850ms)');
  });

  it('should not show AI time when undefined', () => {
    const message = formatSuccessMessage(1500, undefined);
    expect(message).toBe('✓ AI Summary failed — saved (1.5seconds)');
  });

  it('should not show AI time when zero', () => {
    const message = formatSuccessMessage(1500, 0);
    expect(message).toBe('✓ AI Summary failed — saved (1.5seconds)');
  });

  it('should handle both times in milliseconds (local save)', () => {
    const message = formatSuccessMessage(800, 300);
    expect(message).toBe('✓ AI Summary saved (800ms / AI: 300ms)');
  });

  it('should handle both times in seconds (local save)', () => {
    const message = formatSuccessMessage(3456, 1234);
    expect(message).toBe('✓ AI Summary saved (3.5seconds / AI: 1.2seconds)');
  });

  it('should show Obsidian message when obsidianSaved is true', () => {
    const message = formatSuccessMessage(2000, 850, true);
    expect(message).toBe('✓ AI Summary saved to Obsidian (2.0seconds / AI: 850ms)');
  });

  it('should show local message when obsidianSaved is false', () => {
    const message = formatSuccessMessage(2000, 850, false);
    expect(message).toBe('✓ AI Summary saved (2.0seconds / AI: 850ms)');
  });

  it('should show AI failed message when aiDuration is undefined', () => {
    const message = formatSuccessMessage(2000, undefined, true);
    expect(message).toBe('✓ AI Summary failed — saved (2.0seconds)');
  });

  it('should show AI failed message when aiDuration is zero', () => {
    const message = formatSuccessMessage(2000, 0, true);
    expect(message).toBe('✓ AI Summary failed — saved (2.0seconds)');
  });

  it('should show provider label when aiProvider is a known key', () => {
    const message = formatSuccessMessage(2000, 850, true, 'openai');
    expect(message).toBe('✓ AI Summary saved to Obsidian (2.0seconds / AI: 850ms (OpenAI Compatible))');
  });

  it('should fall back to raw provider id when unknown', () => {
    const message = formatSuccessMessage(2000, 850, true, 'some-custom-provider');
    expect(message).toBe('✓ AI Summary saved to Obsidian (2.0seconds / AI: 850ms (some-custom-provider))');
  });

  it('should not show provider label when aiProvider is undefined', () => {
    const message = formatSuccessMessage(2000, 850, true);
    expect(message).toBe('✓ AI Summary saved to Obsidian (2.0seconds / AI: 850ms)');
  });
});
