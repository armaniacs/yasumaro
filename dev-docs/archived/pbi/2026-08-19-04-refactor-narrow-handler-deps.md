# PBI: Narrow the handler dependency seam

## ユーザーストーリー
開発者として、各メッセージハンドラーが必要な依存だけを宣言する状態がほしい。なぜならハンドラーのテストセットアップが最小限になり、不要な依存をモックする必要がなくなるから。

## 優先度
- 順位: 04 / 05
- RICEスコア: 2.10（Reach=4 / Impact=1.5 / Confidence=70% / Effort=2 人週）
- 根拠: ADR 2026-07-13 (#4) で「handler の依存を必要メソッドのみに絞る」ことが決定されたが未実施。影響範囲は全 15 ハンドラーに及ぶが、型変更のみで挙動は不变。

## BDD受け入れシナリオ
Scenario: 各ハンドラーが自身に必要な依存だけを宣言する
  Given `CommonHandlerDeps` という共通依存（`getSettings` 等）を定義したベースインターフェースがある
  And `VALID_VISIT` ハンドラーが `RecordingHandlerDeps` (extends `CommonHandlerDeps`) を実装している
  And `TEST_CONNECTIONS` ハンドラーが `TestingHandlerDeps` (extends `CommonHandlerDeps`) を実装している
  When ハンドラーファクトリに依存を注入する
  Then 各ハンドラーのテストでは、必要な依存だけをモックすればよく、不要なフィールドは存在しない

Scenario: 既存のメッセージ登録が変更なしで動作する
  Given サブインターフェースに分割された依存オブジェクト
  When `createMessageRegistryComposition` がハンドラーを登録する
  Then すべてのメッセージタイプが以前と同じように処理され、クライアントへの影響がない

## 受け入れ基準
- [x] `MessageHandlerRegistryDeps` がサブインターフェース（`RecordingHandlerDeps`、`TestingHandlerDeps`、`SystemHandlerDeps` など）に分割されている
- [x] 各ハンドラーファクトリが必要な依存だけを宣言する
- [x] `CommonHandlerDeps` などの共通依存をベースインターフェースとして抽出し、各サブインターフェースが extends する
- [x] `createBackgroundServices.ts` でサブ依存オブジェクトが生成され、適切なハンドラーグループに渡されている
- [x] `createMessageRegistryComposition.ts` が薄すぎる中継層になっていないか再評価し、不要なら削除または統合する
- [x] 各ハンドラーの単体テストが narrow 化された依存を注入するよう更新されている
- [x] 既存の `messageHandlerRegistry.test.ts` が変更なしでパスする

## テスト戦略
- 単体: 各ハンドラーファクトリのテストで、必要な依存だけを注入してテスト
- 統合: `createMessageRegistryComposition` のテストが全ハンドラーの登録を検証
- E2E: ポップアップ→SW メッセージの一連の流れが正常に動作

## リスクと留意事項
- `createMessageRegistryComposition.ts` は「18 依存を並べるだけ」の shallow モジュールになっている可能性がある。narrow 化後に削除または `createBackgroundServices.ts` へ統合を検討する
- 各ハンドラーのテストファイルで使用されているモックオブジェクトは、新しい narrow deps に合わせて削減する
- `manualRecordDeps` / `saveRecordDeps` は既に narrow 化されているため、これらを `RecordingHandlerDeps` にどう統合するか設計が必要

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（該当する場合のみ）
- [x] `MessageHandlerRegistryDeps` の 18 フィールドがサブインターフェースに分割されている
