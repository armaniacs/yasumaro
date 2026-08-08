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

- [x] deps 組み立てを共有ファクトリ `createSqliteClientDeps` に集約する
- [x] `service-worker.ts` を共有ファクトリ経由に変更する
- [x] wrapper を共有ファクトリ経由に変更する
- [x] `sqlite-security-integrity.test.ts` の参照を確認する
      → ソーステキストを読む方式のため**影響なし**
- [x] 本番でのみ通っていた `runMigration` / `getConfirmToken` /
      `runBackfill` / `runCleanup` の経路に対するテストを**新規に追加**する（11件）
- [ ] ~~wrapper を削除する~~ → **方針変更**（下記）

## 実装結果

### 方針変更: wrapper の削除ではなく「配線の共有」

起票時は wrapper 削除を想定したが、呼び出しが**72箇所**（12/42/18）あり、
位置引数の形も複数種類あるため、一括書き換えは回帰リスクが高いと判断した。

代わりに、**両者が同じ deps 組み立て関数を通る**形にした：

```
Before: wrapper       → 独自に20キーを組み立て（4つはスタブ）
        service-worker → 独自に20キーを組み立て（4つは実処理）
                         ↑ 2つが独立に育ち、実際に食い違っていた

After:  wrapper       ┐
                      ├→ createSqliteClientDeps(client, {SW固有の4つ})
        service-worker┘
```

これで「SqliteClient 由来の16キー」は**両者で必ず同一**になる。
食い違いうるのは Service Worker が所有する4つだけで、
それらは今回テストを追加した。

### 発見: 本番と wrapper で `query` の呼び方が違っていた

```typescript
// service-worker.ts（修正前）
query: (params) => sqliteClient.query(params as any),   // as any あり
// wrapper（修正前）
query: (params) => sqliteClient.query(params),          // as any なし
```

共有化によりこの差異も解消した。

### 追加テスト（11件）

`dashboardSqliteHandlers-wiring.test.ts` を新規作成。
**wrapper がスタブ化していたため一度もテストされていなかった4依存**を対象とする。

- migrate: 成功時の件数伝播 / 失敗時のエラー伝播
- confirm_token: SW発行トークンの返却
- **トークン不一致・トークン未指定で破壊的操作が拒否されること**（2件）
- トークン一致時に `clearAll` が実行されること
- backfill: 件数返却 / 例外時に throw せず error を返すこと
- cleanup: 削除内容の返却
- 共有配線経由で `lastError` の具体的文言が伝わること

### 実装中の気づき

最初 `migrate` / `backfill_metadata` / `cleanup_legacy` にトークンを渡さず
テストを書いたところ5件が落ちた。原因は**これらが `TOKEN_REQUIRED_SUBTYPES`
に含まれており、正しく拒否されていた**ため。

テスト側の誤りだったが、結果として
「トークンなしでは破壊的操作が通らない」ことの確認になったため、
その観点を明示的なテストとして残した。

### 検証結果

- `src/background/` 全体: **1581件 通過**（116ファイル、8 skip）
- `npm run type-check`: 通過

### 残作業

wrapper 自体の削除は未実施。72箇所の呼び出し移行として
独立した PBI で扱うのが妥当（本 PBI の主目的である
「本番配線がテストされていない」状態は解消済み）。

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
