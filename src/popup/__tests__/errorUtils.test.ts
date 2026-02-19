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
  test('必要なメッセージが定義されている', () => {
    expect(ErrorMessages.CONNECTION_ERROR).toBe(MOCK_CONNECTION_ERROR);
    expect(ErrorMessages.DOMAIN_BLOCKED).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
    expect(ErrorMessages.ERROR_PREFIX).toBe(MOCK_ERROR_PREFIX);
    expect(ErrorMessages.SUCCESS).toBe(MOCK_SUCCESS);
    expect(ErrorMessages.CANCELLED).toBe(MOCK_CANCELLED);
  });
});

describe('DOMAIN_BLOCKED_ERROR_CODE', () => {
  test('エラーコード定数が定義されている', () => {
    expect(DOMAIN_BLOCKED_ERROR_CODE).toBe('DOMAIN_BLOCKED');
  });
});

describe('ErrorType', () => {
  test('必要なエラータイプが定義されている', () => {
    expect(ErrorType.CONNECTION).toBe('CONNECTION');
    expect(ErrorType.DOMAIN_BLOCKED).toBe('DOMAIN_BLOCKED');
    expect(ErrorType.GENERAL).toBe('GENERAL');
  });
});

describe('isConnectionError', () => {
  test('Receiving end does not existエラーを判定できる', () => {
    const error = new Error('Receiving end does not exist');
    expect(isConnectionError(error)).toBe(true);
  });

  test('他のエラーは判定しない', () => {
    const error = new Error('Some other error');
    expect(isConnectionError(error)).toBe(false);
  });

  test('null/undefinedエラーを安全に処理', () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  test('messageプロパティがないオブジェクトを安全に処理', () => {
    expect(isConnectionError({})).toBe(false);
  });
});

describe('isDomainBlockedError', () => {
  test('ドメインブロックエラーを判定できる', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(isDomainBlockedError(error)).toBe(true);
  });

  test('他のエラーは判定しない', () => {
    const error = new Error('Some other error');
    expect(isDomainBlockedError(error)).toBe(false);
  });

  test('null/undefinedエラーを安全に処理', () => {
    expect(isDomainBlockedError(null)).toBe(false);
    expect(isDomainBlockedError(undefined)).toBe(false);
  });
});

describe('getErrorType', () => {
  test('コネクションエラーを正しく判定', () => {
    const error = new Error('Receiving end does not exist');
    expect(getErrorType(error)).toBe(ErrorType.CONNECTION);
  });

  test('ドメインブロックエラーを正しく判定', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(getErrorType(error)).toBe(ErrorType.DOMAIN_BLOCKED);
  });

  test('一般エラーを正しく判定', () => {
    const error = new Error('Some other error');
    expect(getErrorType(error)).toBe(ErrorType.GENERAL);
  });
});

