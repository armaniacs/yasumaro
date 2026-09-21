# PBI: pageContentPipeline の content/pageState 値 import（utils↔content 循環）を解消する

## ユーザーストーリー
開発者として、preparePageContent を content script 文脈なしで再利用したい、なぜなら現状は utils 層のパイプラインが content 層の PageState を値 import しており、デフォルト config の所有者が曖昧で utils と content entrypoint が実行時参照で循環しているから

## 優先度
- 順位: 15
- RICEスコア: 2.4（Reach=3 / Impact=1 / Confidence=0.8 / Effort=1.0週）
- 根拠: 種別は refactor。production 呼び出し元は content 側のみで現状の動作不良はないため Impact は 1。循環は将来の再利用とテスト時の結合度を上げるため Reach は 3。Effort は依存方向の裁定と移動を含むため 1.0週

## ビジネス価値
CleansingConfig の型とデフォルト値の所有者が utils 側に一本化され、循環 import によるバンドル時の初期化順リスクとテスト時の意図しない pageState 引きずりが消える。preparePageContent が純粋な utils 関数として再利用可能になり、content 層の変更がパイプラインに波及しなくなる(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: 明示 config なしでも content 層なしでデフォルト解決できる
  Given content script 文脈が存在しない環境
  When preparePageContent を引数なしで呼び出す
  Then content 層の PageState を経由せず utils 側のデフォルト値で解決される

Scenario: 循環する値 import が存在しない
  Given pageContentPipeline と pageState の実装
  When import 方向を読む
  Then utils から content entrypoint への実行時参照が存在しない

Scenario: 明示 config 供給時は従来通り動作する
  Given 任意の CleansingConfig
  When preparePageContent に config を渡して呼び出す
  Then buildExtractionOptions から extractMainContentWithInfo までの結果が従来と等価である
```

## 受け入れ基準
- [x] `pageContentPipeline` から `content/pageState` への値 import が存在しない
- [x] `CleansingConfig` 型の公開 import パスが安定し、既存の呼び出し元が壊れない
- [x] 引数なし呼び出しのデフォルト解決が `PageState` インスタンス生成に依存しない
- [x] `pageState` は後方互換のため re-export のみ残すか、不要になれば値参照を断つ
- [x] 既存の content 側呼び出し(`extractPageContent` 経路)の出力が等価である
- [x] 既存テストが green である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部依存方向の改善)

### 統合テスト
- `extractPageContent` 経由の抽出結果が等価であること(呼び出し元は content 側のみ)
- 引数なし `preparePageContent` が content 文脈なしでデフォルト解決できること

### 単体テスト
- デフォルト解決が `PageState` 生成に依存しないこと(循環の回帰テスト)
- 明示 config 供給時の `buildExtractionOptions` 委譲が等価であること

## 実装アプローチ
- **Outside-In**: 循環の回帰テスト(utils から content への値 import 検出と引数なし呼び出しのデフォルト解決)を先に書き、Red で依存方向を修正する
- 案A(推奨): `CleansingConfig` 型とデフォルト値を `src/utils` 側へ移動し、`pageState` は re-export のみ残す
- 案B: パイプラインを `src/content` 側へ移動する
- 実装時に依存関係を読んで design-it-twice で案A/案Bを裁定し、選択理由を記録する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `2026-09-21-08` と `src/content/contentKernel.ts` が重複するため、実行順は 08 の後(バッチ4)
- 公開 API 安定: `CleansingConfig` の公開 import パスを維持し、呼び出し元の変更を最小にする
- 非機能要件: 既存テスト green。抽出出力の等価性を保つ

## 実装者向け注記

### 現状の証拠
- 値 import(循環の起点): `src/utils/pageContentPipeline.ts:19-20` — `import type { CleansingConfig }` に加えて `import { PageState } from '../content/pageState.js'` を値 import
- デフォルト解決の所有者曖昧: `src/utils/pageContentPipeline.ts:52-53` — `config ?? new PageState().cleansingConfig`
- 逆方向の参照: `src/content/pageState.ts:11-13` — `../utils/aiSummaryCleaner/rules.js` の値 import と `../utils/contentCleaner.js` の値 importにより utils と content entrypoint が実行時参照で循環
- 正規の型消し形状: `src/utils/contentExtractor/optionBuilder.ts:12` — `import type { CleansingConfig }` の型のみ import
- production 呼び出し元は content 側のみ: `src/content/contentKernel.ts:18` の `preparePageContent` import と `src/content/contentKernel.ts:141-142` の `extractPageContent` からの委譲付近

## Definition of Done
- [x] 全BDDシナリオ実装+パス
- [x] コードレビュー完了
- [x] 統合検証 green
