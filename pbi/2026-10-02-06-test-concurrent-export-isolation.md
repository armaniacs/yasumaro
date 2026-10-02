# PBI: 並行 export の分離テスト（isolation の証明・ソース変更なし）

優先度: C3 / RICE #5 / SP S（0.5、small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「並行処理」）
親 PBI: なし（新規・C3 系統の先頭。テスト専用 PBI）
依存: なし（テスト追加のみ。ソース変更はバグ発見時のみ）

## ユーザーストーリー

dashboard を保守する開発者として、並行 export が相互に分離され archive 操作が相互排除されることをテストで証明してほしい、なぜなら意図（isolation なのか serialize なのか）がコード化されていないと、後日の並行化変更でデータ取り違えが静かに起きるから。

## 背景（現状）

- 対象 A: `src/dashboard/panels/panelAction.ts:76`、`src/dashboard/panels/panelAction.ts:88` — 集約口（`unwrapServiceResult` 周辺の並行呼び出し点）。
- 対象 B: exportLogsPanel の single-button 制御 — 単一ボタンによる export 実行の多重起動可否が意図として未コード化。
- 対象 C: archivePanel の group controls — 複数コントロール間の相互排除の有無が意図として未コード化。
- 現状の意図は不明（isolation なのか serialize なのか未確定）。本 PBI は意図の発見とコード化が目的で、ソースの振る舞い変更はしない。
- 既存テスト（変更なしで green を保つ対象）:
  - `src/dashboard/panels/__tests__/panelAction` 系 suites
  - exportLogsPanel / archivePanel 系 suites

## BDD シナリオ

```gherkin
Scenario: 並行 exports は分離される
  Given 2 件の export が並行に実行される
  When 両方が完了する
  Then 各 export の結果が取り違えなく対応する入力に帰属する（isolation）

Scenario: archive ops は相互排除される（または意図がコード化される）
  Given archive 操作が並行に要求される
  When 実行順序が確定する
  Then 操作が相互排除される、または並行許容の意図がテストとしてコード化される
```

## 実装宣言

- 挙動維持: ソースの振る舞いは変えない。バグ発見時のみ最小限のソース修正を許容し、その場合は発見内容・修正理由を実装記録に残す
- 新規テストのみが成果物（isolation 証明 + 相互排除証明または意図のコード化）
- 実時間待ちの禁止（AGENTS.md）: 固定 `setTimeout` 待ちでテストを通さない。Promise / イベントの await、`waitForMock`、inject 可能な sleep で駆動する

## 受け入れ基準

- [ ] T1: 並行 exports の分離を証明する新規テストが存在する（`panelAction.ts:76,88` 経由の 2 件並行で結果の帰属が正しい）
- [ ] T2: archive ops の相互排除を証明する新規テストが存在する、または並行許容の意図がテストとしてコード化される（どちらかを明示）
- [ ] T3: exportLogsPanel single-button の多重起動可否の意図がテストとしてコード化される
- [ ] ソースの振る舞い変更なし（バグ発見時のみ最小修正を許容し、発見内容と理由を実装記録に残す）
- [ ] `npm run type-check` と変更ディレクトリ配下の vitest が green（既存テスト群を変更なしで通過）

## テスト戦略

- 新規テスト必須（parity ではなく isolation テスト）: 最低 2 系統:
  1. concurrent exports: 2 件並行投入で各結果の帰属が正しい（取り違えなし）
  2. archive ops: 相互排除されるか、並行許容意図がコード化されるかのいずれかを固定
- 繰り返し実行での flake なし（`--repeats` で green。実時間待ちを使わない）
- 既存 conformance は変更なしで green（`panelAction` suites、exportLogsPanel / archivePanel suites）

## 実装内容

1. T1: `panelAction.ts:76,88` 経由の並行 export 分離テストを追加する
2. T2/T3: archivePanel group controls と exportLogsPanel single-button の意図コード化テストを追加する
3. バグ発見時のみ最小限のソース修正を行い、理由を実装記録に残す
4. 既存テスト群で green を確認する

## 設計メモ（open design point・実装者が選択）

- **意図のコード化形**: 相互排除をテストで固定するか、並行許容として固定するかは観察結果に基づく実装者の選択とする。選択と観察証拠を実装記録に残す

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録

- （未着手）