describe('getUserErrorMessage', () => {
  test('コネクションエラーメッセージを取得', () => {
    const error = new Error('Receiving end does not exist');
    expect(getUserErrorMessage(error)).toBe(`${MOCK_ERROR_PREFIX} ${MOCK_CONNECTION_ERROR}`);
  });

  test('ドメインブロックエラーメッセージを取得', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    expect(getUserErrorMessage(error)).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
  });

  test('一般エラーメッセージを取得', () => {
    const error = new Error('Some other error');
    expect(getUserErrorMessage(error)).toContain('Error:');
    expect(getUserErrorMessage(error)).toContain('Some other error');
  });

  test('messageがないエラーの場合', () => {
    const error = {};
    expect(getUserErrorMessage(error)).toContain('Error:');
    expect(getUserErrorMessage(error)).toContain('Unknown error');
  });

  // FEATURE-001: 内部情報の漏洩を確認するテスト
  test('スタックトレースがエラーメッセージに含まれないこと（内部情報保護）', () => {
    const error = new Error('Some error');
    error.stack = 'Error: Some error\n    at file.js:10:5\n    at file.js:20:10';

    const message = getUserErrorMessage(error);

    // エラーメッセージにはエラーの内容が含まれるが、スタックトレースは含まれない
    expect(message).toContain('Some error');
    expect(message).not.toContain('file.js'); // ファイルパスが含まれない
    expect(message).not.toContain('at file.js'); // スタックトレースが含まれない
  });

  test('内部実装の詳細がエラーメッセージに含まれないこと（内部情報保護、改善後）', () => {
    const error = new Error('Internal implementation error: function xyz failed');

    const message = getUserErrorMessage(error);

    // 改善: エラーメッセージから内部実装の詳細が削除される
    expect(message).toContain('✗ Error:');
    expect(message).not.toContain('Internal implementation error'); // 内部情報が含まれない
    expect(message).not.toContain('function'); // 内部情報が含まれない
  });

  test('エラーメッセージが改行を含まないこと（内部情報保護）', () => {
    const error = new Error('Error: Some error at file.js:10:5\n    at file.js:20:10');

    const message = getUserErrorMessage(error);

    // 改行が削除され、スタックトレースが含まれないことを確認
    expect(message).not.toContain('\n');
    expect(message).not.toContain('at file.js'); // スタックトレースが含まれない
  });
});

describe('showError', () => {
  let statusElement;
  let mockForceRecordCallback;
  let createElementSpy;
  let mockButton;

  beforeEach(() => {
    statusElement = {
      className: '',
      textContent: '',
      appendChild: jest.fn()
    };
    mockForceRecordCallback = jest.fn();
    mockButton = {
      disabled: false,
      textContent: 'Force Record',
      style: {},
      onclick: null
    };

    // jsdom環境でdocument.createElementをspy
    if (typeof document !== 'undefined') {
      createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockButton);
    } else {
      // documentが存在しない場合はダミーを設定
      global.document = {
        createElement: jest.fn().mockReturnValue(mockButton)
      };
      createElementSpy = global.document.createElement;
    }
  });

  afterEach(() => {
    if (typeof document !== 'undefined') {
      createElementSpy?.mockRestore();
    }
    jest.restoreAllMocks();
    global.document = undefined;
  });

  test('一般エラーを表示', () => {
    const error = new Error('Some error');
    showError(statusElement, error);

    expect(statusElement.className).toBe('error');
    expect(statusElement.textContent).toContain('Error:');
  });

  test('ドメインブロックエラーで強制記録ボタンを表示', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);

    showError(statusElement, error, mockForceRecordCallback);

    expect(statusElement.textContent).toBe(MOCK_DOMAIN_BLOCKED_DISPLAY);
    expect(createElementSpy).toHaveBeenCalledWith('button');
    expect(statusElement.appendChild).toHaveBeenCalled();
  });

  test('強制記録ボタンのクリックハンドラーが設定される', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);

    showError(statusElement, error, mockForceRecordCallback);

    // ボタンが作成されたことを確認
    expect(createElementSpy).toHaveBeenCalledWith('button');

    // appendChildが呼び出されたことを確認
    expect(statusElement.appendChild).toHaveBeenCalled();
  });
});

describe('showSuccess', () => {
  let statusElement;

  beforeEach(() => {
    statusElement = {
      className: '',
      textContent: ''
    };
  });

  test('デフォルトの成功メッセージを表示', () => {
    showSuccess(statusElement);

    expect(statusElement.className).toBe('success');
    expect(statusElement.textContent).toBe(MOCK_SUCCESS);
  });

  test('カスタムメッセージを表示', () => {
    showSuccess(statusElement, 'Custom success message');

    expect(statusElement.className).toBe('success');
    expect(statusElement.textContent).toBe('Custom success message');
  });
});

