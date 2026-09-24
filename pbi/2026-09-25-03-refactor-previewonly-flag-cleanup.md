# PBI: previewOnly フラグの二重判定と不要 cast の削除

## ユーザーストーリー

録画パイプラインの挙動を1箇所で追跡したい保守者として、録画入口の `previewOnly` 判定を `RecordingData.previewOnly` に一本化し、二重判定と不要な型キャストを削除してほしい、なぜなら production は data 側だけに値を渡しており、既存の型だけで分岐を追跡できるはずだから。

## ビジネス価値

- 録画入口の判定元を `RecordingData.previewOnly` に統一し、保守者が分岐の正体を推測しないようにする。
- 型に定義済みの `previewOnly` を直接参照することで、不要な型キャストを削除する。
- preview 時の Obsidian 書込抑止と public `preview()` の表面契約を変更せずに、録画パイプラインを単純化する。

## 優先度

- 順位: 03 / 30
- RICEスコア: 8.0（Reach=8 / Impact=0.5 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: data 側の previewOnly が録画を preview 経路へ正規化する
  Given production から previewOnly が true に正規化された RecordingData が渡される
  When 録画パイプラインの入口を実行する
  Then  preview breakpoint step まで実行される
  And  save tail へ進まず、preview の Obsidian 書込も実行されない

Scenario: data 側の previewOnly が通常録画を許可する
  Given production から previewOnly が false または未指定の RecordingData が渡される
  When 録画パイプラインを実行する
  Then  preview 処理をせずに既存の通常録画処理が続く

Scenario: public preview の表面契約を維持する
  Given previewOnly の判定元を整理した実装である
  When public surface を検証する
  Then public preview() は維持されている
  And data.previewOnly の8通りのフラグ組み合わせで既存の録画結果が変わらない
