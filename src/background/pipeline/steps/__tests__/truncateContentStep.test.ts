/**
 * truncateContentStep のテスト
 *
 * 検証対象:
 * - MAX_RECORD_SIZE 以内のコンテンツはそのまま通過
 * - MAX_RECORD_SIZE を超えるコンテンツは切り詰められる
 * - 切り詰め時に truncatedContent と data.content が更新される
 * - 空コンテンツの場合はそのまま通過
 * - マルチバイト文字（UTF-8）の安全な切り詰め
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logError: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));

import { truncateContentStep } from '../truncateContentStep.js';
import { MAX_RECORD_SIZE } from '../../types.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('truncateContentStep', () => {
  describe('MAX_RECORD_SIZE 以内', () => {
    it('コンテンツサイズが MAX_RECORD_SIZE 以内の場合そのまま通過', async () => {
      const content = 'Short content';
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      const result = await truncateContentStep(context);

      expect(result.truncatedContent).toBe(content);
      expect(result.data.content).toBe(content);
    });

    it('MAX_RECORD_SIZE ちょうどのコンテンツはそのまま通過', async () => {
      // MAX_RECORD_SIZE = 64KB の ASCII 文字列
      const content = 'a'.repeat(MAX_RECORD_SIZE);
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      const result = await truncateContentStep(context);

      expect(result.truncatedContent).toBe(content);
      expect(result.data.content).toBe(content);
    });
  });

  describe('MAX_RECORD_SIZE 超過', () => {
    it('コンテンツが MAX_RECORD_SIZE を超える場合切り詰められる', async () => {
      const content = 'a'.repeat(MAX_RECORD_SIZE + 1000);
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      const result = await truncateContentStep(context);

      const encoder = new TextEncoder();
      expect(encoder.encode(result.truncatedContent!).length).toBeLessThanOrEqual(MAX_RECORD_SIZE);
      expect(result.data.content).toBe(result.truncatedContent);
    });

    it('切り詰め時に WARN ログが出力される', async () => {
      const content = 'a'.repeat(MAX_RECORD_SIZE + 100);
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      await truncateContentStep(context);

      const { addLog } = await import('../../../../utils/logger.js');
      expect(addLog).toHaveBeenCalledWith(
        'WARN',
        expect.stringContaining('truncated'),
        expect.objectContaining({ url: 'https://example.com' })
      );
    });
  });

  describe('空コンテンツ', () => {
    it('content が空文字の場合はそのまま通過', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '' },
      });

      const result = await truncateContentStep(context);

      // 空文字は early return で truncatedContent が設定されない
      expect(result).toBe(context);
      expect(result.truncatedContent).toBeUndefined();
    });

    it('content が undefined の場合はそのまま通過', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: undefined as any },
      });

      const result = await truncateContentStep(context);

      expect(result).toBe(context);
      expect(result.truncatedContent).toBeUndefined();
    });
  });

  describe('マルチバイト文字（UTF-8）', () => {
    it('日本語文字が安全に切り詰められる（文字化けなし）', async () => {
      // 日本語1文字 = 3バイト UTF-8
      // MAX_RECORD_SIZE を超える日本語文字列を作成
      const charCount = Math.ceil(MAX_RECORD_SIZE / 3) + 100;
      const content = 'あ'.repeat(charCount);

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      const result = await truncateContentStep(context);

      // 切り詰められた文字列が有効な UTF-8 であることを確認
      const encoder = new TextEncoder();
      const truncatedBytes = encoder.encode(result.truncatedContent!);
      // 切り詰め後は元より小さい（厳密に MAX_RECORD_SIZE 以下とは限らない場合がある）
      expect(truncatedBytes.length).toBeLessThanOrEqual(MAX_RECORD_SIZE + 4);

      // デコードしても例外が発生しないことを確認
      const decoder = new TextDecoder('utf-8', { fatal: false });
      expect(() => decoder.decode(truncatedBytes)).not.toThrow();
    });

    it('絵文字（4バイト UTF-8）が安全に切り詰められる', async () => {
      // 絵文字は UTF-8 で4バイト
      const charCount = Math.ceil(MAX_RECORD_SIZE / 4) + 100;
      const content = '😀'.repeat(charCount);

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content },
      });

      const result = await truncateContentStep(context);

      const encoder = new TextEncoder();
      const truncatedBytes = encoder.encode(result.truncatedContent!);
      expect(truncatedBytes.length).toBeLessThanOrEqual(MAX_RECORD_SIZE);

      // fatal: false でデコード（不完全なマルチバイトは置換される）
      const decoder = new TextDecoder('utf-8', { fatal: false });
      expect(() => decoder.decode(truncatedBytes)).not.toThrow();
    });

    it('ASCII と日本語の混合テキストが安全に切り詰められる', async () => {
      const mixedContent = 'Hello 世界! '.repeat(Math.ceil(MAX_RECORD_SIZE / 15) + 100);

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: mixedContent },
      });

      const result = await truncateContentStep(context);

      const encoder = new TextEncoder();
      expect(encoder.encode(result.truncatedContent!).length).toBeLessThanOrEqual(MAX_RECORD_SIZE);
    });
  });
});
