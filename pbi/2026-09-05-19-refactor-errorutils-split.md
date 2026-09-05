# PBI: errorUtils.ts 同名異責モジュールを分割・改名

## ユーザーストーリー
拡張機能の開発者として、エラー関連モジュールの責務は名前から一意に分かるようにしてほしい、なぜなら同名の `ErrorType` が複数モジュールに並存すると import 時に混同し誤った分類を使う恐れがあるから

## 優先度
- 順位: 14 / 26
- RICEスコア: 800（Reach=500 / Impact=1 / Confidence=0.8 / Effort=0.5日）
- 根拠: 誤分類はユーザー向け文言の誤表示に直結する保守性リスク。統合作業の大半は済んでおり、残作業は旧 shim の削除のみで工数が小さい。

## BDD受け入れシナリオ
```gherkin
Scenario: エラー分類の単一ソースが使われる
  Given 任意のエラー値
  When  分類・ユーザー向け文言・レスポンス生成を行う
  Then  `errorClassification` の定義が使われ、同名の並列定義は存在しない

Scenario: 既存の呼び出し元は壊れない
  Given 既存の `errorMessage` 利用箇所
  When  本リファクタ後のコードでビルドとテストを実行する
  Then  import パス変更なしに全テストがパスする
```

## 受け入れ基準
- [ ] 非推奨 shim の `errorMessages.ts` が削除され、`errorClassification.ts` への直接参照に統一される
- [ ] `errorUtils.ts` の `errorMessage()` は公開 API として維持される（削除する場合は再エクスポートを残す）
- [ ] 同名の `ErrorType` 並列定義が残っていないことが grep で確認できる

## テスト戦略
- 単体: `errorMessages.test.ts` の対象を `errorClassification.ts` に付け替え、同等の分類・文言アサーションがパスすることを検証する
- 回帰: `errorMessage` の全利用箇所を含む既存スイートがパスすること（type-check 含む）

## 実装アプローチ
`errorClassification.ts` を単一ソースとして確定し、旧 shim の `errorMessages.ts`（再エクスポート＋非推奨ラッパー2関数）を削除して唯一の消費者であるテストの import を付け替える。`errorUtils.ts` の `errorMessage()` は多用されている純粋関数のため現状維持し、移動する場合は再エクスポートで互換性を保つ。

## 見積もり
1ポイント（0.5日相当：shim 削除とテスト付け替え、利用箇所の grep 確認が中心）

## 実装者向け注記
- スコープ補正: 当初指摘の「同名異責の並列システム」は調査時点で解消済み。`errorUtils.ts` は14行の `errorMessage()` のみに縮小済みで、`errorClassification.ts:1-6` のヘッダが統合済みであることを明記している。`errorMessages.ts:1-5` は再エクスポート shim であることを自認し、唯一の本番外消費者は `src/utils/__tests__/errorMessages.test.ts:14` のみ。本PBIの実作業は shim 削除とテスト付け替えに縮小する
- 確認済み現状: `errorMessage` は約30箇所以上で import されており（dashboardGateway・各種 handler・logger 系など）、安易な改名・移動は差分を肥大化させる。`rg -n "from.*errorUtils|errorMessage" src/ --glob '!*.test.ts'` で全量確認すること
- 調査コマンド: `rg -n "from.*errorMessages|errorClassification" src/`、`rg -n "ErrorType" src/utils/ --glob '!*.test.ts'`
- 注意: `sqliteRpcClient.ts:43` の `categorizeError` は別モジュールの同名関数であり、本スコープ外。混同して変更しないこと

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（該当ガイドがあれば）
