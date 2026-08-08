# PBI: dashboard SQLite ハンドラの配線二重化を解消する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡あり（テスト100箇所以上の呼び出し形式が変わる）
**種別**: ♻️リファクタリング（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補2）で、
**テストが検証している配線を本番では誰も通らない**ことが判明した。

### 問題: 同じ deps を組み立てる配線が2箇所ある

| 配線 | 場所 | 本番呼び出し | テスト呼び出し |
|---|---|---|---|
| `createDashboardSqliteHandler` | `service-worker.ts:388-429` | **あり** | なし |
| `handleDashboardSqlite`(wrapper) | `dashboardSqliteHandlers.ts:342-379` | **0件** | 100箇所以上 |

wrapper 自身が `Backward-compatible wrapper for tests.` とコメントしている。
`entrypoints/` `scripts/` `testDir/` を含む全リポジトリ grep で本番呼び出し0件を確認済み。

### 実害: 本番の実処理がテストされていない

wrapper は4つの依存を**スタブに差し替えている**：

```typescript
// dashboardSqliteHandlers.ts:366-369
runMigration: runMigration ?? (async () => ({ success:false, error:'Migration not available', count:0 })),
getConfirmToken: async () => validConfirmToken ?? '',
runBackfill: runBackfill ?? (async () => { throw new Error('Backfill not available'); }),
runCleanup:  runCleanup  ?? (async () => { throw new Error('Cleanup not available'); }),
```

本番（`service-worker.ts:404-421`）では、これらは実処理である：

- `runMigration`: ストレージキー削除 → 件数差分計算 → `migrationService.run()`
- `getConfirmToken`: `ensureConfirmToken()` による実トークン検証
- `runBackfill` / `runCleanup`: `migrationService` の実メソッド

**つまり migration・トークン検証・backfill・cleanup の本番経路は未テストである。**

### 名前の衝突に注意

`handleDashboardSqlite` という名前は**2つ存在する**。作業時に混同しないこと：

| 名前 | 場所 | 役割 |
|---|---|---|
| `handleDashboardSqlite` | `service-worker.ts:431` | メッセージルータ（sender検証 + sendResponse）。**registry に登録されるのはこちら** |
| `handleDashboardSqlite` | `dashboardSqliteHandlers.ts:342` | deps 組み立て wrapper（テスト専用）。**本 PBI の削除対象** |

## 方針

deps を組み立てる場所を**本番の1箇所に集約**し、テストは
「完全な deps を作るヘルパー + 必要な依存だけ差し替え」の形に変える。

wrapper を単純削除するとテスト100箇所以上の書き換えが必要になるため、
**テスト用の deps ファクトリを提供**して移行コストを下げる。

```
Before: テスト → wrapper(sqliteClient, ...) → createDashboardSqliteHandler(20キー)
After:  テスト → createDashboardSqliteHandler(makeTestDeps({ query: ... }))
                 本番   → createDashboardSqliteHandler(本番の20キー)
```

## 作業内容

- [ ] テスト用 deps ファクトリを用意する（既定値 + 部分上書き）
- [ ] `dashboardSqliteHandlers-extra.test.ts` をファクトリ経由に移行する
- [ ] `dashboardSqliteHandlers.test.ts` を移行する
- [ ] `dashboardSqliteHandlers-append.test.ts` を移行する
- [ ] `sqlite-security-integrity.test.ts` の参照を確認・移行する
- [ ] `handleDashboardSqlite`（handlers 側 wrapper）を削除する
- [ ] 本番でのみ通っていた `runMigration` / `getConfirmToken` の
      経路に対するテストを**新規に追加**する

## 完了条件

- `dashboardSqliteHandlers.ts` から wrapper が消える
- テストが本番と同じ `createDashboardSqliteHandler` を使う
- migration / confirmToken の実処理に対するテストが存在する
- `npm run validate` が通る

## 備考: PBI-10 との順序について

当初「11 を先にしないと 10 の修正を証明できない」と考えたが、調査の結果
**その制約は無い**ことが分かった（wrapper も production も同じく事前スナップショットであり、
テストが素通りするのは mock に `lastError` が無いためだった）。

したがって **10 → 11 の順で問題ない**。10 は1pt で実害が大きいため先に片付ける。

## 参照

- アーキテクチャレビュー 2026-08-09 候補2
- ADR 2026-07-13 決定 #4（handler 依存の絞り込み）の**実行漏れ**であり、矛盾ではない
- 関連: [2026-08-09-10](2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md)
