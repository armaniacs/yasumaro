# PBI: archivePanel の責務分割（lifecycle factory 化）

## ユーザーストーリー

ダッシュボード UI の保守者として、`archivePanel.ts` の mount closure が約 483 行に及び 3 つの機能領域（archive lifecycle、セッション管理 + 編集モーダル、restore）が 1 つのクロージャに混在している状態を解消したい。独立した lifecycle factory に分割することで、各領域の修正を他領域と混ざらせず、挙動を維持したい。

## 優先度

順位: 13 / 20
RICEスコア: 4.8（Reach=6 / Impact=2 / Confidence=0.8 / Effort=2.0 SP）
根拠: リポジトリで最悪の肥大化ファイル。`generalSettingsPanel` より大きく、機能領域 3 つが混在。`archiveSessionStore` は分離済みのため、残る結合は mount closure 内部に局所する。
依存: rank-1003-08（in-flight guard）が本ファイルに着地済み — 分割時に保持すること。

## 背景

- `src/dashboard/panels/diagnostic/archivePanel.ts` mount closure 約 483 行（L33-516）
- 混在する 3 機能領域:
  - archive lifecycle: L91-206
  - セッション管理 + 編集モーダル: L207-417
  - restore: L420-511
- `archiveSessionStore` は既に分離済み
- rank-1003-08（in-flight guard）は本ファイルに着地済み — 分割時に保持必須

## BDD受け入れシナリオ

```gherkin
Scenario: mount closure が 3 つの lifecycle factory に分割される
  Given archivePanel.ts の mount closure が約 483 行で 3 機能領域を混在させている
  When mount を再構成する
  Then archive lifecycle と セッション管理+編集モーダル と restore は独立した factory になる
  And mount は各 factory を組み合わせるだけになる

Scenario: in-flight guard が分割後も保持される
  Given rank-1003-08 の in-flight guard が本ファイルに着地している
  When mount closure を分割する
  Then in-flight guard の挙動は変わらない
  And guard を固定するテストは引き続き成功する

Scenario: 分割前後でユーザーから見た挙動が同一
  Given archive パネルの既存挙動がある
  When lifecycle factory に分割する
  Then DOM 構造とユーザー操作の観測可能な結果は変わらない
  And parity テストが分割前後で同一の結果を返す
```

## 受け入れ基準

- [ ] mount closure を archive lifecycle / セッション管理+編集モーダル / restore の独立した lifecycle factory に分割する
- [ ] mount は factory の組み合わせだけになり、機能ロジックを直接保持しない
- [ ] rank-1003-08 の in-flight guard を保持し、回帰させない
- [ ] `archiveSessionStore` との既存分離を維持する
- [ ] 挙動保存（behavior-preserving）であり、DOM 構造とユーザー操作の観測可能な結果を変更しない
- [ ] parity テストを追加し、分割前後の挙動同一性を確認する
- [ ] 分割後に各 factory の行数が mount closure より実質的に小さくなる

## テスト戦略

- まず in-flight guard の既存テストを確認し、分割後も成功することを gate にする
- parity テスト: 分割前に主要インタラクション（lifecycle 切替、セッション編集、restore）の挙動をテストとして固定
- 単体テスト: 各 factory が独立して mount 可能であることを検証
- E2E: `npx playwright test` で関連シナリオを `--repeat-each` 実行し flake がないことを確認

## 見積もり

- 2.0 SP（3 factory への分割、parity テスト、in-flight guard 保持を含む）

## DoD

- [ ] mount closure が 3 つの独立 lifecycle factory に分割されている
- [ ] in-flight guard が保持され、既存テストが成功している
- [ ] parity テストが追加され、挙動同一性が確認されている
- [ ] `npm run validate` が成功している
- [ ] E2E リピート実行で flake がないことが確認されている
