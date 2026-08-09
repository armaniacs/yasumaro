# PBI: dashboard SQLite のテスト専用 wrapper を削除する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（テストのみの変更。本番コードは無変更）
**種別**: ♻️リファクタリング（refactor）

---

## 背景

[2026-08-09-11](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md) で
本番とテストの deps 組み立てを `createSqliteClientDeps` に共有化したが、
**wrapper 関数 `handleDashboardSqlite` 自体は残した**。

呼び出しが72箇所あり、一括書き換えの回帰リスクが当時のスコープに見合わなかったため。
本 PBI でその残作業を行う。

## 現状

```typescript
// src/background/handlers/dashboardSqliteHandlers.ts
export async function handleDashboardSqlite(
    payload, sqliteClient, runMigration?, validConfirmToken?, runBackfill?, runCleanup?
): Promise<unknown>
```

| 呼び出し元 | 箇所数 |
|---|---|
| `src/background/handlers/__tests__/dashboardSqliteHandlers-extra.test.ts` | 42 |
| `src/background/__tests__/dashboardSqliteHandlers-append.test.ts` | 18 |
| `src/background/__tests__/dashboardSqliteHandlers.test.ts` | 12 |
| **本番** | **0** |

`src/__tests__/sqlite-security-integrity.test.ts` は
`service-worker.ts` のソーステキストを読む方式のため**本 PBI の影響を受けない**
（同名の別関数 `service-worker.ts:handleDashboardSqlite` を対象としている）。

## 問題

wrapper は6引数の位置引数を取り、うち4つは optional。
そのため呼び出し側は `handleDashboardSqlite(payload, mock as any, undefined, VALID_TOKEN)`
のように**意味の見えない `undefined` を挟む**必要がある。

また `createSqliteClientDeps` 共有化後、wrapper に残った独自ロジックは
「4つの optional 引数をスタブで埋める」ことだけであり、
テストヘルパとしての価値しか無い。**本番コードに置く理由が無い。**

## 方針

wrapper を削除し、テスト側に deps ビルダーを置く。

```
Before: handleDashboardSqlite(payload, mock, undefined, TOKEN)
After:  makeHandler(mock, { getConfirmToken: async () => TOKEN })(payload)
```

位置引数（意味が読めない）から名前付き上書き（意味が読める）への移行でもある。

### 移行方式

テストヘルパを `src/background/handlers/__tests__/dashboardSqliteTestHarness.ts` に置き、
3ファイルから import する。ヘルパは本番の `createSqliteClientDeps` を通すため、
[2026-08-09-11](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md) で
得た「本番と同じ配線をテストする」性質は維持される。

## 作業内容

- [x] テストハーネス（deps ビルダー）を `__tests__/` 配下に作る
- [x] `dashboardSqliteHandlers-extra.test.ts`（42箇所）を移行する
- [x] `dashboardSqliteHandlers-append.test.ts`（18箇所）を移行する
- [x] `dashboardSqliteHandlers.test.ts`（12箇所）を移行する
- [x] `handleDashboardSqlite`（handlers 側）を削除する
- [x] 本番コードから `ObsidianClient` / `getSettings` / `formatEntriesToMarkdown` の
      import が不要にならないか確認する
      → **いずれも `createSqliteClientDeps` が使用中のため削除しない**

## 実装結果

### 変更点

`src/background/handlers/__tests__/dashboardSqliteTestHarness.ts` を新規作成。

| 関数 | 用途 |
|---|---|
| `makeDashboardSqliteHandler(client, overrides?)` | handler を組み立てて返す |
| `dispatchDashboardSqlite(payload, client, overrides?)` | 1回きりの dispatch（旧wrapperと同形） |

本番の `createSqliteClientDeps` を通すため、
[2026-08-09-11](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md) で得た
「本番と同じ配線をテストする」性質は維持される。

### 位置引数から名前付き上書きへ

```typescript
// Before — undefined が何を意味するか読めない
handleDashboardSqlite({ subtype: 'clear_all' }, mock as any, undefined, VALID_TOKEN)
// After
dispatchDashboardSqlite({ subtype: 'clear_all' }, mock as any,
  { getConfirmToken: async () => VALID_TOKEN })

// Before — 4番目と6番目が何か分からない
handleDashboardSqlite(payload, mock as any, undefined, VALID_TOKEN, undefined, runCleanup)
// After
dispatchDashboardSqlite(payload, mock as any,
  { getConfirmToken: async () => VALID_TOKEN, runCleanup })
```

### テスト件数の保全（移行の正しさの検証）

「移行であって削除ではない」ことを担保するため、移行前に件数を記録して照合した。

| ファイル | 移行前 | 移行後 |
|---|---|---|
| `dashboardSqliteHandlers.test.ts` | 12 | **12** |
| `dashboardSqliteHandlers-extra.test.ts` | 42 | **42** |
| `dashboardSqliteHandlers-append.test.ts` | 18 | **18** |

アサーション内容は一切変更していない（呼び出し形式のみの変更）。

### 検証結果

- `src/background/` + `sqlite-security-integrity`: **1599件 通過**（118ファイル、8 skip）
- `npm run type-check`: 通過

## 完了条件

- `dashboardSqliteHandlers.ts` に wrapper が存在しない
- テスト件数が減っていない（移行であって削除ではない）
- `npm run validate` が通る

## 注意

**テストの意味を変えないこと。** 本 PBI は呼び出し形式の移行であり、
検証内容を変更してはならない。移行前後でテスト件数と各テストの
アサーション内容が一致することを確認する。

## 参照

- 前提: [2026-08-09-11](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md)
