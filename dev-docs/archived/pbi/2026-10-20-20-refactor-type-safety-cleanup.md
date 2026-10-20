# PBI 20: 型安全性整備の残り（不要 as の排除・二重表現の統一）

## ユーザーストーリー
メンテナーとして、不要なキャストと二重表現が消えた状態がほしい、なぜなら as での看破は不正値を型レベルで正当化し、二重表現は消費者ごとに分岐を強制して静かな空表示を生むから。

## 変更点の概要
8 ファイルの不要 as と二重表現を排除する。実行時の値は不変。

## 現状と問題
- src/background/RecordingOrchestrator.ts:185（deps.aiService as never）
- src/background/pipeline/steps/commonStorageFields.ts:103-148（as 連鎖、patch 型フィールド欠落）
- src/dashboard/visitReporter.ts:212（不要な confirm キャスト）
- src/dashboard/exportImport.ts:130-134（不要 as ×5）
- src/dashboard/settingsPipeline.ts:178（AI_PROVIDER_LAYOUT を as Record → as 'a'|'b' の二重キャストで看破）
- src/dashboard/settings/trustSettings.ts:330,365,376（as TrancoTier / as SafetyMode の境界ガードなし。対照的に category は :30-36 の isTrustCategory で保護済み）
- src/popup/statusChecker.ts:127,153（ローカル PrivacyInfo 型 + domain_filter_mode as）
- src/utils/ublockMatcher.ts:204-227（async なのに await なし + ublockRules as object）
- src/utils/urlEntry.ts:49（removedByReason?: Record | Map の二重表現。保存 wire 型は Record（storage/types.ts:562）、extractor 側は Map（extractionReport.ts:42）。cleansingStatsView.ts:261-275 が instanceof Map で防御的分岐）
- src/dashboard/panels/types.ts:16（PanelLifecycle.init の Record を PanelInitMap へ）
- src/dashboard/panels/asyncData/domainSearchPanel.ts:59-60（settings[StorageKeys.X as keyof Settings] as string[] の二重キャスト、コードベース内で唯一）

## 変更の理由
[型安全性] キャスト群は不正値の流入を型レベルで隠す。urlEntry の二重表現は Map 値を Record 仮定の消費者へ流すと Object.entries(Map) が空配列を返し、理由内訳が静かに空表示になる。

## 提案コード（骨子）
- trustSettings: isTrancoTier / isSafetyMode ガードを付与（category と同一パターン）
- urlEntry: 保存 wire 型 Record に統一し、extractor 側を変換 1 箇所へ（実効値は不変）
- domainSearchPanel: 直接インデックスで型取得（Settings 型が既に返す形）
- ublockMatcher: 同期化または await 追加（シグネチャ変更は呼び出し元 1 箇所のみ）

## BDD受け入れシナリオ
Scenario: 不正値の流入防止
  Given DOM select 値に不正な文字列が入る
  When trustSettings の change リスナが通る
  Then ガードが不正値を弾き、TrustDbAdmin へ流れない（正常値の経路は不変）

Scenario: 二重表現の統一
  Given Record と Map の両方があり得た removedByReason
  When Record に統一する
  Then 全消費者（cleansingStatsView・cleansingFeedbackView）の表示は変更前と同一である

## 見積もり
2 pt（RICE: 14 = Reach 14 × Impact 2 × Confidence 1.0 ÷ Effort 2.0 人日）

## DoD
- [x] 対象 11 箇所の不要 as が消える（二重表現 1 件を含む）
- [x] 既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 11 箇所整備（実行時の形は不変・型レベルのみ）: RecordingOrchestrator as never 削除、urlEntry の Record|Map 二重表現を Record に統一（cleansingStatsView の instanceof Map 防御的分岐も削除）、commonStorageFields の as unknown as 連鎖排除 + recordType を RecordType 型に、statusChecker の手書き PrivacyInfo を canonical 型 import に置換 + isFilterMode 境界ガード、settingsPipeline / domainSearchPanel の二重キャストを直接インデックスに、exportImport の as string 5 つ削除（optional 型明示）、trustSettings の 3 キャストを isTrancoTier / isSafetyMode 境界ガードに、ublockMatcher の非同期不要を同期化 + as object 削除、visitReporter の confirm 関数キャスト削除
- 別 PBI 候補として報告: panels/types.ts:16 の Record → PanelInitMap は NavigationRegistry の wide navigate() が pin する init パススルー契約と不整合のため型レベルのみでは完結しない
- 検証: 担当モジュールのテスト全 green、npm run type-check exit 0、eslint（11 ファイル）エラーなし、validate:fast green
