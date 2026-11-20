# PBI: dashboard gateway の共通 seam 利用者化

- 状態: 未着手
- 見積もり: M
- テーマ: holistic review theme 4
- 関連: `src/messaging/gatewayFactory.ts:79` `defineGateway`, `src/messaging/dashboardGateway.ts:82` `sendDashboardRaw`, `src/messaging/dashboardGateway.ts:115,145,181`, `src/messaging/sendWithPolicy.ts:57`

## ユーザーストーリー

- maintainer として、全 gateway で一つの seam を使いたい。なぜなら record/AI gateway は single-shot 宣言に統一済みなのに dashboard だけが独自の retry loop と confirmToken 再発行を持ち、route ごとに wait budget と retry の意味がずれて、dashboard が余分に待ったり早く諦めたりするためである。新規 gateway 著者が独自 loop を真似せずに済む状態にしたい。

## ビジネス価値

- wait budget を一つの表で管理でき、将来の sink 追加時に新しい loop を書かずに済む。
- 測定方法: 既存の gateway 契約テストと dashboard gateway テストが変更なしで green であること。success/failure の形が変わらないこと。

## BDD受け入れシナリオ

```gherkin
Scenario: dashboard 呼び出しが従来通りの結果を返す
  Given dashboard gateway が共通 seam 経由で呼び出される
  When 正常系と異常系のリクエストを送る
  Then 従来と同じ success 形状と failure 形状が返る
```

```gherkin
Scenario: decode 失敗時は retry せず再発行は一度だけ
  Given dashboard 呼び出しが decode 失敗を返す
  When 共通 seam 経由で実行する
  Then retry は行われない
  And confirmToken の再発行はちょうど一度だけ行われる
```

## 受け入れ基準

- [x] confirmToken の付与が pre-send hook として実装される
- [x] retry が policy 引数として渡される (独自 loop を持たない)
- [x] `defineGateway` は budget 定数だけを持つ
- [x] decode 失敗時に retry しない振る舞いが保たれる
- [x] confirmToken 再発行がちょうど一度である振る舞いが保たれる
- [x] 既存の gateway 契約テストが green である
- [x] 外部契約 (success/failure 形状) が変わらない

## テスト戦略

- 変更前に parity テストで現行の success/failure 形状と retry 回数を固定する。
- hook/policy 配線の unit test を追加し、confirmToken 付与と retry 委譲を確認する。
- 既存の messaging suite を回し、回帰がないことを確認する。

## 実装アプローチ

- parity-pin -> rewire -> keep green の順で進める。
- まず現行振る舞いを parity テストで固定する。
- 次に dashboard を seam 利用者に配線し直す (pre-send hook + policy 引数)。
- 最後に全テストを green に保ったまま整理する。retry 回数の仕様変更は含めない。

## 技術的考慮事項

- 依存: なし。
- 改善内容: dashboard を seam 利用者に留める。confirmToken 付与は pre-send hook 化し、retry は policy 引数化し、`defineGateway` は budget 定数だけを持つ。将来の sink は表に一行足すだけでよい。
- 制約: 外部契約は不変 (success/failure 形状、再発行はちょうど一度、decode 失敗時は retry なし)。
- retry 回数の仕様変更は別案件であり、本 PBI の対象外とする。
- ロールバック: 単一 commit への git revert で戻せる形にする。

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "defineGateway" src/messaging/gatewayFactory.ts
grep -n "sendDashboardRaw\|callDashboard\|confirmToken" src/messaging/dashboardGateway.ts
grep -n "sendWithPolicy" src/messaging/sendWithPolicy.ts
```

- 未実装であることを 2026-11-20 に確認済み

### 実装手順

1. parity テストで現行の success/failure 形状と retry 回数と再発行回数を固定する。
2. confirmToken 付与を pre-send hook に切り出す。
3. dashboard 側の独自 retry loop をやめ、policy 引数に置き換える。
4. `defineGateway` 側に budget 定数だけを残し、二重管理をなくす。
5. messaging suite と契約テストを実行し、green を確認する。

### 落とし穴

- decode 失敗時は retry しない振る舞いと、再発行がちょうど一度である振る舞いは、parity テストで先に固定すること。静かに壊れやすい。
- wait budget 定数は移動するだけで値を変えないこと。値の変更は別案件である。
- dashboard 独自の transport + wait を残さないこと (`sendDashboardRaw` の分岐に注意)。

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして pass する
- [ ] coverage 閾値 80/80 を維持する
- [ ] PR approve が必要である
- [ ] green 後に refactor が完了している
- [ ] rollback 手順が文書化されている
- [ ] 振る舞いメモがあれば docs を更新する
