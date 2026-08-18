/**
 * piiStripper.ts
 * PIIデータをストリップするユーティリティ関数
 */

import type { MaskedItem, StrippedMaskedItem } from '../messaging/types.js';

/**
 * MaskedItem配列からPIIデータを含む可能性のあるoriginalフィールドを削除する。
 * 既に original を持たない項目（stripPiiFromMaskedItems 適用済み）が混在しても冪等に扱える。
 * @param items - MaskedItemの配列（string型も含む）
 * @returns originalフィールドが削除されたMaskedItemの配列
 */
export function stripPiiFromMaskedItems(items: (string | MaskedItem | StrippedMaskedItem)[]): (string | StrippedMaskedItem)[] {
  return items.map(item => {
    // string型の場合はそのまま返す
    if (typeof item === 'string') {
      return item;
    }
    return stripPiiFromMaskedItem(item);
  });
}

/**
 * 単一のMaskedItemからPIIデータを含む可能性のあるoriginalフィールドを削除する。
 * original を持たない項目（ストリップ済み）を渡された場合はそのまま返す（冪等）。
 * @param item - MaskedItem または StrippedMaskedItem
 * @returns originalフィールドが削除されたMaskedItem
 */
export function stripPiiFromMaskedItem(item: MaskedItem | StrippedMaskedItem): StrippedMaskedItem {
  if (!('original' in item)) {
    return item;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { original, ...strippedItem } = item;
  return strippedItem;
}