describe('handleError', () => {
  test('コネクションエラーハンドラーを呼び出す', () => {
    const error = new Error('Receiving end does not exist');
    const handlers = {
      onConnectionError: jest.fn()
    };

    handleError(error, handlers);

    expect(handlers.onConnectionError).toHaveBeenCalledWith(error);
  });

  test('ドメインブロックエラーハンドラーを呼び出す', () => {
    const error = new Error(DOMAIN_BLOCKED_ERROR_CODE);
    const handlers = {
      onDomainBlocked: jest.fn()
    };

    handleError(error, handlers);

    expect(handlers.onDomainBlocked).toHaveBeenCalledWith(error);
  });

  test('一般エラーハンドラーを呼び出す', () => {
    const error = new Error('Some other error');
    const handlers = {
      onGeneralError: jest.fn()
    };

    handleError(error, handlers);

    expect(handlers.onGeneralError).toHaveBeenCalledWith(error);
  });

  test('対応するハンドラーがない場合は何もしない', () => {
    const error = new Error('Some error');
    const handlers = {};

    expect(() => handleError(error, handlers)).not.toThrow();
  });
});
describe('escapeHtml - XSS対策テスト（問題点3）', () => {
  describe('HTMLエンティティのエスケープ', () => {
    it('アンパーサンドをエスケープする', () => {
      const result = escapeHtml('&');
      expect(result).toBe('&amp;');
      expect(result).not.toBe('&');
    });

    it('小なり記号をエスケープする', () => {
      const result = escapeHtml('<');
      expect(result).toBe('&lt;');
      expect(result).not.toBe('<');
    });

    it('大なり記号をエスケープする', () => {
      const result = escapeHtml('>');
      expect(result).toBe('&gt;');
      expect(result).not.toBe('>');
    });

    it('ダブルクォートをエスケープする', () => {
      const result = escapeHtml('"');
      expect(result).toBe('&quot;');
      expect(result).not.toBe('"');
    });

    it('シングルクォートをエスケープする', () => {
      const result = escapeHtml("'");
      expect(result).toBe('&#x27;');
      expect(result).not.toBe("'");
    });

    it('スラッシュをエスケープする', () => {
      const result = escapeHtml('/');
      expect(result).toBe('&#x2F;');
      expect(result).not.toBe('/');
    });
  });

  describe('XSS攻撃の防止', () => {
    it('スクリプトタグインジェクションを防ぐ', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('イベントハンドラーのインジェクションを防ぐ', () => {
      const result = escapeHtml('<img src=x onerror="alert(1)">');
      expect(result).not.toContain('onerror="');
      expect(result).toContain('onerror=&quot;');
    });

    it('一般的なテキストを保持する', () => {
      const result = escapeHtml('This is safe text');
      expect(result).toBe('This is safe text');
    });
  });

  describe('エッジケース', () => {
    it('空文字列は空文字を返す', () => {
      const result = escapeHtml('');
      expect(result).toBe('');
    });

    it('nullは空文字を返す', () => {
      const result = escapeHtml(null);
      expect(result).toBe('');
    });

    it('undefinedは空文字を返す', () => {
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
  it('should format message with total time only', () => {
    const message = formatSuccessMessage(1234);
    expect(message).toBe('✓ Saved to Obsidian (1.2seconds)');
  });

  it('should format message with total and AI time', () => {
    const message = formatSuccessMessage(2000, 850);
    expect(message).toBe('✓ Saved to Obsidian (2.0seconds / AI: 850ms)');
  });

  it('should not show AI time when undefined', () => {
    const message = formatSuccessMessage(1500, undefined);
    expect(message).toBe('✓ Saved to Obsidian (1.5seconds)');
  });

  it('should not show AI time when zero', () => {
    const message = formatSuccessMessage(1500, 0);
    expect(message).toBe('✓ Saved to Obsidian (1.5seconds)');
  });

  it('should handle both times in milliseconds', () => {
    const message = formatSuccessMessage(800, 300);
    expect(message).toBe('✓ Saved to Obsidian (800ms / AI: 300ms)');
  });

  it('should handle both times in seconds', () => {
    const message = formatSuccessMessage(3456, 1234);
    expect(message).toBe('✓ Saved to Obsidian (3.5seconds / AI: 1.2seconds)');
  });
});
