/**
 * compareStrings.ts
 * 文字列の昇順比較（Array.prototype.sort 用の共通コンパレータ）。
 * ロケール非依存のコードポイント順。i18n の表示順ソートには使わない。
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
