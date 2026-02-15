/**
 * Jest カスタムリゾルバー
 * .js 拡張子のインポートを .ts ファイルに解決する
 */

const path = require('path');
const fs = require('fs');

/**
 * モジュールを解決する
 * @param {string} modulePath - 解決しようとするモジュールパス
 * @param {object} options - Jestのリゾルバーオプション
 * @returns {string|null} 解決されたパス、またはnull
 */
module.exports = function resolver(modulePath, options) {
  const { defaultResolver, ...rest } = options;
  
  // まずデフォルトのリゾルバーで解決を試みる
  try {
    const resolved = defaultResolver(modulePath, rest);
    return resolved;
  } catch (e) {
    // デフォルト解決に失敗した場合、.js -> .ts の変換を試みる
    if (modulePath.endsWith('.js')) {
      // .js を .ts に変換
      const tsPath = modulePath.replace(/\.js$/, '.ts');
      
      try {
        // .ts ファイルとして解決を試みる
        return defaultResolver(tsPath, rest);
      } catch (tsError) {
        // .ts も失敗した場合、.tsx も試す
        try {
          const tsxPath = modulePath.replace(/\.js$/, '.tsx');
          return defaultResolver(tsxPath, rest);
        } catch (tsxError) {
          // すべて失敗した場合は元のエラーをスロー
        }
      }
    }
    
    // 元のエラーをスロー
    throw e;
  }
};
