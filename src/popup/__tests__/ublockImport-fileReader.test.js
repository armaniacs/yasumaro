/**
 * ublockImport-fileReader.test.js
 * uBlock Import - FileReaderモジュールのユニットテスト
 * 注意: FileReader APIのテストはブラウザ環境に依存するため、
 * jsdom環境でのモックを使用します
 */

import { readFile } from '../ublockImport/fileReader.ts';

describe('ublockImport - FileReader Module', () => {
  // jsdom環境でFileReaderが使用可能かを確認
  test('FileReaderが定義されている（ブラウザ環境確認）', () => {
    expect(typeof FileReader).toBe('function');
  });

  describe('readFile', () => {
    test('readFile関数が定義されている', () => {
      expect(typeof readFile).toBe('function');
    });

    test('readFileはPromiseを返す', () => {
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const result = readFile(mockFile);

      expect(result).toBeInstanceOf(Promise);
    });

    test('正常なファイルを非同期で読み込める', (done) => {
      const content = '||example.com^\n||test.com^';
      const mockFile = new File([content], 'test.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          expect(text).toBe(content);
          done();
        })
        .catch(done);
    });

    test('空のファイルを読み込める', (done) => {
      const mockFile = new File([''], 'empty.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          expect(text).toBe('');
          done();
        })
        .catch(done);
    });

    test('BOM付きファイルのBOMが除去される', (done) => {
      const bomText = '\uFEFF||example.com^';
      const mockFile = new File([bomText], 'with-bom.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          // BOMが除去されていることを確認
          expect(text).not.toBe(bomText);
          expect(text).toBe('||example.com^');
          expect(text.charCodeAt(0)).not.toBe(0xFEFF);
          done();
        })
        .catch(done);
    });

    test('大きなファイルを読み込める', (done) => {
      const largeContent = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');
      const mockFile = new File([largeContent], 'large.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          expect(text).toBe(largeContent);
          expect(text.split('\n').length).toBe(1000);
          done();
        })
        .catch(done);
    });

    test('日本語を含むファイルをUTF-8で読み込める', (done) => {
      const content = '||日本語ドメイン^\nテスト';
      const mockFile = new File([content], 'utf8.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          expect(text).toBe(content);
          expect(text).toContain('日本語');
          done();
        })
        .catch(done);
    });

    test('特殊文字を含むドメインを読み込める', (done) => {
      const content = '||*.example.com^\n||sub.example.co.jp^';
      const mockFile = new File([content], 'special.txt', { type: 'text/plain' });

      readFile(mockFile)
        .then((text) => {
          expect(text).toBe(content);
          expect(text).toContain('*.example.com');
          expect(text).toContain('sub.example.co.jp');
          done();
        })
        .catch(done);
    });
  });
});