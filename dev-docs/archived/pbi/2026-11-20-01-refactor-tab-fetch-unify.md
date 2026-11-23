# PBI: tab問い合わせ複製の解消とタイマ一元化

- 状態: 未着手
- 見積もり: S

## ユーザーストーリー

- 役割: 保守担当者として
- 要望: tab問い合わせの単一窓口 `askTab` が欲しい
- 理由: `requestContentFromTab` と `requestSelectionFromTab` が同じ待ち形状を複製しているため、待ち時間や送信形式の変更が複数箇所の編集になる。MV3 の起動停止が多い環境ではタイマ残留の恐れも増える。

対象の複製:

- `src/popup/contentFetchGateway.ts:38` の `requestContentFromTab`
- `src/popup/contentFetchGateway.ts:65` の `requestSelectionFromTab`
- 両者は Promise.race と setTimeout と null 回復の同じ形を持つ。違うのは message type のみである。

正準の待ち合わせ窓口:

- `src/messaging/withRuntimeTimeout.ts:14` (clearTimeout と settled 後の late rejection 抑止)
- 利用例: `src/messaging/sendWithPolicy.ts:57` と `src/messaging/gatewayFactory.ts:79`

改善: 両 popup 関数を薄くし、共通 helper (例: `askTab<T>(tabId, type, opts?)`) に寄せる。helper は `withRuntimeTimeout` に委譲し、catch で null を返す。

制約:

- passive な null 契約は変更しない
- `contentFetchGateway.ts:100` の permission ladder は変更しない
- 仕様変更なし

## ビジネス価値

- 価値: タイムアウトと送信方針の変更点が一箇所になる。タイマ生成も一箇所に集まり、成功後の残留タイマをなくせる。
- 測り方: 既存の transport injection テストが緑のままであること。追加の実時間待ちは入れない (repo TEST_RULE に従う)。

## BDD受け入れシナリオ

```gherkin
Feature: popup からの tab 内容取得

  Scenario: popup が tab 内容を必要とするとき同じ値を得る
    Given popup が開いている
    And 対象 tab に読み取り可能な本文がある
    When popup が本文取得を頼む
    Then 変更前と同じ本文が返る

  Scenario: 応答が遅いときは null で静かに終わる
    Given popup が開いている
    And 対象 tab からの応答が時間内に返らない
    When popup が本文取得を頼む
    Then 結果は null になる
    And popup は通常操作を続けられる

  Scenario: 取得処理が失敗しても null で静かに終わる
    Given popup が開いている
    And tab 側の取得処理が例外で終わる
    When popup が選択範囲取得を頼む
    Then 結果は null になる
    And popup は通常操作を続けられる
```

## 受け入れ基準

- [x] 共通 helper `askTab` が存在する
- [x] `requestContentFromTab` と `requestSelectionFromTab` が共に `askTab` に委譲する
- [x] null 契約が固定される (timeout 時も transport 例外時も null)
- [x] `contentFetchGateway.ts:100` の permission ladder に差分がない
- [x] 既存の contentFetchGateway テストが緑である
- [x] 成功後に新規タイマが残らない (clearTimeout 経路が有効である)

## テスト戦略

t_wada 流の refactor 手順に寄せる。振る舞い固定を先に行い、実装を後から寄せる。

- parity test: 変更前に現行の null/timeout 振る舞いを固定するテストを書く。timeout 時 null、transport 例外時 null、正常時透過を記録する。
- unit test: 新設の `askTab` を transport injection で検証する。実時間待ちは使わない。fake timer と注入 transport で timeout、late rejection、例外の各経路を確認する。
- integration test: 既存の popup テストを使う。`requestContentFromTab` と `requestSelectionFromTab` の呼び出し側が変更前と同じ値を得ることを確認する。

## 実装アプローチ

parity-pin から refactor へ進み、常に緑を保つ。Red-Green-Refactor で行う。

1. parity-pin: 現行の null/timeout 経路をテストで固定する (Red で期待値を定める)
2. refactor: `askTab` を抽出し、`withRuntimeTimeout` に委譲する
3. keep green: 両関数を委譲に置き換え、targeted テストを緑に戻す

仕様変更は行わない。permission ladder と null 契約は不変とする。

## 技術的考慮事項

- 依存: none (新規依存の追加なし)
- 配置: 新 helper は `contentFetchGateway.ts` 内か popup-local な module に置く
- 巻き戻し: 単一 commit の git revert で戻せる形にする
- 参照: `withRuntimeTimeout` の clearTimeout と settled 後抑止をそのまま使う。`sendWithPolicy` と `gatewayFactory` の使い方とそろえる。

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "requestContentFromTab\|requestSelectionFromTab" src/popup/contentFetchGateway.ts
grep -n "withRuntimeTimeout" src/messaging/withRuntimeTimeout.ts src/messaging/sendWithPolicy.ts src/messaging/gatewayFactory.ts
grep -n "permission" src/popup/contentFetchGateway.ts
```

未実装であることを 2026-11-20 に確認済み

### 実装手順

1. 二つの関数 (`requestContentFromTab`、`requestSelectionFromTab`) と `withRuntimeTimeout` の seam を読む
2. null/timeout 経路の parity test を書く (変更前の振る舞い固定)
3. `askTab` を抽出する (`withRuntimeTimeout` へ委譲、catch で null)
4. 二つの関数を `askTab` への委譲に置き換える
5. targeted test を実行する (contentFetchGateway 関連と popup 関連)

### 落とし穴

- catch から null への対応を同一に保つ。late rejection の抑止も含めて変えない。
- `:100` の permission ladder には触らない。
- fake timer 下での timer handle 型に注意する。実時間待ちは入れない。

## Definition of Done

- 全 BDD シナリオが自動テストとして通る
- coverage 閾値 80/80 は変更しない (現行基準を維持する)
- PR approve が必要である
- refactor は緑の後に完了扱いとする (赤のまま終わらせない)
- rollback 手順は単一 revert として記録する
- 振る舞い注記がある場合 docs を更新する
