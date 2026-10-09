# PBI: contentKernel の E2E テスト状態発行 3 重化の統合（refactor）

| 項目 | 内容 |
|------|------|
| 種別 | refactor |
| 優先度 | 順位8 |
| RICE | 3.0（R3 / I1 / C1.0 / E1） |
| 見積もり | 1 SP |
| 依存 | [NN02 settingsSnapshot 嘘型解消](2026-10-09-02-refactor-settings-snapshot-honest-type.md) の着地後（contentKernel.ts 共有） |
| 出所 | holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)） |

## 根拠

- 同一の OWTestState 形状（6 フィールド）を `window.__OW_TEST_STATE` と `data-ow-test-state` 属性の 2 経路に書くロジックが kernel 内に 3 ブロックあり、形状が毎回手書きされている
- OWTestState のフィールド追加時には、3 箇所＋型宣言の合計 4 箇所編集が必要
- RICE: R3 / I1 / C1.0 / E1 → スコア 3.0

## ユーザーストーリー

メンテナ担当者として、E2E テスト状態の発行ロジックが 1 箇所のヘルパーに集約されてほしい。なぜなら、OWTestState のフィールド追加時に 4 箇所を手動で同期する漏れを防ぎたいから。

## 背景

- 同一の OWTestState 形状（6 フィールド: maxScrollPercentage / isValidVisitReported / startTime / minVisitDuration / minScrollDepth / duration）を `window.__OW_TEST_STATE` と `data-ow-test-state` 属性の 2 経路に書くロジックが kernel 内に 3 ブロックあり、形状が毎回手書きされている
- 該当箇所:
  - `src/content/contentKernel.ts:215-229` — checkVisitConditions 内の state 構築＋両経路への書き込み
  - `src/content/contentKernel.ts:234-242` — reportable 時の isValidVisitReported 更新＋再書き込み
  - `src/content/contentKernel.ts:327-339` — init() 内の初期 state 書き込み
- 型宣言の所在: `src/content/extractor.ts:30-43` — interface OWTestState + declare global { interface Window { __OW_TEST_STATE?: OWTestState } }
- キャスト例: `src/content/contentKernel.ts:224` と `:236` — extractor.ts の global 型宣言を参照せず `as unknown as { __OW_TEST_STATE?: unknown }` で上書きしている

## 改善案

- kernel に `publishE2eTestState(state: OWTestState): void` を抽出し、3 箇所から呼ぶ（window/document 両書き込みはヘルパー内に統一）
- OWTestState 型は content 内で共有可能な位置に置く（extractor.ts から export するか content 内共有モジュールへ）
- `as unknown as` を消す
- isE2E ガード（`this.gating.isE2E`）は各呼び出し元の現行位置にそのまま
- 挙動不変（発行される DOM/window の値は byte 同一）

## BDD受け入れシナリオ

```gherkin
Feature: E2E テスト状態の発行（リファクタ後も挙動不変）

  Scenario: E2E モードで訪問条件チェックが走ったとき、両経路に同一の状態が発行される
    Given E2E モードが有効で、閲覧中のページに滞在とスクロールの実績がある
    When 訪問条件のチェックが走る
    Then window.__OW_TEST_STATE に 6 フィールドの状態が設定される
    And document のルート要素の data-ow-test-state 属性に同一内容の JSON が設定される
    And 発行された JSON は golden pin と byte 同一である

  Scenario: 記録条件を満たしたとき、isValidVisitReported が更新されて再発行される
    Given E2E モードが有効で、滞在時間とスクロール率が記録条件を満たしている
    When 訪問が記録対象と判定される
    Then window.__OW_TEST_STATE.isValidVisitReported が true に更新される
    And data-ow-test-state 属性が更新後の状態で再発行される

  Scenario: 初期化時に初期状態が発行される
    Given E2E モードが有効である
    When コンテンツスクリプトの初期化が完了する
    Then data-ow-test-state 属性に初期状態（duration 0）の JSON が設定される
    And 発行された JSON は golden pin と byte 同一である
```

## 受け入れ基準

- [x] kernel に `publishE2eTestState(state: OWTestState): void` が抽出され、3 箇所（checkVisitConditions の状態構築 / reportable 時の再書き込み / init() の初期発行）から呼ばれている
- [x] `window.__OW_TEST_STATE` と `data-ow-test-state` 属性への書き込みはヘルパー内に統一されている
- [x] OWTestState 型が content 内で共有されており（extractor.ts からの export または content 内共有モジュール）、kernel 側の `as unknown as` キャスト（contentKernel.ts:224, :236）が排除されている
- [x] isE2E ガード（`this.gating.isE2E`）は各呼び出し元の現行位置に維持されている
- [x] 発行される window/document の値がリファクタ前と byte 同一である（golden pin で検証）
- [x] 既存の E2E 状態テストがすべて green

## テスト戦略（t_wadaスタイル）

### golden pin（最重要）
- リファクタ前に `data-ow-test-state` 属性へ発行される JSON 文字列を golden として固定し、リファクタ後も byte 同一であることを検証する

### 単体テスト
- `publishE2eTestState` の単体テスト: window / document モックで両経路に期待値が書かれることを検証する

### 既存テスト
- 既存の E2E 状態テストが green であること（リグレッション確認）

### アプローチ
- 挙動不変のリファクタリングのため、まず golden pin で現行挙動を固定（Green で開始）してから抽出を行い、全テスト green を維持する

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること。2026-10-09 時点で 3 ブロックの重複を確認済み）

```bash
grep -rn "OW_TEST_STATE" src/content/
grep -rn "data-ow-test-state" src/
```

### 実装手順

1. OWTestState 型を content 内で共有可能にする（extractor.ts から export、または content 内共有モジュールへ移動）
2. contentKernel.ts に `publishE2eTestState(state: OWTestState): void` を追加する（window と document の両書き込みを含む）
3. contentKernel.ts:215-229 の state 構築＋書き込みをヘルパー呼び出しに置き換える
4. contentKernel.ts:234-242 を現行 state の取得＋isValidVisitReported 更新＋ヘルパー呼び出しに置き換える
5. contentKernel.ts:327-339 を初期 state 構築＋ヘルパー呼び出しに置き換える
6. golden pin テストを追加し、byte 同一性を確認する
7. `npm run validate` を実行する

### 落とし穴

- `JSON.stringify` の出力はオブジェクトリテラルのフィールド順に依存する。抽出時にフィールド順を変更すると data-ow-test-state 属性の文字列が変わり、golden pin が失敗する
- init() の現行実装は document 属性のみの書き込み（contentKernel.ts:327-339）。ヘルパー統一後は改善案の指定通り window/document 両書き込みになるため、golden pin で発行値の byte 同一性を確認すること
- extractor.ts の `declare global` は Window 型の拡張として機能しているため、OWTestState を export しても global 宣言自体は維持する
- NN02 が同じ contentKernel.ts を修正する（contentKernel.ts:159-161 のコメント修正を含む）。同一ファイルの競合を避けるため、NN02 の着地後に着手すること

## 技術的考慮事項

- 依存: NN02 の着地後（contentKernel.ts 共有）。それ以外の依存なし
- ロールバック: 挙動不変の変更のため、問題発生時は通常の revert で復元可能

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 発行値の golden pin テストが追加され、リファクタ後も byte 同一であることが検証されている
- [x] contentKernel.ts の E2E state 経路から `as unknown as` キャストが排除されている
- [x] 既存の E2E 状態テストを含む全テストが green
- [x] `npm run validate`（type-check + test）が green
- [x] コードレビュー完了
