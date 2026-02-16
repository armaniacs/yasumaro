import { LocalAIClient } from '../localAiClient.js';
import * as logger from '../../utils/logger.js';

jest.mock('../../utils/logger.js');

describe('LocalAIClient timeout', () => {
  let originalSetTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    originalSetTimeout = global.setTimeout;

    // chrome APIの基本モック
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((message, callback) => {
          if (callback) callback({});
          return Promise.resolve({});
        })
      },
      offscreen: {
        hasDocument: jest.fn(() => Promise.resolve(false)),
        createDocument: jest.fn(() => Promise.resolve())
      }
    };
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
  });

  test('summarize：オフスクリーン通信にタイムアウト', async () => {
    jest.useFakeTimers();
    // msgOffscreenが永遠に応答しないようにモック（Promise解決なし）
    const cli = new LocalAIClient();
    cli.msgOffscreen = jest.fn().mockImplementation(() => new Promise(() => { })); // 永遠に解決しない

    const resultPromise = cli.summarize('test');

    // タイムアウト分だけ時間を進める
    jest.advanceTimersByTime(30000);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');

    // ログが書かれることを確認
    expect(logger.addLog).toHaveBeenCalledWith(
      logger.LogType.ERROR,
      expect.stringContaining('timed'),
      expect.any(Object)
    );

    jest.useRealTimers();
  });

  test('summarize：成功応答', async () => {
    const cli = new LocalAIClient();
    cli.msgOffscreen = jest.fn().mockResolvedValue({
      success: true,
      summary: 'テスト要約'
    });

    const result = await cli.summarize('test');
    expect(result.success).toBe(true);
    expect(result.summary).toBe('テスト要約');
  });

  test('summarize：オフスクリーンからのエラー応答', async () => {
    const cli = new LocalAIClient();
    cli.msgOffscreen = jest.fn().mockResolvedValue({
      success: false,
      error: 'Offscreen error'
    });

    const result = await cli.summarize('test');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Offscreen error');
  });
});