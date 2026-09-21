# PBI: extract/apply ペアの移行期残余を解消し extractAndCommit を唯一の経路にする

種別: refactor

## ユーザーストーリー

記録パイプラインを保守する開発者として、extract と apply のペア注入という移行期の残余を解消し、`extractAndCommit` を唯一の抽出経路にしてほしい。なぜなら深い1呼び出しの導入後もペア経路が残り続け、extract から commit への順序保証が呼び出し側に露出したままであり、config 既定の解決点が3箇所に分散しているため、既定変更のたびに複数箇所の同時編集が必要になるから。

## 優先度

- 順位: 5
- RICEスコア: 4.8 (Reach 3 / Impact 1 / Confidence 0.8 / Effort 0.5週)
- 根拠: 移行期残余の解消。前ラウンドで `extractAndCommit` の導入と deep call 優先配線は完了しており、本ラウンドは互換維持のための fallback 分岐とペア注入用 interface を narrow にする後始末である。残すほど分岐重複と既定分散の保守コストが残る。

## ビジネス価値

extract から commit への順序保証が kernel 内部に完全に閉じるため、呼び出し側の順序間違いや commit 漏れが構造的に起きなくなる。deps interface が `extractAndCommit` のみに narrow されるため、新規の呼び出し側が誤ってペア経路を選ぶ余地がなくなる。config 既定の解決点が kernel 内の1箇所に畳まれるため、既定変更が1箇所編集になり、分散した既定値の不整合による抽出結果のばらつきが排除される。

## BDD受け入れシナリオ

```gherkin
Scenario: visitReporter がペア注入なしで extractAndCommit のみに委譲する
  Given VisitReporterDeps に extractAndCommit のみが注入されている
  When report を実行する
  Then extractAndCommit が1回呼ばれ pageState の stat field が更新され VALID_VISIT 送信が行われる

Scenario: getContentHandler がペア注入なしで extractAndCommit のみに委譲する
  Given GetContentHandlerDeps に extractAndCommit のみが注入されている
  When GET_CONTENT メッセージを受信する
  Then extractAndCommit が1回呼ばれ pageState の stat field が更新され GET_CONTENT 応答が返る

Scenario: config 未指定時の解決点が kernel 内の1箇所である
  Given extractAndCommit に config を渡さない
  When 抽出を実行する
  Then pageState.cleansingConfig から解決された同一 config で抽出と確定が行われ facade や呼び出し側に既定引数が残っていない
```

## 受け入れ基準

- [ ] `VisitReporterDeps` から `extractor` と `applyResult` が削除され `extractAndCommit` のみで `report` が動作する
- [ ] `GetContentHandlerDeps` から `extractPageContent` と `applyExtractResultToPageState` が削除され `extractAndCommit` のみで応答が返る
- [ ] `visitReporter` と `getContentHandler` の prefer-deep-else-pair 分岐と非null assertion が削除されている
- [ ] config 既定の解決点が kernel 内の1箇所に集約され facade の既定引数が廃止されている
- [ ] ペア注入に依存するテストが deep call 注入へ移行し期待値変更なしで全件 green である
- [ ] `extractPageContent` 公開署名の残しと縮小の判断が design-it-twice の裁定として記録されている

## テスト戦略（t_wadaスタイル）

Outside-In で進め、挙動不変を parity で担保する。まず現行の deep call 経路とペア fallback 経路が同一入力で同一結果を返す parity テストを固定する (Red)。次にペア注入のテストを deep call 注入へ1件ずつ移行し (Green)、各移行で返却される `ExtractResult` と更新後の pageState の stat field が移行前後で等価であることを確認する (Refactor)。単体では deps narrow 後の `visitReporter` と `getContentHandler` が `extractAndCommit` をちょうど1回呼び出すことと、config 未指定時の解決値が kernel 内の1解決点と一致することを検証し、統合では `buildGetContentDeps` 経由の実 kernel 配線で VALID_VISIT 経路と GET_CONTENT 経路の両方の pageState 更新が一致することを検証する。既存 contentKernel テスト群は期待値変更なし green を前提とし、回帰検出に使う。

