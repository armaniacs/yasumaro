# PBI: 状態表示の StatusChannel 単一 seam 化

## ユーザーストーリー

保守担当の開発者として、状態表示の表示先・TTL・mirror 方針を 1 module に集めたい、なぜなら現在は約 60 箇所の呼出慣習（要素 ID・duration・syncTop フラグの各自判断）で、mirror 忘れの bug クラスが構造的に残るから。

## 優先度

- 順位: 1 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-archloop-1001.md)）
- RICEスコア: 24.0（Reach=60 / Impact=1 / Confidence=0.8 / Effort=2.0）
- 根拠: 呼出側の知識を channel 登録 2 箇所へ畳む。依存なし。

## 背景

- `src/dashboard/statusView.ts`（`syncStatusToTop` 一発 mirror）、`src/dashboard/generalSettings/connectionTests.ts`（4 箇所の mirror 呼出）、`src/dashboard/settingsPipeline.ts:179-183`（B-layout inline warn）、`src/popup/statusPanel.ts`（render・wireOnce・toast timer が散在）、`src/popup/statusRenderers.ts`（純文字列 core は良好だが要素束縛・ timing は対象外）。
- 参照実装: `DiagnosticsCollector.collect()` → Snapshot → render の単一 seam 構造。

## BDD受け入れシナリオ

```gherkin
Scenario: dashboard の状態報告が mirror まで届く
  Given #status と #statusTop を登録した channel がある
  When kind と payload を report する
  Then 両要素に描画され TTL 後に消去される

Scenario: popup の wire-once と toast が channel に集約される
  Given popup の 7 領域を登録した channel がある
  When trust と privacy の snapshot を report する
  Then 対応領域だけが更新され重複配線が起きない
```

## 受け入れ基準

- [x] `StatusChannel` module を新設し interface は `report(target, message, type)` のみとする（`src/utils/ui/statusChannel.ts`）
- [x] dashboard は `#status + #statusTop` を 1 回だけ登録する（`statusView.ts` 末尾。mirror hook 注入で utils → dashboard 方向を維持）
- [x] popup の toast 6 件を `report` へ寄せ、2000ms 契約を `mainStatus` / `reportCleansingFeedbackStatus` の adapter 登録へ移す
- [x] `statusRenderers.ts` は純文字列 core のまま不変
- [x] exemption（記録）: 直接 DOM 描画する rich 経路（connectionTests の runner callback・trust/privacy 領域・`settingsPipeline` B-layout）は `showStatus`/`syncStatusToTop` 直接のまま。`showStatus` は render primitive として残す

## 実装記録

- `statusChannel.ts` 新設（`StatusChannel`＋共有 `statusChannel`）。`report` は adapter TTL 適用→`showStatus`→mirror hook の順。
- `statusPanel.ts` の mainStatus 6 件を `report` 化し `durationMs: 2000` を削除。pin テスト（`statusPanel-extra.test.ts`）を `statusChannel.report` 期待へ更新。TTL 2000ms テストは green のまま。
- 新規テスト `statusChannel.test.ts` 5 件（render＋mirror・adapter TTL・明示 duration 優先・未登録・mirrorIfBound）。
- `connectionTests.test.ts` ほか既存テストは無変更で green。

## テスト戦略

- 単体: channel の report → 要素反映・mirror 同期・TTL 消去を fake adapter で検証
- 既存: `statusRenderers` の純文字列テストは不変で通ること
- 統合: `npm run validate` が通ること

## 見積もり

2 SP（要チームでの見積もり）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
