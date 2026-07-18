# PBI: saveSqliteStepの無意味な楽観的ロック呼び出しを削除

## ユーザーストーリー
開発チームとして、`saveSqliteStep` から実質的に効果のない楽観的ロック処理を削除したい、なぜなら現状の `withOptimisticLock` 呼び出しは戻り値が破棄されており、後続のSQLite書き込みに一切影響を与えず、READ×2+WRITE×1のレイテンシを無駄に追加しているだけだから

## ビジネス価値
- 不要なI/O呼び出し（chrome.storage.localへの読み書き）を削減し、記録処理のレイテンシを改善
- コードの意図を明確化（「ロックしているように見えるが実際は何も保護していない」という誤解を招くコードを除去）

## 実装者向け注記（フェーズ0の既実装確認結果）

深掘り調査済み（side-effects.md M32セクションで詳細記録済み。本PBIはその調査結果に基づく）:
- `src/background/pipeline/steps/saveSqliteStep.ts:18-22` — `withOptimisticLock` の戻り値は完全に破棄されており、後続の `params.sqliteClient.insert(params.record)`（24行目）には一切渡されていない
- コールチェーン実装まで追跡済み: `sqliteClient.insert()` → offscreen `SQLITE_INSERT` メッセージ → `recordsRepo.ts: insert()` → `IdbVfsBackend.ts:28-36`
- `IdbVfsBackend.ts:32` — 単体 `insert()` は `INSERT_SQL`（`INSERT OR IGNORE` ではない）を使用
- `schema.ts:43` — `UNIQUE(url, created_at)` 制約はテーブル定義でDBレベルに常時存在するため、楽観的ロックの有無に関わらず重複行がDBに2件入ることはない
- **結論（確定済み）**: ロック単純削除の副作用はなし。ただし単体insert経路は `INSERT OR IGNORE` ではないため、重複挿入の試行は「例外throw」という挙動になる（`saveSqliteStep.ts:35-40` でログ記録後re-throw）。この挙動はロックの有無と無関係に既に発生している

```bash
# 実装前の再確認コマンド
sed -n '1,45p' src/background/pipeline/steps/saveSqliteStep.ts
grep -n "UNIQUE(url" src/offscreen/schema.ts
```

**スコープ注記**: `insert()` を `INSERT_IGNORE_SQL` に変更する対処は本PBIのスコープ外（呼び出し元の `if (!insertResult)` 分岐や後続の `update()` 呼び出しの挙動が変わるため、別途検証が必要と側面調査で判明済み）。本PBIは楽観的ロック呼び出しの削除のみに限定する。

## BDD受け入れシナリオ

```gherkin
Scenario: 楽観的ロック削除後もSQLite書き込みが正常動作する
  Given 新しい閲覧記録を保存しようとしている
  When saveSqliteStepを実行する
  Then withOptimisticLock呼び出しなしでsqliteClient.insert()が直接実行される
  And レコードがSQLiteに正常に保存される

Scenario: 重複URL・作成日時のレコード挿入は従来通り例外がthrowされる
  Given 同一のurlとcreated_atを持つレコードが既にSQLiteに存在する
  When 同じurl/created_atのレコードを再度insertしようとする
  Then UNIQUE制約違反により例外がthrowされ、ログに記録された後re-throwされる（ロック削除前と同じ挙動）
```

## 受け入れ基準
- [ ] `saveSqliteStep.ts:18-22` の `withOptimisticLock` 呼び出しを削除
- [ ] `params.sqliteClient.insert(params.record)` への呼び出しは変更しない
- [ ] 重複挿入時の例外throw+ログ記録の既存挙動（35-40行目）は変更しない
- [ ] レイテンシが改善されること（READ×2+WRITE×1分のI/O削減）を確認

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- `saveSqliteStep` の正常系（新規URL挿入）テストが `withOptimisticLock` 削除後も引き続きパスすることを確認
- 重複挿入時の例外throwが引き続き発生することを検証するテストを追加（既存になければ）

### 単体テスト
- `saveSqliteStep` から `withOptimisticLock` への呼び出しが発生しないことを検証（モックの呼び出し回数アサーション）

## 実装アプローチ
- **Red**: `withOptimisticLock` が呼ばれないことを検証する単体テストを先に書く（モック関数の呼び出し回数チェック）
- **Green**: `withOptimisticLock` 呼び出しコードを削除

## 見積もり
1pt（1時間程度、削除+テスト調整のみ）

## 技術的考慮事項
- 依存関係: `withOptimisticLock` の他の呼び出し元（もしあれば）には影響しない、`saveSqliteStep.ts` 内のみの変更
- テスタビリティ: 既存のテストで `withOptimisticLock` がモックされていれば、呼び出し回数の検証は容易
- 非機能要件: パフォーマンス改善（レイテンシ削減）

## 落とし穴
- `withOptimisticLock` のimport文が他で使われていなければ、未使用importとして削除すること（lintエラー防止）
- 本PBIでは `insert()` を `INSERT_IGNORE_SQL` に変更する対処は行わない。もし将来的にそちらを検討する場合は、別PBIとして呼び出し元の分岐処理の挙動変化を含めて検証すること

## Definition of Done
- [ ] `withOptimisticLock` 呼び出しが削除されている
- [ ] 未使用importが削除されている
- [ ] 単体・統合テストが更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
