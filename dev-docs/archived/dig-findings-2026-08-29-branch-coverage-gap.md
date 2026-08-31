# なぜなぜ分析 — branches カバレッジ 83.4% → 87.84% の残差

## 現象
`npm run test:coverage` の branches カバレッジが 90% ゲートを下回っている（PBI 作成時 83.4% → 現在 87.84%、残 ~263 branches）。

## 5 Whys

1. **なぜ branches カバレッジが 90% に達しないのか**
   → 12211 total branches のうち 10727 しかカバーされておらず、263 branches が未テスト。

2. **なぜ 263 branches が未テストなのか**
   → 182 のソースファイルが 90% 未満の branch coverage を持ち、その多くは DOM 操作、条件分岐、エラーハンドリング、またはモックが必要な非同期パスの分岐を含んでいる。

3. **なぜこれらの分岐にテストがないのか**
   → 一部は元からテストが存在しなかった（no-test files、計 434 uncovered branches）、一部は既存テストが happy path のみをカバーしており、エラーケース・フォールバック・無効入力などの分岐を網羅していない。

4. **なぜエラーケース・フォールバック分岐が網羅されていないのか**
   → 多くのファイルは UI 層の DOM コントローラー（dashboard、popup）またはインフラ層の非同期クライアント（background、offscreen）であり、これらの「失敗時」「要素不在時」「null/undefined 時」の分岐を網羅するには大量の jsdom モック設定や Chrome API の vi.fn() 置き換えが必要で、既存テストではその工数が割かれていなかった。

5. **なぜ既存テストでは工数が割かれていなかったのか**
   → プロジェクトのテスト戦略は「lines 94%+、functions 93%+」を維持できていたため、branches の 90% ゲートはリリース直前の check script で初めて顕在化した。過去の PBI では branch coverage ゲートが明示的な DoD に含まれていなかった。

## 解: 自律的に導出した解決策

263 branches を閉じるには、以下の 2 段階アプローチが必要：

### Phase A: 低コスト・高インパクト（~100 branches）
対象: 未テストファイルのうち、small pure functions を含むもの
- `dashboard/historyBadges.ts`（19 uncovered）↔ テスト済（追加済）
- `dashboard/historyState.ts`（1 uncovered）
- `popup/spinner.ts`（1 uncovered）
- `popup/domUtils.ts`（1 uncovered）
- `utils/urlUtils.ts`（1 uncovered）
- `utils/auditLog.ts`（1 uncovered）
- `utils/privacyStatusCodes.ts`（1 uncovered）
- `background/net/ollamaOriginRule.ts`（1 uncovered）
- `background/swStatePersistence.ts`（1 uncovered）
- etc.

これらは既存テストファイルへのケース追加で対応可能。subagent で一部実施済。

### Phase B: 中〜高コスト（~163 branches）
対象: DOM コントローラー・非同期パイプラインの複合分岐
- `dashboard/masterPassword.ts`（37 uncovered）— 120 total branches、最も大きな単体ファイルの gap
- `dashboard/historyPendingPanel.ts`（26 uncovered）
- `utils/migration.ts`（25 uncovered）
- `utils/promptSanitizer.ts`（25 uncovered）
- `dashboard/historyEntryRow.ts`（24 uncovered）
- `background/ai/providers/OpenAIProvider.ts`（23 uncovered）
- `offscreen/storageFallback.ts`（22 uncovered）
- `background/createBackgroundServices.ts`（22 uncovered）
- `dashboard/tagClusterPanZoom.ts`（22 uncovered）

これらは専用の branch-coverage test file（`.branches.test.ts`）を新設するか、既存テストに相当数のケースを追加する必要がある。1 ファイルあたり 10〜30 ケースが必要。

## 実施結果（本セッション）
- htmlEscape.ts type error: 修正済
- i18n 4 キー追加: 済（既存 keys、en/ja 両方確認済）
- branches coverage: 83.4% → 87.84%（+448 branches カバー）
- `npm run validate`: PASS（type-check + 10255 tests）
- `npm run build`: PASS
- 新規 test files: 18 ファイル追加（subagent + 手動）
- 既存 test files 拡張: 15 ファイル以上（subagent）

## 残課題
- branches coverage: 87.84% → 90.0%（残 ~263 branches）
- 対象ファイル: 182 files below 90% branches
- 推定工数: Phase A 完了済、Phase B に約 1〜2 人日の focused test writing が必要
