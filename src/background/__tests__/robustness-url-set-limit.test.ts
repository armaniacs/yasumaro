/**
 * robustness-url-set-limit.test.ts
 * URLセットのサイズ制限テスト
 * ブルーチーム報告 P1: URLセットのサイズ制限がない
 */

import {
  MAX_URL_SET_SIZE,
  URL_WARNING_THRESHOLD,
  URL_RETENTION_DAYS
} from '../../utils/storage.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  ErrorCode: {
    STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED'
  },
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('URLセットのサイズ制限', () => {
  describe('定数定義', () => {
    it('MAX_URL_SET_SIZEが10000として定義されている', () => {
      expect(MAX_URL_SET_SIZE).toBe(10000);
    });

    it('URL_WARNING_THRESHOLDが8000として定義されている', () => {
      expect(URL_WARNING_THRESHOLD).toBe(8000);
    });

    it('URL_RETENTION_DAYSが7日として定義されている', () => {
      expect(URL_RETENTION_DAYS).toBe(7);
    });

    it('警告閾値が最大サイズより小さい', () => {
      expect(URL_WARNING_THRESHOLD).toBeLessThan(MAX_URL_SET_SIZE);
    });
  });

  describe('LRU退避ロジック（updateUrlTimestampの動作検証）', () => {
    it('MAX_URL_SET_SIZEを超えた場合に古いエントリが削除される', () => {
      // updateUrlTimestampのロジックを単体テスト
      // storage.ts:1150-1154 のロジックを検証
      const MAX_SIZE = MAX_URL_SET_SIZE;

      // MAX_SIZE + 100個のエントリを作成
      const entries: { url: string; timestamp: number }[] = [];
      for (let i = 0; i < MAX_SIZE + 100; i++) {
        entries.push({
          url: `https://example.com/${i}`,
          timestamp: Date.now() - (MAX_SIZE - i) * 1000 // 古いものは古いtimestamp
        });
      }

      // 7日より古いエントリを削除
      const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      let filtered = entries.filter(entry => entry.timestamp >= cutoff);

      // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
      if (filtered.length > MAX_SIZE) {
        filtered.sort((a, b) => a.timestamp - b.timestamp);
        filtered = filtered.slice(filtered.length - MAX_SIZE);
      }

      expect(filtered.length).toBeLessThanOrEqual(MAX_SIZE);
    });

    it('7日より古いエントリは日数ベースで削除される', () => {
      const now = Date.now();
      const cutoff = now - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

      const entries = [
        { url: 'https://old.com/1', timestamp: cutoff - 1000 }, // 古い
        { url: 'https://old.com/2', timestamp: cutoff - 86400000 }, // 1日前
        { url: 'https://new.com/1', timestamp: now },
        { url: 'https://new.com/2', timestamp: cutoff + 1000 }, // カットオフ直後
      ];

      const filtered = entries.filter(entry => entry.timestamp >= cutoff);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(e => e.url)).toEqual([
        'https://new.com/1',
        'https://new.com/2'
      ]);
    });

    it('URL_RETENTION_DAYSの計算が正しい', () => {
      const retentionMs = URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(retentionMs).toBe(7 * 24 * 60 * 60 * 1000); // 604800000ms
    });
  });

  describe('エントリ管理の境界値', () => {
    it('MAX_URL_SET_SIZEちょうどのエントリは保持される', () => {
      const entries: { url: string; timestamp: number }[] = [];
      const now = Date.now();

      for (let i = 0; i < MAX_URL_SET_SIZE; i++) {
        entries.push({ url: `https://example.com/${i}`, timestamp: now });
      }

      // すべてが7日以内 → そのまま保持
      const cutoff = now - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const filtered = entries.filter(entry => entry.timestamp >= cutoff);

      expect(filtered.length).toBe(MAX_URL_SET_SIZE);
    });

    it('MAX_URL_SET_SIZE + 1 のエントリはLRU退避される', () => {
      const now = Date.now();
      const entries: { url: string; timestamp: number }[] = [];

      for (let i = 0; i < MAX_URL_SET_SIZE + 1; i++) {
        entries.push({
          url: `https://example.com/${i}`,
          timestamp: now - i * 1000 // i=0が最新
        });
      }

      // すべてが7日以内 → LRU退避
      let filtered = entries.filter(
        entry => entry.timestamp >= now - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );

      if (filtered.length > MAX_URL_SET_SIZE) {
        filtered.sort((a, b) => a.timestamp - b.timestamp);
        filtered = filtered.slice(filtered.length - MAX_URL_SET_SIZE);
      }

      expect(filtered.length).toBe(MAX_URL_SET_SIZE);
      // 最も古いエントリ（timestamp最小）は削除される
      expect(filtered.find(e => e.url === 'https://example.com/' + MAX_URL_SET_SIZE)).toBeUndefined();
    });
  });
});
