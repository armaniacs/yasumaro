# バックログ台帳: 大局的コード改善 0918c（holistic-0918c）

2026-09-18 第3ラウンド。第1〜2ラウンド（05-10・11-13）で未踏の popup・dashboard panel・i18n・層境界を中心に4観点でレビューし、実コード裏取りで抽出した3候補 + 台帳送り1件を集約する。

## 採点基準（既存ラウンドと同一）

```
Reach: 今後1年の保守作業での関与頻度（相対1-10）
Impact: 3=実害解消 / 2=大きい / 1=中（重複削減・規範化）/ 0.5=小（混乱削減）
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る
Effort: ストーリーポイント
```

## RICE スコア表

| スコア順 | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | i18n seam 迂回残存の置換 | 7 | 2 | 1.0 | 1.5 | 9.3 | → PBI 14 |
| 2 | dashboard t() ラッパ統合（tOrKey） | 6 | 1 | 1.0 | 1 | 6.0 | → PBI 15 |
| 3 | dashboard → popup 層越境の解消 | 3 | 1 | 1.0 | 1 | 3.0 | → PBI 16 |
| 台帳 | console → logger seam 統一 | 4 | 1 | 0.8 | 1.5 | 2.1 | 台帳送り |

## 実行順

```
14（i18n迂回置換）→ 15（tOrKey統合）→ 16（層越境解消）
```

純 RICE 降順からの逸脱なし。3件ともファイル非重複・解の前提関係なし → 1バッチで並列可。

## 依存マップ・バッチ計画

- 14: 対象 約10ファイル（`|| fallback` 形のみ。privacySettingsPanel・privacyDialog・notificationHelper・resultBuilder・reviewSummaryHandler・exportImport・aiSummaryCleansingSettingsV2・visitReporter・contextMenuHandlers ほか）。`utils/i18n.ts` 自体は変更しない
- 15: 対象 `utils/i18n.ts`（tOrKey 新設）+ sqliteHistoryPanelView・sqliteHistoryPanel・cleansingStatsView・archivePanel の4ラッパ置換。14 とファイル非重複
- 16: 対象 markdownTemplateManager・customPromptManager（escapeHtml 直参照化）+ onboardingWizard.ts の `utils/ui/` 移動 + popup.ts・generalSettingsPanel.ts・両テストの import 更新。14・15 とファイル非重複

## 台帳送り

- **console → logger seam 統一**（dashboard/popup 約30サイト: trancoConsent 5・trancoNotification 4・dashboard.ts 4 ほか）。init tracing の console.log は意図的の可能性があり「どれを logger に寄せるか」の設計判断が残る（Confidence 0.8）。**再検討トリガー**: 可観測性方針の明確化（console 残置の許容範囲を LAYERS.md 等に規定するとき）、またはダッシュボードのエラーログ収集を強化するとき

## 5 Whys サマリー

- 14: なぜ迂回が残るか → getMessageOr が idiom 吸収用に用意された後も、既存の素書きの置換が行われなかった。→ 解: `|| fallback` 形のみ機械置換し byte-identical を保つ
- 15: なぜ4重複か → dashboard 各パネルが便宜ラッパをその場で定義し、名前付き置換対応の差だけ archivePanel が別実装になった。→ 解: tOrKey を seam に新設し4ラッパを別名 import に寄せる
- 16: なぜ popup 越境か → escapeHtml が popup/errorUtils の re-export 経由で参照され、共有ウィザードが popup に置かれたままになった。→ 解: utils 直参照化 + onboardingWizard の utils/ui 移動
