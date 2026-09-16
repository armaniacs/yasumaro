/**
 * urlHash.ts
 * ログ出力時に URL を伏せるためのハッシュ化。
 *
 * SHA-256 を使うが暗号プリミティブではない。用途はログのプライバシー保護に
 * 限られ、戻り値も `[hash:xxxx]` というログ向けの整形済み文字列で、鍵付き
 * 操作にも秘密の保持にも使えない。同じ性質を持つ piiSanitizer.ts と同様に
 * utils/ 直下へ置き、crypto/ の責務を暗号操作だけに絞る（PBI 2026-09-16-05）。
 */

import { getWebCrypto } from './crypto/primitives.js';

/**
 * URLのSHA-256ハッシュを生成し、先頭16文字のプレフィックス付き文字列を返す
 * ログ出力時のプライバシー保護用（URLの生値を直接ログに記録しないため）
 * @param {string} url - ハッシュ化するURL
 * @returns {Promise<string>} 先頭16文字のSHA-256ハッシュ値（プレフィックス付き）
 *
 * @example
 * const hash = await hashUrl('https://example.com/path');
 * // Returns: '[hash:a1b2c3d4e5f6a7b8]'
 */
export async function hashUrl(url: string): Promise<string> {
    const webcrypto = getWebCrypto();
    const msgBuffer = new TextEncoder().encode(url);
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `[hash:${hashHex.substring(0, 16)}]`;
}
