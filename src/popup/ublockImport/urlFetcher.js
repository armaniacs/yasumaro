/**
 * urlFetcher.js
 * uBlockインポートモジュール - URL読み込み処理
 */

import { isValidUrl } from './validation.js';
import { LogType } from '../../utils/logger.js';
import { addLog } from '../../utils/logger.js';

/**
 * URLからフィルターリストを取得
 * @param {string} url - 外部URL
 * @returns {Promise<string>} フィルターテキスト
 * @throws {Error} 無効なURLや取得エラー時にスロー
 */
export async function fetchFromUrl(url) {
  if (!isValidUrl(url)) {
    throw new Error('無効なURLです');
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_URL',
      payload: { url }
    });

    if (!response) {
      throw new Error('バックグラウンドスクリプトからの応答がありません');
    }

    if (!response.success) {
      throw new Error(response.error);
    }

    const { data: text, contentType } = response;

    // 取得後にテキストが有効かチェック
    if (!text || text.trim().length === 0) {
      throw new Error('取得されたテキストが空です');
    }

    // Content-Typeがテキストでない場合は警告
    if (contentType && !contentType.includes('text/') && !contentType.includes('application/octet-stream')) {
      addLog(LogType.WARN, 'Content-Typeがテキスト形式ではありません', { contentType });
    }

    return text;
  } catch (error) {
    if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch') || error.message.includes('TypeError')) {
      throw new Error(`ネットワークエラーまたはアクセス拒否が発生しました (${error.message})。URLが正しいか、またはインターネット接続を確認してください。CSP制限の可能性もあります。`);
    }
    throw new Error(`URL読み込みエラー: ${error.message}`);
  }
}