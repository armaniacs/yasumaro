# PBI-0823a-01: extractor.ts 残り4責務の完全分割

## ユーザーストーリー

開発者として、`extractor.ts` の残り4責務を独立モジュールに分割したい。なぜなら593行に `loadSettings`/`throttle`/`visitTracker`/`reportValidVisit` が同居し、1つの概念理解に4モジュールを跨ぐ必要があり、テストは `shouldRecordVisit` 以外が書けないから。

## 優先度

- **順位**: 1 / 8
- **RICE**: 720 (Reach 9 × Impact 3 × Conf 80% / Effort 1.0w)
- **根拠**: content script 層の最大 God。4モジュール抽出でテスト容易性が一気に向上。依存なしで即着手可能。
- **依存**: なし（最優先）

## BDD受け入れシナリオ

```gherkin
Scenario: loadSettings が PageState に32ルールを正しく書き込む
  Given storage に CleansingConfig の一部キー（例: aiSummaryCleansingEnabled=true）が保存されている
  When  settingsLoader.loadSettings(pageState) を呼ぶ
  Then  pageState の該当フィールドが期待値で上書きされる
  And   未保存キーは DEFAULT_CLEANSING_CONFIG のまま

Scenario: visitTracker がスクロールと滞在時間を正しく判定する
  Given VisitTracker が pageState(threshold: 5s, 50%) で初期化されている
  When  3秒滞在 + 30%スクロール
  Then  shouldRecord は false
  When  6秒滞在 + 60%スクロール
  Then  shouldRecord は true

Scenario: validVisitReporter が retry+dialog を正しく処理する
  Given privacyStatus が要確認
  When  reportValidVisit() を呼ぶ
  Then  privacyDialog が表示され、OK なら再送、Cancel なら停止
```

## 受け入れ基準

- [x] `src/content/settingsLoader.ts` — `loadSettings(pageState: PageState): Promise<void>` 単一 seam。`CLEANSING_RULES.map` で32ルール導出
- [x] `src/content/visitTracker.ts` — `VisitTracker` クラス（`updateMaxScroll/scroll/shouldRecord/start/stop`）
- [x] `src/content/validVisitReporter.ts` — `ValidVisitReporter`（`reportValidVisit + GET_CONTENT handler` 1 seam）
- [x] `src/utils/throttle.ts` — 汎用 `throttle<T>(fn, ms)` に昇格、extractor から分離
- [x] `extractor.ts` は `init()` の委譲のみ（<100行）に縮小、re-export で後方互換
- [x] 単体テスト: settingsLoader 6件 + visitTracker 8件 + validVisitReporter 4件
- [x] `npm run type-check` / `npm test` PASS

## テスト戦略

- **E2E**: 既存 `content-script-recording.spec.ts` が全て PASS（data-ow-* 契約維持）
- **統合**: content script 初期化 → scroll → report → storage 保存の往復
- **単体**: 上記受け入れ基準のテスト群（jsdom + fakeTimers）

## 見積もり

5pt（1.0人週）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装され PASS
- [x] `extractor.ts` が 100行以下
- [x] コードレビュー完了
- [x] ドキュメント更新済み
