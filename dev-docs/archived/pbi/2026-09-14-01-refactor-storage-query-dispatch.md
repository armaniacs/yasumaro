# PBI: Storage query dispatch の queryPlanner への集約

## ユーザーストーリー
拡張機能の開発者として、`q.text` の有無に応じた検索/一覧の分岐判断を queryPlanner に一元化したい、なぜなら現在は OpfsWorkerBackend・IdbVfsBackend・storageFallback の3箇所に同じ分岐が独立して埋め込まれており、片方だけ直して片方を直し忘れるという回帰（4a1f6093, 43385d95）が既に2回発生しているため。

## 優先度
- 順位: 01 / 4（最初に着手）
- RICEスコア: 13.3（Reach=全ユーザー(検索機能全体) × Impact=2 × Confidence=100% / Effort=1.5人日）
- 根拠: 直近2回の同型回帰の根本原因であり、影響範囲が明確で実装コストも小さい。依存関係なし。

## 制約
- `StorageBackend` インターフェース（`query(q: StorageQuery)`）のシグネチャは変更しない
- OPFS / IDB / chrome.storage fallback の3バックエンドの既存の検索結果・一覧結果の挙動は変えない（内部の判断ロジックのみ移動する）
- `queryPlanner.ts` は既にFTS5サニタイズを行っており、mode決定の自然な置き場所とする

## BDD受け入れシナリオ

```gherkin
Scenario: text 付きクエリが全バックエンドで一貫して検索モードとして扱われる
  Given queryPlanner が plan.mode を "search" と決定したクエリがある
  When OpfsWorkerBackend / IdbVfsBackend / storageFallback のいずれかに渡す
  Then 各バックエンドは plan.mode を参照するだけで検索処理を実行する

Scenario: text なしクエリが全バックエンドで一貫して一覧モードとして扱われる
  Given queryPlanner が plan.mode を "listing" と決定したクエリがある
  When OpfsWorkerBackend / IdbVfsBackend / storageFallback のいずれかに渡す
  Then 各バックエンドは plan.mode を参照するだけで一覧処理を実行する

Scenario: normalizeStorageQuery が text を保持したまま queryPlanner に渡る
  Given text を含む生のクエリが normalizeStorageQuery に渡される
  When queryPlanner が正規化済みクエリから mode を導出する
  Then plan.mode が "search" になり、text が失われない
```

## 受け入れ基準
- [x] `queryPlanner.ts`（または `normalizeStorageQuery`）が `plan.mode`（"search" | "listing"）を一度だけ決定するようになっている
- [x] `OpfsWorkerBackend.ts`・`IdbVfsBackend.ts`・`storageFallback.ts` の `if (q.text)` 相当の分岐が削除され、`plan.mode` を読むだけになっている
- [x] 既存の検索/一覧の単体テストが全てパスする
- [x] 4a1f6093・43385d95 と同型の回帰を検知する回帰テスト（text 欠落時に mode が誤判定されないことを確認するテスト）を追加する

## テスト戦略
- E2E: 検索ボックスにテキストを入力して結果が返ることを確認する既存フローの再実行
- 統合: `queryPlanner` → 各バックエンドの `query()` の呼び出しが `plan.mode` を正しく伝播することを確認
- 単体: `queryPlanner` の mode 導出ロジック（text あり/なし、空文字、空白のみ等の境界値）

## 見積もり
3ポイント（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
