# PBI: i18n / パネルカタログゲートの強化

## ユーザーストーリー
リリース担当者として、locale キーの欠落・孤立を validate ゲートで検出してほしい、なぜなら parity 機構が release:check 専用で日常ゲートが実 locale ファイルを読まず、孤立キーが実際に漂着したから。

## 優先度
- 順位: 4 / 8（着手順 12）
- RICEスコア: 8.0（Reach=2 / Impact=1.0 / Confidence=100% / Effort=0.25pt）
- 根拠: domainAnalysis_periodLabel が両 locale に漂着した実 drift でバグクラスが証明済み。tagClusterTab は今日も両 locale で未定義（panelCatalog.test が意図的に skip）。PBI 09 と依存なし → バッチ1で並列実装。

## BDD受け入れシナリオ
Scenario: locale 間の不整合検出
  Given en にのみ存在するキーがある
  When テストを実行する
  Then parity テストが失敗し extra キーが報告される

Scenario: サイドバーキーの欠落検出
  Given PANEL_CATALOG のあるパネルの sidebarI18nKey が ja に未定義
  When テストを実行する
  Then キー存在 assert が失敗する

Scenario: 正常状態
  Given 両 locale が整合し全サイドバーキーが定義されている
  When テストを実行する
  Then すべて green で validate が通る

## 受け入れ基準
- [ ] 実 messages.json（en/ja 両方）を読み compareLocaleKeys に流す vitest テストを新設
- [ ] panelCatalog.test.ts に sidebarI18nKey の両 locale 存在 assert を追加（意図的 skip の解消）
- [ ] panelCatalog.test.ts の手動カウント literal（toHaveLength(25) 等・golden pin に包含されるもの）を削除
- [ ] tagClusterTab キーを両 locale に追加（現状未定義のため assert を通すには必須）
- [ ] テストは `npm test`（validate 内）で走ることの確認

## テスト戦略
- 単体: 新規 parity テスト（意図的にキーを壊すネガティブ確認は1回手動で実施し記録）
- 統合: panelCatalog.test の拡張
- 単体: 既存 compareLocaleKeys の unit test は無変更で green

## 実装メモ
- compareLocaleKeys は scripts/release-checks/i18n-core.mjs に実装済み・unit test 済み → 再実装しない
- 死キー検出（参照ゼロキー）は動的キー構築で誤検出が出るため本 PBI の対象外（Speculative）
- panelCatalog.test の pinned golden リストは維持（意図的 golden）

## 見積もり
0.25 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（文書要件がある場合のみ適用）
