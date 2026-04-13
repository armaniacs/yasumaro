/**
 * urlNotificationHandlers.ts
 * URL notification encoding/decoding handlers
 * Extracted from service-worker.ts for better modularity
 */

import { getNotificationHmacKey, generateHmacSignature, verifyHmacSignature } from '../../utils/crypto.js';
import { logError, logWarn, ErrorCode } from '../../utils/logger.js';

// Constants for URL encoding
const MAX_URL_LENGTH = 2000;
const MAX_ENCODED_LENGTH = 5000;

/**
 * URLをURL-safe base64でエンコードし、HMAC署名を付与する
 * @param url エンコードするURL
 * @param maxLength 最大長（デフォルト: 256）
 * @returns URL-safe base64エンコードされたURLと署名
 */
export async function encodeUrlSafeBase64(
  url: string,
  maxLength: number = 256
): Promise<string> {
  const prefix = 'privacy-confirm-';
  const prefixLength = prefix.length;

  if (!url || typeof url !== 'string') {
    throw new Error('encodeUrlSafeBase64: Invalid URL');
  }

  // URL長のバリデーション
  if (url.length > MAX_URL_LENGTH) {
    throw new Error('encodeUrlSafeBase64: URL too long');
  }

  // 完全なHMAC-SHA256署名は32バイト → URL-safe base64で43文字
  const signatureLength = 43; // 完全な署名長（URL-safe base64）
  const maxUrlLength = (maxLength - prefixLength - signatureLength) * 0.75; // Base64オーバーヘッドを考慮

  // URL过长チェック
  if (url.length > maxUrlLength) {
    throw new Error('encodeUrlSafeBase64: URL too long for notification ID');
  }

  try {
    // URLをBase64エンコード（TextEncoder使用-service-worker.tsと一致）
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    // スタックオーバーフロー回避のためArray.from使用
    const binaryString = Array.from(data, b => String.fromCharCode(b)).join('');
    const urlB64 = btoa(binaryString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // HMAC署名を計算
    const hmacKey = await getNotificationHmacKey();
    const signature = await generateHmacSignature(url, hmacKey);

    return `${prefix}${urlB64}.${signature}`;
  } catch (error) {
    throw new Error('encodeUrlSafeBase64: Failed to encode URL');
  }
}

/**
 * 通知IDからURLをデコードし、署名を検証する
 * @param notificationId 通知ID
 * @returns デコードされたURL
 */
export async function decodeUrlFromNotificationId(notificationId: string): Promise<string> {
  const prefix = 'privacy-confirm-';

  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('Invalid notification ID');
  }

  // 入力長チェック
  if (notificationId.length > MAX_ENCODED_LENGTH) {
    throw new Error('Notification ID too long');
  }

  // 接頭辞チェック
  if (!notificationId.startsWith(prefix)) {
    throw new Error('Invalid notification ID prefix');
  }

  try {
    const parts = notificationId.substring(prefix.length).split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid notification ID format');
    }

    const [urlB64, signature] = parts;
    const b64 = urlB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
    const binaryString = atob(padded);
    // TextDecoder使用（service-worker.tsと一致）
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    const url = decoder.decode(bytes);

    // 署名検証
    const hmacKey = await getNotificationHmacKey();
    const isValid = await verifyHmacSignature(url, signature, hmacKey);

    if (!isValid) {
      await logWarn(
        'HMAC signature verification failed for notification',
        { urlHash: url.substring(0, 10) + '...' },
        ErrorCode.CRYPTO_HMAC_FAILURE,
        'notification-helpers'
      );
      throw new Error('Invalid signature');
    }

    return url;
  } catch (error) {
    await logError(
      'Failed to decode notification ID',
      { error: error instanceof Error ? error.message : String(error) },
      ErrorCode.CRYPTO_HMAC_FAILURE,
      'notification-helpers'
    );
    throw error;
  }
}

/**
 * Create notification ID from URL
 * @param url URL to encode
 * @returns Notification ID
 */
export async function createNotificationId(url: string): Promise<string> {
  return encodeUrlSafeBase64(url);
}

/**
 * Extract URL from notification ID
 * @param notificationId Notification ID
 * @returns Decoded URL
 */
export async function getUrlFromNotificationId(notificationId: string): Promise<string> {
  return decodeUrlFromNotificationId(notificationId);
}
