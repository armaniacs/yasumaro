# PBI: contentKernel の extract+commit を深い1呼び出しに畳む

種別: refactor

## ユーザーストーリー

記録パイプラインを保守する開発者として、contentKernel の抽出 (`extractPageContent`) と確定 (`applyExtractResultToPageState`) の二段呼び出しを `extractAndCommit` という深い1呼び出しに畳んでほしい。なぜなら stat マッピングの変更が2箇所の呼び出し側と kernel 側に波及し、config のデフォルト読みが共有可変な pageState に依存しているため、抽出の再現性が pageState の取得時刻に左右されるから。

## 優先度

- 順位: 9
- RICEスコア: 6.4 (Reach 4 / Impact 1 / Confidence 0.8 / Effort 0.5週)
- 根拠: 二段プロトコルの leak。呼び出し側が extract と commit の順序と stat マッピングの完全性を保証しなければならず、protocol の内部知識が外部に漏れている。

## ビジネス価値

extract と commit の順序保証が kernel 内部に閉じるため、呼び出し側の順序間違いや commit 漏れが構造的に起きなくなる。stat マッピングの変更点が1箇所に集まるため、field 追加時の修正漏れと回帰調査のコストが削減される。config の解決が明示化されれば、抽出結果の再現性が向上し、デバッグ時の時刻依存の非決定性が排除される。

## BDD受け入れシナリオ

```gherkin
Scenario: 深い1呼び出しで抽出と確定が原子的に行われる
  Given pageState に cleansingConfig が設定されている
  When extractAndCommit を呼び出す
  Then preparePageContent の結果が返り pageState の lastCleansedReason と lastCleanseStats と lastByteStats と lastAiSummaryCleansedStats と lastFallbackTriggered が同一結果で更新される

Scenario: 二段呼び出しと深い1呼び出しが同一結果を返す
  Given 同一の config と同一の DOM 入力がある
  When 従来の extractPageContent と applyExtractResultToPageState の二段呼び出しと extractAndCommit を別々に実行する
  Then 返却される ExtractResult と更新後の pageState の stat field が両者で等価になる

Scenario: config 未指定時の解決が明示的で再現性がある
  Given extractAndCommit に config を渡さない
  When 呼び出し直前と直後で pageState.cleansingConfig が変化しない
  Then 解決された config による抽出結果が呼び出し時刻に依存せず再現する
```

## 受け入れ基準

- [x] kernel interface に `extractAndCommit` が追加され extract と commit を内部で順序保証している
- [x] `visitReporter` の extract+apply 二段呼び出しが `extractAndCommit` への委譲に置き換わっている
- [x] `getContentHandler` の extract+apply 二段呼び出しが `extractAndCommit` への委譲に置き換わっている
- [x] config 未指定時の解決が明示化され共有可変 pageState への暗黙依存が排除されている
- [x] stat マッピングの所有が kernel 内部の1箇所に集約され呼び出し側に mapping 知識が残っていない
- [x] 既存 contentKernel テスト群の期待値が変更なしで全件 green である

## テスト戦略（t_wadaスタイル）

Outside-In で進める。まず現行二段呼び出しの結果と pageState 更新内容を固定する parity テストを先に書く (Red)。次に `extractAndCommit` を実装し (Green)、二段呼び出しと深い1呼び出しが同一入力で同一結果を返す parity が Green のままであることを確認する (Refactor)。単体では stat 5ブロックの mapping 完全性 (各 field の undefined 時の default 値 `0` / `false` / `'none'` を含む) と config 未指定時の解決を検証し、統合では `visitReporter` 経路と `getContentHandler` 経路の両方で pageState 更新が一致することを検証する。既存 contentKernel テスト群 (kernel polling / idleScheduler / dynamic 等) は期待値変更なし green を前提とし、回帰検出に使う。

## 実装アプローチ

1. 現行二段呼び出しの結果と pageState 更新を parity テストとして固定する
2. kernel interface に `extractAndCommit(config?)` を追加し内部で extract と commit を順序保証する
3. `visitReporter` と `getContentHandler` の二段呼び出しを `extractAndCommit` への委譲に置き換える
4. config 未指定時の解決を明示化し pageState デフォルト読みの暗黙依存を排除する
5. design-it-twice の裁定 ((a) 深い1呼び出しを推奨 / (b) config 必須化) と既存公開署名の互換維持か縮小かの判断を記録に残す

## 見積もり

1pt (0.5週)

## 技術的考慮事項

- `extractAndCommit` は kernel の公開 interface に追加し、commit の順序保証を kernel 内部に閉じ込める。呼び出し側に extract と apply の順序知識を残さない
- config 未指定時の解決は呼び出し時点の pageState 読み取りか必須引数化かの二択であり、design-it-twice で裁定する。再現性を優先し時刻依存の非決定性を残さない方を選ぶ
- stat mapping の default 値 (`?? 0` / `?? false` / `|| 'none'`) は表示と集計に直結するため、畳み込み時に値を変えない。parity テストで byte 等価ではなく field 等価を保証する
- 既存 `extractPageContent` / `applyExtractResultToPageState` の公開署名を残すか縮小するかは互換性で決める。残す場合は薄い委譲にし、実体は `extractAndCommit` 側に寄せる

## 実装者向け注記

- `src/content/contentKernel.ts:165` の `extractPageContent(config: CleansingConfig = this.pageState.cleansingConfig)` はデフォルト引数が共有可変な pageState を読む。config 未指定呼び出しの再現性が pageState の取得時刻に依存する
- `src/content/contentKernel.ts:190-211` の `applyExtractResultToPageState` が5ブロックの stat マッピング (`lastCleansedReason` / `lastCleanseStats` / `lastByteStats` / `lastAiSummaryCleansedStats` / `lastFallbackTriggered`) を所有する。field 追加時の変更点がここに集まる
- `src/content/visitReporter.ts:166-167` の `const extractResult = extractor(); applyResult(extractResult);` が二段プロトコルの1箇所目の漏れである。順序と commit 漏れの保証が呼び出し側にある
- `src/content/getContentHandler.ts:44-45` の `const extractResult = deps.extractPageContent(); deps.applyExtractResultToPageState(extractResult);` が二段プロトコルの2箇所目の漏れである。同型の順序保証が重複している
- 故障シナリオ: stat マッピングの変更が2呼び出し側と kernel の3箇所に波及する。config デフォルト読みのせいで抽出の再現性が pageState の時刻に依存する
- design-it-twice: (a) `extractAndCommit` 深い1呼び出しを kernel interface に追加して commit を内部に畳む (推奨) / (b) config 必須化で pageState デフォルト読みを止める。実装時に裁定して PBI に記録する。既存 `extractPageContent` / `applyExtractResultToPageState` の公開署名は互換維持か縮小かも記録する。既存 contentKernel テスト群 (kernel polling / idleScheduler / dynamic 等・2026-09-21-16 で整備済み) は期待値変更なし green が前提である

## Definition of Done

- [x] 全BDDシナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