```

## 受け入れ基準

- [ ] `RecordOptions.previewOnly` を削除するか互換で残すかを裁定し、裁定結果を `src/background/pipeline/RecordingOrchestrator.ts` の入口判定へ反映している
- [ ] `src/background/pipeline/RecordingOrchestrator.ts:131` の `opts.previewOnly || data.previewOnly` を廃止し、入口では `data.previewOnly` を判定している
- [ ] `src/background/pipeline/RecordingOrchestrator.ts:131` の `(data as { previewOnly?: boolean }).previewOnly` を削除している
- [ ] `src/background/pipeline/RecordingOrchestrator.ts:139` の `{ ...data, previewOnly: true } as RecordingData` を、型キャストなしの形へ整理している
- [ ] `src/messaging/types.ts:172` の `RecordingData.previewOnly?: boolean` を維持している
- [ ] `src/background/pipeline/RecordingOrchestrator.ts:196` の `data.previewOnly` 判定を維持している
- [ ] public `preview()` を維持している
- [ ] `src/background/recordRequestBuilder.ts:229-233` と `src/background/handlers/recordingHandlers.ts:265-273` による data 側の正規化を前提とした既存動作を維持している
- [ ] production の `record()` 呼び出し8箇所の契約を維持している
- [ ] ESM import の `.js` 拡張子と async/await のみという制約を守っている

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 新しいブラウザE2Eは追加せず、既存の production 動作が変わっていないことを確認する
- public `preview()` は production から直接呼び出されないため、表面契約の検証で維持を確認する

### 統合テスト

- `src/background/pipeline/__tests__/RecordingPipeline.flags.test.ts` で `data.previewOnly` の8通りのフラグ組み合わせを検証する
- `src/background/pipeline/__tests__/RecordingPipeline.test.ts:317-373` で既存の preview と通常録画の両経路を検証する
- `src/background/pipeline/__tests__/RecordingPipeline-r2.test.ts` で影響範囲の録画パイプライン挙動を検証する
- preview 時に preview breakpoint step 後の save tail と Obsidian 書込へ進まないことを確認する

### 単体テスト

- `src/background/pipeline/__tests__/orchestrator-surface.test.ts` で public `preview()` の surface 契約を維持する
- 型チェックで `data.previewOnly` を直接参照でき、2箇所の型キャストが不要であることを確認する
- 実装レビューで入口の二重判定が除去され、`src/background/pipeline/RecordingOrchestrator.ts:196` の実行時判定が残ることを確認する

## 実装アプローチ

1. `RecordOptions.previewOnly` の扱いを裁定する。production caller が0件であることを削除根拠にしつつ、public surface 契約への影響を確認する。
2. 既存テストを基準に、data 側の previewOnly による preview 経路と通常録画経路の振る舞いを固定する。
3. 録画入口の判定を `data.previewOnly` のみに統一する。
4. `RecordingData` に型が定義されていることを利用し、2箇所の型キャストを削除する。
5. preview breakpoint step 後の `data.previewOnly` 判定を維持し、save tail へ進まない実行時制御を変えない。
6. public `preview()` と production の data 側正規化を維持する。
7. 依存PBIとの編集順を調整したうえで、型チェックと関連テストで変更を確認する。

## 見積もり

- 0.5 SP
- 難易度: 低

## 技術的考慮事項

- 判定 SSOT は `RecordingData.previewOnly` とし、`RecordingData` の型所有者は `pbi/2026-09-25-20-doc-messaging-layer-decision-record.md` と調整する
- `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` も同じファイルの import 変更を行うため、編集順を揃える
- `src/background/pipeline/RecordingOrchestrator.ts:196` は breakpoint step 実行後に save tail を止める判定であり、入口の正規化とは責務が異なる
- `RecordingData.previewOnly` は複数の pipeline step が参照するため、削除してはいけない
- public `preview()` は現行 surface 契約であり、削除してはいけない
- 変更範囲は型と条件判定の整理に限定し、production の8箇所の `record()` 呼び出し契約を変更しない

## 実装者向け注記

### 現状コードの確認

- `src/messaging/types.ts:172` に `RecordingData.previewOnly?: boolean` が存在する
- `src/background/pipeline/RecordingOrchestrator.ts:55-57` に `RecordOptions.previewOnly` が定義されているが、production caller は0件である
- `src/background/pipeline/RecordingOrchestrator.ts:131` に `opts.previewOnly || data.previewOnly` と不要な型キャストがある
- `src/background/pipeline/RecordingOrchestrator.ts:139` に不要な `RecordingData` への型キャストがある
- `src/background/pipeline/RecordingOrchestrator.ts:196` に save tail の実行可否を決める `data.previewOnly` 判定がある
- production は `src/background/recordRequestBuilder.ts:229-233` と `src/background/handlers/recordingHandlers.ts:265-273` で data 側を正規化して渡す
- public `preview()` の直接 production call は0件だが、surface 契約として維持する
- 関連テストは `RecordingPipeline.flags.test.ts`、`RecordingPipeline.test.ts:317-373`、`orchestrator-surface.test.ts`、`RecordingPipeline-r2.test.ts` である

### 実装手順

1. `RecordOptions.previewOnly` を削除するか互換で残すかを裁定する
2. 既存テストで data 側の previewOnly による挙動を確認する
3. 入口の `opts.previewOnly || data.previewOnly` を `data.previewOnly` に置き換える
4. 2箇所の型キャストを削除し、`RecordingData` の型定義だけで参照できるようにする
5. `src/background/pipeline/RecordingOrchestrator.ts:196` の判定と public `preview()` を維持する
6. 依存PBIとの変更内容と編集順を照合する
7. 型チェックと関連テストを実行し、preview と通常録画の挙動が変わっていないことを確認する

### 落とし穴

- `src/background/pipeline/RecordingOrchestrator.ts:196` を二重判定と誤認して削除すると、preview の Obsidian 書込が実行される
- public surface テストだけでは、`RecordingData` に定義済みである `previewOnly` の不要な型キャストや、不要な `RecordOptions.previewOnly` を検出できない
- `RecordOptions.previewOnly` の扱いを未裁定のまま実装すると、型定義と production の実際の判定元にずれが残る
- 依存PBIと競合する import と型所有者の変更を別々に適用すると、意図しない差分や解決漏れが発生する

## 決定事項

- 判定 SSOT は `RecordingData.previewOnly` とする
- `RecordingData.previewOnly` は複数の pipeline step が必要なので維持する
- public `preview()` は現行 surface 契約として維持する
- `RecordOptions.previewOnly` は、production caller が0件である点を削除根拠に、削除するか互換で残すかを裁定する
- `src/background/pipeline/RecordingOrchestrator.ts:196` の実行時判定は維持し、入口の正規化とは区別する

## Definition of Done

- [ ] `RecordOptions.previewOnly` の扱いを裁定し、型定義と実装を一致させている
- [ ] 入口の二重判定と2箇所の不要な型キャストを削除している
- [ ] `RecordingData.previewOnly` と `src/background/pipeline/RecordingOrchestrator.ts:196` の実行時判定を維持している
- [ ] public `preview()` の surface 契約を維持している
- [ ] `RecordingPipeline.flags.test.ts`、`RecordingPipeline.test.ts:317-373`、`orchestrator-surface.test.ts`、`RecordingPipeline-r2.test.ts` と必要な追加テストがパスする
- [ ] type-check、lint、test、build がパスする
- [ ] 依存PBIとの型所有者と import の変更が競合なく反映されている
- [ ] コードレビューが完了している
