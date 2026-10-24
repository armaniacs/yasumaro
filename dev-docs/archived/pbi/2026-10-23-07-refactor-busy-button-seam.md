# PBI: 処理中ボタン定型の共有 seam 化

## ユーザーストーリー

保守担当者として、処理中ボタンの定型（ラベル退避 → disabled → finally 復元）を共有化したい。なぜなら4複製のうち saved 系は finally 復元を持たない亜種であり、将来の5箇所目が復元漏れを再発するから。

## 優先度

- 順位: 07 / 全12件
- RICE スコア: 10.7（Reach = 10 / Impact = 1 / Confidence = 0.8 / Effort = 0.75人日）
- 根拠: 実測4複製。前回 PBI 2026-10-20-17（dashboard 同型スカフォールド共通化）と同一主題。Confidence 0.8 は `sqliteHistoryPanelView.ts:494` を主スレッドが未読のため。

## BDD 受け入れシナリオ

```gherkin
Scenario: ボタン挙動が変更前と同一
  Given 各リージョンの処理ボタンがある
  When 処理を実行する
  Then 処理中表示・disabled・復元が変更前と同一になる

Scenario: 失敗時の復元
  Given 処理が失敗する
  When 共有 seam 経由で実行する
  Then ボタンは必ず復元され、失敗表示は変更前と同一になる
```

## 受け入れ基準

- [x] 4箇所が共有 seam に置換される（saved 系の亜種差分は seam の引数として明示する）
- [x] view 単体テストが新規追加される（現状 view test 0 件）
- [x] 既存テスト全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: sqliteHistoryPanel 経由の描画テストでボタンの処理中遷移を確認
- 単体: 共有 seam のテスト新規（成功・失敗・例外の3経路で復元を pin）

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先: `src/dashboard/` の共有モジュール（view 4件と同層。`setElementHtml` 等と同列）
- 非機能要件: ラベル文言・disabled タイミング不変。saved 系の早期 return 経路（fail 時の復元あり）は意味を保つ

## 変更点の概要

`label 退避 → disabled → '処理中...' → finally 復元` を共有 helper に切り出し、4リージョンから呼ぶ。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/askHistoryPanelView.ts:90-92,112-115` ― 定型（finally 復元あり。主スレッドが実読で確認）
- `src/dashboard/panels/asyncData/researchReportPanelView.ts:69-71,87-90` ― 同形（主スレッドが実読で確認）
- `src/dashboard/panels/asyncData/savedCollectionsPanelView.ts:104-111` ― 亜種（`fail()` 内で復元。成功時は復元なしで意図不明。要確認）
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:494` ― 同形（サブエージェント報告。主スレッド未読）
- 呼び出し元実数: render 系各1件。`t('processing')` の grep は上記4ファイルのみ
- テスト: view 単体テストなし（`savedCollectionQuery.test.ts` は純粋関数のみ）

## 変更の理由（DRY）

同じ理由（処理中表示の仕様変更）で同時に変わる関係。saved 系亜種は引数（成功時復元の要否）として吸収できるか先に確認し、吸収できなければ対象から外して PBI に記録する（YAGNI）。

## 提案コード（骨子のみ）

```typescript
// src/dashboard/panels/asyncData/busyButton.ts (新設。名前は仮)
export async function withBusyButton<T>(
  button: HTMLButtonElement,
  run: () => Promise<T>,
  opts?: { restoreOnSuccess?: boolean },
): Promise<T>;
// 各 view: try/finally 定型 → withBusyButton に置換
```

## 実装者向け注記

```bash
grep -rn "t('processing')" src/dashboard/ --include='*.ts' | grep -v __tests__
```

- 着手前に `sqliteHistoryPanelView.ts:494` 前後を実読し、同形か PBI に記録する
- saved 系の成功時非復元が意図的か判断し、意図的なら `restoreOnSuccess: false` として pin する

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 共有 seam 単体テスト新規通過
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
