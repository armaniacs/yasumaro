# PBI: PrivacyPipeline の純粋部切り出し

- 状態: 未着手
- 見積もり: M

## ユーザーストーリー

- メンテナとして、plan/mask/format の純粋でテスト可能な関数が欲しい
- なぜなら、現状はドメインポリシーや guard の追加が毎回一つの関数を膨らませ、回帰範囲を広げるから

現状は `src/background/privacyPipeline.ts:95` の class `process` に、モード判定と PII マスクとドメインポリシーとローカル要約とクラウド要約とタグ分割と劣化判定と pending 保存が集中している。純粋な整形と副作用 (`addPendingPage` at :250、例外送出) が同居し、単体試験に AI と sanitizer のモックが必要になっている。

## ビジネス価値

- 純粋部はモックなしで単体試験できる。executor は薄く残る
- 測定方法: 新規の mock-free 単体試験の追加と、既存 pipeline 試験の無変更通過

## BDD受け入れシナリオ

### シナリオ1: 正常系は分岐判断が現状と一致する

```gherkin
Given 設定と URL が与えられたとき
When 純粋部の plan 関数で分岐を決めるとき
Then 現状の process と同じ分岐判断になること
```

### シナリオ2: ローカル AI 利用不可は pending 保存と明示的失敗になる

```gherkin
Given ローカル AI が利用できないとき
When 処理を実行するとき
Then pending が保存され、呼び出し側契約として明示的な失敗になること
```

## 受け入れ基準

- [x] `buildPlan(settings, url)` が純粋関数として切り出されていること
- [x] `applyMaskResult` が純粋関数として切り出されていること
- [x] `formatCloudResult` が純粋関数として切り出されていること
- [x] 純粋部に chrome/storage アクセスがなく、引数と戻り値で試験できること
- [x] mock-free の単体試験が追加されていること
- [x] executor が副作用 (pending 保存、ログ、AI 呼び出し) を保持し、薄く残ること
- [x] local-ai-unavailable の throw+save が呼び出し側契約として明示され、既存 pipeline 試験が同じ結果で green であること
- [x] AI 失敗文を note に書かない方針が変更されていないこと

## テスト戦略

- 変更前に parity 試験で現状の分岐とマスク出力を固定する (:213 の設定組み立てと分岐、:223 の local 分岐、:288 の cloud 後処理を対象)
- 3 つの純粋関数 (`buildPlan`、`applyMaskResult`、`formatCloudResult`) の単体試験を追加する。chrome/storage に触れず、引数と戻り値だけで検証する
- 既存の pipeline スイートを実行し、同じ結果で green であることを確認する (`src/utils/llmOutputGuard.ts:75` の判定と `:27 estimateTokens` の振る舞いを含む)

## 実装アプローチ

- parity-pin -> extract -> keep green の順で進める
- 先に現状の分岐とマスク出力を parity 試験で固定する
- 純粋部を切り出し、executor に副作用だけを残す。try/catch は executor 側に移す
- 全段で既存試験を green に保つ

## 技術的考慮事項

- 依存: none
- ロールバック: single-commit git revert で戻せること
- 仕様変更なし。AI 失敗文を note に書かない方針は維持する

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "process\|buildPlan\|applyMaskResult\|formatCloudResult" src/background/privacyPipeline.ts
grep -n "addPendingPage" src/background/privacyPipeline.ts
grep -n "estimateTokens" src/background/privacyPipeline.ts
grep -n "judg" src/utils/llmOutputGuard.ts
```

- 対象: `src/background/privacyPipeline.ts:95` (class `process`)、:213 (設定組み立てと分岐)、:223 (local 分岐)、:250 (`addPendingPage` と例外)、:288 (cloud 後処理)、:27 (`estimateTokens`)、`src/utils/llmOutputGuard.ts:75` (判定)
- 未実装であることを 2026-11-20 に確認済み

### 実装手順

1. parity 試験を追加し、現状の分岐とマスク出力を固定する
2. `buildPlan(settings, url)`、`applyMaskResult`、`formatCloudResult` を純粋関数として切り出す。chrome/storage アクセスを持たせない
3. 副作用 (pending 保存、ログ、AI 呼び出し) を thin executor に残す。local-ai-unavailable の throw+save は呼び出し側契約として明示し、try/catch は executor 側に移す旨を注記する
4. mock-free 単体試験を追加し、既存 pipeline スイートが green であることを確認する

### 落とし穴

- 既存試験は AI/sanitizer のモックに依存している。切り出し中はその試験を壊さず green に保ち、終わってから mock-free 試験を追加すること
- local-ai-unavailable の throw 経路は観測可能な振る舞いを厳密に保つこと
- note 書き込み方針に触れないこと。AI 失敗文を note に書かない制約は維持する

## Definition of Done

- 全ての BDD シナリオが自動試験として通過すること
- カバレッジ閾値 80/80 を維持すること (変更なし)
- PR の approve が必須であること
- green 後に refactor を完了すること
- ロールバック手順を文書化すること
- 振る舞い注記が存在する場合は docs を更新すること
