# PBI: RecordingData を単一ソースに統一する

## ユーザーストーリー
開発者として、`RecordingData` が messaging/types.ts と recordingLogic.ts の2箇所で異なるフィールドセットで定義されている状態を解消したい。なぜなら、2つの定義がドリフトするとフィールドの追加・変更が片方だけに反映され、型レベルでの整合性が失われるから。

## ビジネス価値
- 型の二重定義によるドリフトリスクを排除する
- パイプラインステップが参照するフィールド集合を1箇所で管理できる
- `MAX_RECORD_SIZE` の重複も同時に解消される

## BDD受け入れシナリオ

```gherkin
Scenario: RecordingData の単一ソース
  Given messaging/types.ts と recordingLogic.ts に RecordingData が定義されている
  When パイプラインステップが RecordingData をインポートする
  Then 1つの canonical 定義からインポートされる
  And 2つの定義が存在しない

Scenario: フィールド追加時の整合性
  Given RecordingData に新規フィールドを追加する
  When パイプラインステップがそのフィールドを参照する
  Then 型チェッカーがコンパイルエラーを報告する
  And フィールドが2つの定義で食い違うことはない

Scenario: MAX_RECORD_SIZE の単一ソース
  Given MAX_RECORD_SIZE が pipeline/types.ts と recordingValidator.ts の2箇所に定義されている
  When 値を変更する
  Then 1箇所の変更で全箇所に反映される
```

## 受け入れ基準
- [ ] `RecordingData` が pipeline/types.ts に1つだけ定義されている
- [ ] messaging/types.ts は pipeline/types.ts から re-export している
- [ ] recordingLogic.ts の RecordingData 定義が削除されている
- [ ] `MAX_RECORD_SIZE` が pipeline/types.ts に1つだけ定義されている
- [ ] recordingValidator.ts の `MAX_RECORD_SIZE` が削除され、pipeline/types.ts から re-export されている
- [ ] `npm run validate` が通過している
- [ ] 既存テストがすべてパスしている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- RecordingData の型が正しく re-export されていることを検証する型レベルテスト

### 単体テスト
- 新規RecordingData を使用するパイプラインステップの既存テストがパスすることを確認

## 実装アプローチ
- **Outside-In**: 既存の呼び出し箇所を特定し、canonical定義を決めてから順次置換
- **Red-Green-Refactor**: 置換後に型エラーが発生する場合のみ修正

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 型レベルの変更のみ
- リスク: 低（再エクスポートで既存パスを維持）

## 実装者向け注記

### 現状コードの確認
```bash
# RecordingData の定義義箇所を検索
grep -rn "interface RecordingData" src/
# MAX_RECORD_SIZE の定義箇所を検索
grep -rn "MAX_RECORD_SIZE" src/ --include="*.ts"
```

### 実装手順
1. pipeline/types.ts に canonical RecordingData を定義
2. messaging/types.ts の RecordingData を pipeline/types.ts から re-export に変更
3. recordingLogic.ts の RecordingData 定義を削除し、pipeline/types.ts から re-export
4. pipeline/types.ts の MAX_RECORD_SIZE を1つだけに集約
5. recordingValidator.ts の MAX_RECORD_SIZE を pipeline/types.ts から re-export
6. `npm run validate` で型エラーがないことを確認

### 落とし穴
- recordingLogic.ts の RecordingData は messaging/types.ts より多くのフィールドを持つ。canonical定義にすべてのフィールドを含めること
- re-export パスが循環importにならないよう注意

## Definition of Done
- [ ] RecordingData が1箇所だけ定義されている
- [ ] MAX_RECORD_SIZE が1箇所だけ定義されている
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
