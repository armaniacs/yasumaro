# PBI: 空 catch の監査と best-effort 経路の可観測化

## ユーザーストーリー
保守担当の開発者として、握りつぶされた失敗の有無を診断ログから確認できるようにしたい、なぜなら空 `catch {}` が原因の不具合が出たとき、原因の手がかりが残らず調査が長引くから。

## 優先度
- 順位: 01 / 3
- RICEスコア: 2.0（Reach=2 / Impact=0.5 / Confidence=0.5 / Effort=0.25）
- 根拠: 実害は未確認だが、着手コストが最小で他の2件より確度の低下が小さい。依存なし。
- 再検討トリガー: 同経路で握りつぶした失敗が原因の不具合報告が出た時。それまでは着手しない。

## 背景（2026-09-22 時点の現状）
非テストの `catch {}` が6箇所ある。
- `src/background/cache/PrivacyCache.ts:110`（clearSession）
- `src/utils/storage/settingsMigration.ts:179`
- `src/utils/aiSummaryCleaner/helpers.ts:252`
- `src/dashboard/settingsPipeline.ts:176`
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:437`（listener notify）
- `src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts:21`

いずれも best-effort 経路で、失敗しても機能は継続する。

## BDDシナリオ
Scenario: 握りつぶしていた失敗が記録される
  Given 6箇所のいずれかの処理が例外を投げる
  When  処理が best-effort として継続する
  Then  機能の挙動は変わらず、失敗が warn レベルで1回記録される

Scenario: 意図的な握りつぶしは理由付きで残る
  Given 記録すると通知過多になる経路（listener notify）
  When  監査で「握りつぶしが妥当」と裁定される
  Then  コードに握りつぶす理由が英語コメントで残り、裁定が PBI に記録される

## 受け入れ基準
- [ ] 6箇所それぞれについて、失敗時の影響を調査し「記録する / 理由を残して握りつぶす」を裁定した
- [ ] 記録する経路は既存の logger（`logWarn` 等）を使い、例外の再送出はしない
- [ ] 各経路に例外注入テストを追加し、機能継続と記録の両方を pin した
- [ ] 6箇所以外に新規の空 catch がないことを grep で確認した

## テスト戦略
- 単体: 各経路に例外を注入し、戻り値・後続処理・ログ呼び出しを検証
- 統合: `npm run validate` が通ること

## 見積もり
1 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / test / build が通る
- [ ] コードレビュー完了
