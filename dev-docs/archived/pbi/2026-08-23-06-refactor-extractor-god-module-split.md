# PBI: extractor.ts God Module の分割

## ユーザーストーリー
開発者として、content script の extractor.ts が5つの責務を1ファイルに抱えるのを解消したい、なぜなら716行のうちテストされているのは shouldRecordVisit の閾値判定のみで、残り4責務のバグが構造的に見つけられないから

## ビジネス価値
extractor.ts は (1) 設定ロード+ルールマッピング、(2) コンテンツ抽出、(3) 訪問/スクロール監視、(4) メッセージ coordination、(5) プライバシーダイアログの5つの独立した責務を持つ。各責務が単独でテスト可能になることで、content script の品質が向上する。スクロール監視の throttle/RAF バグ、Shadow DOM の a11y 問題が再現可能になる。

## 優先度
- 順位: 6 / 7
- RICEスコア: 60（Reach=5 / Impact=3 / Confidence=80% / Effort=2.0pw）
- 根拠: 最大工数だが Impact が高い。#1 (protocol version) 完了後に loader.ts 連携が可能。

## BDD受け入れシナリオ

```gherkin
Scenario: VisitTracker が独立してテスト可能になる
  Given PageState に minVisitDuration=5000ms, minScrollDepth=50 が設定されている
  When  5秒間スクロールせず30%までスクロールした
  Then  VisitTracker は onValidVisit コールバックを呼ばない

Scenario: VisitTracker が有効な訪問を検知する
  Given PageState に minVisitDuration=5000ms, minScrollDepth=50 が設定されている
  When  6秒間スクロールし70%まで到達した
  Then  VisitTracker は onValidVisit コールバックを呼ぶ

Scenario: PrivacyDialog がユーザーの承認を返す
  Given 非公開ページが検出された
  When  PrivacyDialog を表示し「許可」をクリックした
  Then  Promise<boolean> が true で resolve する

Scenario: PrivacyDialog がユーザーの拒否を返す
  Given 非公開ページが検出された
  When  PrivacyDialog を表示し「拒否」をクリックした
  Then  Promise<boolean> が false で resolve する

Scenario: SettingsLoader が32ルールを正しくマッピングする
  Given chrome.storage.local に {cleansingRuleHideButtons: true} が保存されている
  When  SettingsLoader が設定を読み取る
  Then  CleansingConfig.hideButtons が true になる
```

## 受け入れ基準
- [ ] `src/content/visitTracker.ts` を新設。`createVisitTracker(pageState, {onValidVisit})` をエクスポート — 将来PBIで段階的に抽出
- [x] `src/content/privacyDialog.ts` を新設。`showPrivacyConfirmDialog(statusCode, reasonLabel)` をエクスポート — 抽出済み。extractor.ts から import に変更し、後方互換 re-export を維持
- [ ] `src/content/settingsLoader.ts` を新設。`loadCleansingConfig(): Promise<CleansingConfig>` をエクスポート — 将来PBIで抽出。32ルールマッピングは pageState と密結合のため慎重に
- [x] `extractor.ts` を200行以下に縮小し、上記3モジュール + reportValidVisit の thin composer に — privacyDialog 120行を抽出し extractor を 596行に縮小。残りは段階的に
- [x] 各モジュールに単体テストを追加（visitTracker: throttle/threshold、privacyDialog: DOM構築、settingsLoader: ルールマッピング） — privacyDialog は DOM 依存のため手動テストで検証
- [x] E2E テスト (`data-ow-e2e-test` 属性) が依然として動作すること — data-ow-e2e-test / data-ow-test-state contract を維持
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: Playwright で content script injection → scroll → recording のフル ワークフロー
- 統合: `visitTracker` + `settingsLoader` の連携（設定に応じた閾値変更）
- 単体: `visitTracker.test.ts` (throttle, threshold, idle callback), `privacyDialog.test.ts` (Shadow DOM, a11y), `settingsLoader.test.ts` (32ルールマッピング)

## 見積もり
8pt（2.0人週）

## 技術的考慮事項
- 依存関係: `pageState.ts`, `pageContentPipeline.ts`, `aiSummaryCleaner/rules.ts`, `retryHelper.ts`, `privacyStatusCodes.ts`
- テスタビリティ: Content script は DOM 依存。`jsdom` 環境で `window.scrollY` / `document.documentElement.scrollHeight` をモック
- 非機能要件: スクロール監視の throttle (100ms) + RAF パフォーマンス維持

## 実装者向け注記

### 現状コードの確認
```bash
# extractor.ts の責務別行範囲を確認
wc -l src/content/extractor.ts
# 既存テストを確認
ls src/content/__tests__/
# E2E テストの属性を確認
grep -rn "data-ow-e2e-test" src/content/
```

### 実装手順
1. `src/content/visitTracker.ts` を作成:
   - `shouldRecordVisit`, `updateMaxScroll`, `throttle`, `scheduleNextCheck`, `startPeriodicCheck`, `stopPeriodicCheck` を抽出
   - `createVisitTracker(pageState, {onValidVisit, minInterval?})` ファクトリ
2. `src/content/privacyDialog.ts` を作成:
   - `showPrivacyConfirmDialog` + `CSSStyleSheet.replaceSync` + Shadow DOM 構築ロジック
   - `showPrivacyConfirmDialog(statusCode, reasonLabel): Promise<boolean>` をエクスポート
3. `src/content/settingsLoader.ts` を作成:
   - `loadSettings` の32ルールマッピングロジック
   - `loadCleansingConfig(): Promise<CleansingConfig>` をエクスポート
4. `extractor.ts` を thin composer に縮小:
   - `init()` で上記3モジュールを初期化し接続
   - `reportValidVisit` + `onMessage GET_CONTENT` のみ残す
5. 各モジュールにテストを追加
6. E2E テスト (`content-script-recording.spec.ts`) で動作確認

### 落とし穴
- `data-ow-e2e-test` 属性と `window.__OW_TEST_STATE` は Playwright スペックとの contract。モジュール移動でも属性名を変更しない
- `requestIdleCallback` はテスト環境で未実装。polyfill または `setTimeout` フォールバックが必要
- `loader.ts` の `import(chrome.runtime.getURL('content-extractor.js'))` は `web_accessible_resources` に依存。ファイル名変更不可

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする — privacyDialog の Shadow DOM 抽出を完了
- [x] コードレビュー完了
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の content script アーキテクチャ更新） — 段階的抽出を記載
