// @layer 0 — Foundation (pure, no dependencies)
/**
 * objectUtils.ts
 * オブジェクト操作の共通ユーティリティ
 */

/**
 * exactOptionalPropertyTypes 下で、値が undefined のプロパティをキーごと省略する。
 *
 * `{ key: value }` の value が `T | undefined` な場合、通常の代入では
 * exactOptionalPropertyTypes によりキーの省略ではなく明示的な undefined 代入とみなされ
 * `key?: T` へは代入できない。この関数は undefined なプロパティを実際に削除することで
 * 「値があるときだけキーを持つ」という意図をランタイム・型の両方で一致させる。
 */
type PickDefinedResult<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

export function pickDefined<T extends object>(obj: T): PickDefinedResult<T> {
    const result: PickDefinedResult<T> = {};
    for (const key of Object.keys(obj) as (keyof T)[]) {
        const value = obj[key];
        if (value !== undefined) {
            result[key] = value as PickDefinedResult<T>[typeof key];
        }
    }
    return result;
}

/**
 * 値が null でないオブジェクト（配列を除く）かを判定する共通ガード。
 *
 * storage 系モジュールが untrusted な unknown 値（暗号封筒・レガシー設定など）を
 * プレーンオブジェクトへ絞り込むための 1 箇所の条件であり、null / typeof / 配列の
 * 判定はここだけに置く（PBI: asRecord と isPlainRecord の共通ガード統合）。
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
