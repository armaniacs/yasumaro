/**
 * logMasker.ts
 * データ出力用の機密情報マスキングモジュール
 *
 * 注意: このモジュールは後方互換性のために維持されている。
 * 新規コードでは sensitiveDataMask.ts を直接使用すること。
 */

import { maskSensitiveData as _maskSensitiveData } from './sensitiveDataMask.js';

/**
 * オブジェクト内の機密フィールドを再帰的にマスキングする。
 * ログ出力用（*** マスキング）。
 *
 * @deprecated sensitiveDataMask.ts の maskSensitiveData('partial') を使用すること
 */
export function maskSensitiveData(obj: unknown): unknown {
  return _maskSensitiveData(obj, 'partial');
}
