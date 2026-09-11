// @vitest-environment jsdom
/**
 * ublockImport-error.test.js
 * Error handling tests for fetchFromUrl function
 * 【テスト対象】: src/popup/ublockImport/index.js - fetchFromUrl function
 */


import { fetchFromUrl, isValidUrl } from '../index.js';
import * as loggerModule from '../../../../utils/logger.js';

const { addLog, LogType } = vi.mocked(loggerModule);

// Mock the logger module
vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO' }
}));

describe('fetchFromUrl - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      runtime: {
        sendMessage: vi.fn()
      }
    } as unknown as typeof chrome;
  });

  test('handles HTTP errors properly', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 404: Not Found'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 404');
  });

  test('detects empty responses', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: '  ',
      contentType: 'text/plain'
    });

    await expect(fetchFromUrl('https://example.com/empty.txt')).rejects.toThrow('取得されたテキストが空です');
  });

  test('detects invalid URLs', async () => {
    await expect(fetchFromUrl('not-a-url')).rejects.toThrow('無効なURLです');
  });

  test('detects invalid URL protocol (javascript:)', async () => {
    await expect(fetchFromUrl('javascript:alert(1)')).rejects.toThrow('無効なURLです');
  });

  test('detects invalid URL protocol (data:)', async () => {
    await expect(fetchFromUrl('data:text/html,<script>alert(1)</script>')).rejects.toThrow('無効なURLです');
  });

  test('detects invalid URL protocol (vbscript:)', async () => {
    await expect(fetchFromUrl('vbscript:msgbox("xss")')).rejects.toThrow('無効なURLです');
  });

  test('detects invalid URL protocol (file:)', async () => {
    await expect(fetchFromUrl('file:///etc/passwd')).rejects.toThrow('無効なURLです');
  });

  test('handles valid URLs with Content-Type for text/plain', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'text/plain'
    });

    const result = await fetchFromUrl('https://example.com/filters.txt');
    expect(result).toBe('example.com');
  });

  test('handles valid URLs with Content-Type for text/html', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'text/html'
    });

    const result = await fetchFromUrl('https://example.com/filters.html');
    expect(result).toBe('example.com');
  });

  test('handles valid URLs with Content-Type for application/octet-stream', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'application/octet-stream'
    });

    const result = await fetchFromUrl('https://example.com/filters.dat');
    expect(result).toBe('example.com');
  });

  test('logs a warning for non-text Content-Type', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: '{"domain":"example.com"}',
      contentType: 'application/json'
    });

    const result = await fetchFromUrl('https://example.com/filters.json');
    expect(result).toBe('{"domain":"example.com"}');
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      'Content-Typeがテキスト形式ではありません',
      { contentType: 'application/json' }
    );
  });

  test('does not warn when Content-Type is null', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: null
    });

    const result = await fetchFromUrl('https://example.com/filters.txt');
    expect(result).toBe('example.com');
  });

  test('handles HTTP 500 errors properly', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 500: Internal Server Error'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 500');
  });

  test('handles HTTP 403 errors properly', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 403: Forbidden'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 403');
  });

  test('handles network errors properly', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Failed to fetch'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow(
      'ネットワークエラーまたはアクセス拒否が発生しました'
    );
  });

  test('detects empty-string URLs', async () => {
    await expect(fetchFromUrl('')).rejects.toThrow('無効なURLです');
  });

  test('detects null URLs', async () => {
    await expect(fetchFromUrl(null as unknown as string)).rejects.toThrow('無効なURLです');
  });

  test('detects undefined URLs', async () => {
    await expect(fetchFromUrl(undefined as unknown as string)).rejects.toThrow('無効なURLです');
  });

  describe('isValidUrl - URL検証', () => {
    test('accepts valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=1')).toBe(true);
      expect(isValidUrl('  https://example.com  ')).toBe(true); // Trimmed
    });

    test('accepts valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
    });

    test('accepts valid FTP URLs', () => {
      expect(isValidUrl('ftp://example.com')).toBe(true);
      expect(isValidUrl('ftp://ftp.example.com/files')).toBe(true);
    });

    test('rejects javascript: URLs', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('javascript:void(0)')).toBe(false);
      expect(isValidUrl('Javascript:alert(1)')).toBe(false); // Case insensitive
    });

    test('rejects data: URLs', () => {
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')).toBe(false);
    });

    test('rejects vbscript: URLs', () => {
      expect(isValidUrl('vbscript:msgbox("xss")')).toBe(false);
      expect(isValidUrl('VbScript:msgbox("xss")')).toBe(false); // Case insensitive
    });

    test('rejects file: URLs', () => {
      expect(isValidUrl('file:///etc/passwd')).toBe(false);
      expect(isValidUrl('file://C:/Windows/System32/config/sam')).toBe(false);
    });

    test('rejects null and empty strings', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
    });

    test('rejects URLs without protocol', () => {
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('example.com/path')).toBe(false);
      expect(isValidUrl('www.example.com')).toBe(false);
    });

    test('rejects http: URLs with path but no slashes', () => {
      expect(isValidUrl('http:example.com')).toBe(false);
      expect(isValidUrl('https:example.com')).toBe(false);
    });
  });
});