## 実装アプローチ

1. ペア注入に依存するテストを洗い出し deep call 注入へ移行する。移行リストは pair-based テストとする
2. `VisitReporterDeps` と `GetContentHandlerDeps` を `extractAndCommit` のみに narrow し、prefer-deep-else-pair 分岐と非null assertion を削除する
3. facade の既定引数を廃止し、config 既定の解決点を kernel 内の1解決点に畳む
4. `extractPageContent` 公開署名の残しと縮小を design-it-twice で裁定し、判断と理由を記録に残す
5. parity テストと既存 contentKernel テスト群で挙動不変を確認する

## 見積もり

1pt (0.5週)

## 技術的考慮事項

- deps narrow は破壊的変更であるため、移行対象のテスト洗い出しを先に行い、残存するペア注入者がないことを確認してから interface を狭める。呼び出し側に順序知識を残さない
- config 既定の畳み込みは値の変更を伴わない。`config ?? this.pageState.cleansingConfig` という解決意味を kernel 内の1箇所に保存し、facade 側の既定引数は削除する。呼び出し時刻依存の非決定性を新たに作らない
- stat mapping の default 値 (`?? 0` / `?? false` / `|| 'none'`) は表示と集計に直結するため、畳み込み時に値を変えない。parity テストで field 等価を保証する
- 既存 `extractPageContent` と `applyExtractResultToPageState` の公開署名を残すか縮小するかは互換性で決める。残す場合は薄い委譲にし、実体は `extractAndCommit` 側に寄せる。判断は design-it-twice の裁定として記録する
- `src/content/extractor.ts` は今ラウンドは変更可能である。前ラウンドの所有障壁は解消済みであり、`buildGetContentDeps` は deep call 優先配線済みである

## 実装者向け注記

- `src/content/visitReporter.ts:119-121` の `extractAndCommit?` と `extractor?` / `applyResult?` の両立がペア残余の interface 側の証拠である。互換 fallback のために両系統が optional で併存している
- `src/content/visitReporter.ts:174-181` の prefer-deep-else-pair 分岐が分岐側の証拠である。`extractAndCommit !== undefined` の条件分岐と `this.deps.extractor!()` / `this.deps.applyResult!()` という非null assertion が2件ある
- `src/content/getContentHandler.ts:33-35` の `extractAndCommit?` と `extractPageContent?` / `applyExtractResultToPageState?` の両立が2箇所目の interface 側の証拠である。fallback 用にペアが残っている
- `src/content/getContentHandler.ts:51-57` の prefer-deep-else-pair 分岐が2箇所目の分岐側の証拠である。`visitReporter` と同型の分岐が重複している
- `src/content/contentKernel.ts:200` の `config ?? this.pageState.cleansingConfig` が kernel 内の解決点である。畳み込み後はここを唯一の解決点にする
- `src/content/contentKernel.ts:164` の `extractPageContent(config: CleansingConfig = this.pageState.cleansingConfig)` が既定引数の2箇所目である。共有可変な pageState を既定引数で読む形を廃止する
- `src/content/extractor.ts:63` の `extractPageContent(config: CleansingConfig = pageState.cleansingConfig)` が既定引数の3箇所目である。facade 側の既定を廃止し kernel 内の1解決点に畳む
- 故障シナリオ: ペア経路が残る限り extract から commit への順序保証が caller 側に露出し続け、config 既定の変更が3箇所編集になる
- design-it-twice: (a) 両 deps を `extractAndCommit` のみに narrow し facade 既定引数を廃止して kernel 内の1解決点に畳む (推奨) / (b) ペアを薄い互換 shim として残し新規利用のみ禁止する。実装時に裁定して記録する。`extractPageContent` 公開署名の残しと縮小も同時に裁定する。既存 contentKernel テスト群は期待値変更なし green が前提である

## Definition of Done

- [ ] 全BDDシナリオが実装されパスしている
- [ ] コードレビューが完了している
- [ ] 統合検証が green である
