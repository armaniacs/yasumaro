# PBI 17: dashboard 同型スカフォールドの共通化（優先度スロット・purge・cap 通知）

## ユーザーストーリー
メンテナーとして、dashboard 内の同形スカフォールドが 1 実装になった状態がほしい、なぜなら同形コードの複製は、文言やキー名がパネルごとに漂う不整合を生むから。

## 変更点の概要
dashboard 内の 4 つの同型複製を 1 実装へ共通化する。出力は不変。

## 現状と問題
- src/dashboard/settingsForm.ts:28-51（優先度スロット定義 ×3 重複）+ :221-275（purge スカフォールド ×2 重複）
- fetch-cap 通知: src/dashboard/panels/asyncData/clusterGraphRenderer.ts:208 の showRowCapNotice が存在するのに手書き 4 箇所（domainAnalysisPanel.ts:180-187 / researchSessionsPanel.ts:518-525 / revisitInsightsPanel.ts:377-387 / tagFrequencyTimelinePanel.ts:398-405）。tagFrequencyTimelinePanel のみ通知キーが 'cap' で他は 'rowCap' と不整合。ヘルパー自体の所在も SVG レンダラ内で凝集を損なう
- OPFS-worker 判定述語: src/dashboard/DiagnosticsCollector.ts:205 vs src/dashboard/diagnosticsPanel.ts:313（同形述語 ×2）
- テスト: clusterGraphRenderer.test.ts:218-220 がヘルパーを直接検証。手書き側は lifecycle/golden テストで間接カバー

## 変更の理由
[DRY] 同形複製は文言・キー名の漂い（'cap' vs 'rowCap' の実例）を生む。1 実装への共通化で不整合が止まる。

## 提案コード（骨子）
- 優先度スロット: 1 定義を共有
- purge: 1 ハンドラへ集約
- cap 通知: showRowCapNotice を panels 共有モジュールへ移動し、手書き 4 箇所を置換（通知キーは 'rowCap' に統一）
- 判定述語: 1 述語を共有

## BDD受け入れシナリオ
Scenario: cap 通知の統一
  Given fetch が上限に達する
  When 4 パネルが cap 通知を出す
  Then すべてが showRowCapNotice 経由で同一キー 'rowCap' と同一文言になる（通知内容の情報量は変更前と同一）

Scenario: purge 動作の不変性
  Given purge スカフォールド ×2
  When 1 ハンドラへ集約する
  Then 削除対象・確認フローの挙動は変更前と同一である

## 見積もり
2 pt（RICE: 18 = Reach 9 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 4 つの複製が 1 実装になり、通知キー不整合が解消される
- [ ] 既存テスト全通過
- [ ] npm run validate 通過
