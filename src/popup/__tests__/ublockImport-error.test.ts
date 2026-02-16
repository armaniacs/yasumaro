/**
 * ublockImport-error.test.js
 * Error handling tests for fetchFromUrl function
 * 【テスト対象】: src/popup/ublockImport.js - fetchFromUrl function
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { fetchFromUrl, isValidUrl } from '../ublockImport.js';

// Mock the logger module
jest.mock('../../utils/logger.js', () => ({
  addLog: jest.fn(),
  LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO' }
}));

describe('fetchFromUrl - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.chrome = {
      runtime: {
        sendMessage: jest.fn()
      }
    };
  });

  test('HTTPエラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 404: Not Found'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 404');
  });

  test('空のレスポンスを検出', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: '  ',
      contentType: 'text/plain'
    });

    await expect(fetchFromUrl('https://example.com/empty.txt')).rejects.toThrow('取得されたテキストが空です');
  });

  test('無効なURLを検出', async () => {
    await expect(fetchFromUrl('not-a-url')).rejects.toThrow('無効なURLです');
  });

  test('無効なURL protocol (javascript:)を検出', async () => {
    await expect(fetchFromUrl('javascript:alert(1)')).rejects.toThrow('無効なURLです');
  });

  test('無効なURL protocol (data:)を検出', async () => {
    await expect(fetchFromUrl('data:text/html,<script>alert(1)</script>')).rejects.toThrow('無効なURLです');
  });

  test('無効なURL protocol (vbscript:)を検出', async () => {
    await expect(fetchFromUrl('vbscript:msgbox("xss")')).rejects.toThrow('無効なURLです');
  });

  test('無効なURL protocol (file:)を検出', async () => {
    await expect(fetchFromUrl('file:///etc/passwd')).rejects.toThrow('無効なURLです');
  });

  test('有効なURLとContent-Type for text/plain', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'text/plain'
    });

    const result = await fetchFromUrl('https://example.com/filters.txt');
    expect(result).toBe('example.com');
  });

  test('有効なURLとContent-Type for text/html', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'text/html'
    });

    const result = await fetchFromUrl('https://example.com/filters.html');
    expect(result).toBe('example.com');
  });

  test('有効なURLとContent-Type for application/octet-stream', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: 'application/octet-stream'
    });

    const result = await fetchFromUrl('https://example.com/filters.dat');
    expect(result).toBe('example.com');
  });

  test('非テキストContent-Typeで警告ログを出力', async () => {
    const { addLog, LogType } = require('../../utils/logger.js');

    // @ts-expect-error - jest.fn() type narrowing issue
  
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

  test('Content-Typeがnullの場合でも警告を出さない', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      data: 'example.com',
      contentType: null
    });

    const result = await fetchFromUrl('https://example.com/filters.txt');
    expect(result).toBe('example.com');
  });

  test('HTTP 500エラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 500: Internal Server Error'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 500');
  });

  test('HTTP 403エラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 403: Forbidden'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow('HTTP 403');
  });

  test('ネットワークエラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    global.chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Failed to fetch'
    });

    await expect(fetchFromUrl('https://example.com/filters.txt')).rejects.toThrow(
      'ネットワークエラーまたはアクセス拒否が発生しました'
    );
  });

  test('空文字URLを検出', async () => {
    await expect(fetchFromUrl('')).rejects.toThrow('無効なURLです');
  });

  test('null URLを検出', async () => {
    await expect(fetchFromUrl(null)).rejects.toThrow('無効なURLです');
  });

  test('undefined URLを検出', async () => {
    await expect(fetchFromUrl(undefined)).rejects.toThrow('無効なURLです');
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