/**
 * piiStripper.ts
 * PIIデータをストリップするユーティリティ関数
 */

import type { MaskedItem } from '../messaging/types.js';

/**
 * MaskedItem配列からPIIデータを含む可能性のあるoriginalフィールドを削除する
 * @param items - MaskedItemの配列（string型も含む）
 * @returns originalフィールドが削除されたMaskedItemの配列
 */
export function stripPiiFromMaskedItems(items: (string | MaskedItem)[]): (string | MaskedItem)[] {
  return items.map(item => {
    // string型の場合はそのまま返す
    if (typeof item === 'string') {
      return item;
    }
    // originalフィールドを削除した新しいオブジェクトを作成
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { original, ...strippedItem } = item;
    return strippedItem;
  });
}

/**
 * 単一のMaskedItemからPIIデータを含む可能性のあるoriginalフィールドを削除する
 * @param item - MaskedItem
 * @returns originalフィールドが削除されたMaskedItem
 */
export function stripPiiFromMaskedItem(item: MaskedItem): Omit<MaskedItem, 'original'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { original, ...strippedItem } = item;
  return strippedItem;
}