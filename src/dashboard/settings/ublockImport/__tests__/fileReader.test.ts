// @vitest-environment jsdom
/**
 * ublockImport-fileReader.test.js
 * uBlock Import - FileReaderモジュールのユニットテスト
 * 注意: FileReader APIのテストはブラウザ環境に依存するため、
 * jsdom環境でのモックを使用します
 */

import { readFile } from '../fileReader.js';

describe('ublockImport - FileReader Module', () => {
  // jsdom環境でFileReaderが使用可能かを確認
  test('FileReader is defined (browser environment check)', () => {
    expect(typeof FileReader).toBe('function');
  });

  describe('readFile', () => {
    test('readFile function is defined', () => {
      expect(typeof readFile).toBe('function');
    });

    test('readFile returns a Promise', () => {
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const result = readFile(mockFile);

      expect(result).toBeInstanceOf(Promise);
    });

    test('reads a valid file asynchronously', async () => {
      const content = '||example.com^\n||test.com^';
      const mockFile = new File([content], 'test.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      expect(text).toBe(content);
    });

    test('reads an empty file', async () => {
      const mockFile = new File([''], 'empty.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      expect(text).toBe('');
    });

    test('strips BOM from a file with BOM', async () => {
      const bomText = '\uFEFF||example.com^';
      const mockFile = new File([bomText], 'with-bom.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      // BOMが除去されていることを確認
      expect(text).not.toBe(bomText);
      expect(text).toBe('||example.com^');
      expect(text.charCodeAt(0)).not.toBe(0xFEFF);
    });

    test('reads a large file', async () => {
      const largeContent = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');
      const mockFile = new File([largeContent], 'large.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      expect(text).toBe(largeContent);
      expect(text.split('\n').length).toBe(1000);
    });

    test('reads a file containing Japanese text as UTF-8', async () => {
      const content = '||日本語ドメイン^\nテスト';
      const mockFile = new File([content], 'utf8.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      expect(text).toBe(content);
      expect(text).toContain('日本語');
    });

    test('reads domains containing special characters', async () => {
      const content = '||*.example.com^\n||sub.example.co.jp^';
      const mockFile = new File([content], 'special.txt', { type: 'text/plain' });

      const text = await readFile(mockFile);
      expect(text).toBe(content);
      expect(text).toContain('*.example.com');
      expect(text).toContain('sub.example.co.jp');
    });
  });
});