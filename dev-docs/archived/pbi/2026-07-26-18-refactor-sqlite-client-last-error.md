# PBI: SqliteClientのlastError手動更新パターンをcall()のfinallyで一元管理する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（内部実装のリファクタリング。全16メソッドに影響するため広めの回帰テストが必要）

## 実装メモ（2026-07-26）

フェーズ0確認で共通の`call<T>()`メソッド（`sqliteClient.ts:178`）が既に存在することを確認した。
`finally`ブロックでは`try`内のスコープ変数（`res`/`error`）が見えないため、当初検討した「`finally`で
一元管理」ではなく、`try`ブロックの成功・失敗各分岐内で直接`this.lastError`を設定する形にした
（実質的に`call()`内で一元管理という目的は達成、`finally`は使わない設計判断）。

全16メソッド（`init`, `insert`, `insertBatch`, `query`, `search`, `update`, `delete`, `toggleStar`,
`getCount`, `exportDb`, `backupDb`, `restoreDb`, `getStatus`, `clearAll`, `isSqliteHealthy`,
`runOpfsSpike`, `purgeOldRecords`, `purgeContent`, `insertAuditLog`, `queryAuditLog`）の
`if (!result.success) { this.lastError = result.error; return X; } this.lastError = null; return Y;`
という繰り返しパターンを`return result.success ? result.data : null;`（または`return result.success;`）
に簡潔化した。`getStatus()`のみ失敗時に追加の診断情報を返す特殊な戻り値のため、`this.lastError`の
重複設定行だけを削除し、条件分岐構造自体は維持した。

`lastError`参照箇所が`call()`内の4箇所（成功時1箇所、失敗時2箇所×catch含む）のみに一元化された
ことを確認。既存の`sqliteClient`関連テスト（6ファイル、54件）・型チェック・全テストスイート
（7372件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Data Integrity Expert からの指摘。`src/background/sqliteClient.ts` の全メソッドで `lastError` の手動更新パターンが繰り返されている（現状39箇所で `lastError` に言及）。更新漏れがあると古いエラー情報が残留するリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "lastError" src/background/sqliteClient.ts | head -30
grep -n "async call\|private call\|function call" src/background/sqliteClient.ts
```

既存の `call<T>()` メソッド（レビューで言及されている共通呼び出しラッパー）が既に存在するか確認する。存在すれば、そこに `finally` ブロックでの一元管理を追加するだけで済む可能性がある。

## 受け入れ基準（BDD）

```gherkin
Scenario: lastErrorがcall()のfinallyで一元管理される
  Given SqliteClientの各メソッド（insert, update, delete等）
  When これらが内部で共通のcall<T>()経由で実行される
  Then lastErrorの設定・クリアがcall()内のfinallyブロックのみで行われ、各メソッド内での手動更新が不要になる

Scenario: エラー発生時にlastErrorが正しく設定される
  Given SQLite操作が失敗する
  When call()経由でエラーが発生する
  Then lastErrorに該当エラーが設定される

Scenario: 成功時にlastErrorがクリアされる
  Given 直前の呼び出しでlastErrorが設定されていた
  When 次の呼び出しが成功する
  Then lastErrorがクリアされる（nullまたはundefinedになる）

Scenario: 既存の呼び出し元がlastErrorを参照する箇所が回帰しない
  Given lastErrorを参照している既存コード
  When リファクタリング後のSqliteClientを使う
  Then 既存と同じタイミング・内容でlastErrorが取得できる
```

## 受け入れ基準
- [ ] 全16メソッドの手動 `lastError` 更新箇所を洗い出す
- [ ] 共通の `call<T>()` メソッド（未実装なら新設）の `finally` ブロックで `lastError` の設定・クリアを一元管理する
- [ ] 各メソッド内の個別の `lastError` 更新コードを削除する
- [ ] 既存の `sqliteClient` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 各メソッドの成功時・失敗時で `lastError` が正しく設定/クリアされることを確認
- 既存のテストケース（全16メソッド分）が回帰しないことを確認

## 実装アプローチ

1. `sqliteClient.ts` の全メソッドの `lastError` 更新パターンを洗い出す
2. 共通の `call<T>()` ラッパーメソッドを設計（未実装なら新設、既存なら拡張）
3. 各メソッドを `call()` 経由に統一し、個別の `lastError` 更新コードを削除
4. 既存テストで回帰を確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存の `sqliteClient` テストが土台
- 非機能要件: 保守性、データ整合性（エラー状態の一貫性）

## Definition of Done
- [ ] lastErrorの管理がcall()のfinallyに一元化されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Data Integrity Expert指摘）
- 対象コード: `src/background/sqliteClient.ts`（全16メソッド）
