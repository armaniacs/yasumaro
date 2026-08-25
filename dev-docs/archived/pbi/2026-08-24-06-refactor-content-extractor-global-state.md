# PBI: Content extractor の global mutable PageState と 594-line shallow module を分解

## ユーザーストーリー
開発者として、`extractor.ts` の module-level mutable global `PageState` を per-tab factory に変更し、594 行の shallow module を責務別に分割したい。なぜなら `init()` が scroll tracking / visit gating / settings load / content extraction の 6 concerns を 1 関数に詰め込んでおり、local locality が破壊されているから。

## 優先度
- 順位: 07 / 全候補数 7
- RICEスコア: 1.6（Reach=3 / Impact=1 / Confidence=80% / Effort=1.5人週）
- 根拠: 依存関係上最後に着手。Speculative — PBI-01 完了後の settings access 整備後にのみ着手。

## BDD受け入れシナリオ

Scenario: PageState が per-tab factory になる
  Given `pageState` が module-level mutable global である
  And 9 関数がこの global を共有している
  When `PageState` を per-tab factory に変更する
  Then 各タブが独立した `PageState` インスタンスを持つ
  And global mutable が存在しない

Scenario: extractor.ts が thin orchestrator になる
  Given `extractor.ts` が 594 行で threshold policy + persistence + UI dialog retry を扱う
  When `visitGate.ts`（pure gate + injected settings）/ `scrollTracker.ts` / `contentReporter.ts` に分割する
  Then `extractor.ts` は各モジュールを orchestrate するのみである
  And 各モジュールが単一の concern を持つ

## 受け入れ基準
- [ ] `PageState` が per-tab factory に変更されている
- [ ] `extractor.ts` が `visitGate.ts` / `scrollTracker.ts` / `contentReporter.ts` に分割されている
- [ ] `loadSettings` が `SettingsRepository` 経由で Settings を取得する
- [ ] `CLEANSING_RULES` の手動列挙が `CLEANSING_RULES.map` で導出される
- [ ] 既存の content script テストが PASS する
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: content script の visit gating が既存テストで検証されていることを確認
- **単体**: `visitGate` の threshold テスト、`scrollTracker` の throttle テスト
- **契約**: `PageState` が per-tab であることをコンテンツスクリプトの複数タブテストで検証

## 見積もり
1.5 ストーリーポイント（中 — 1.5 人週程度）

## 技術的考慮事項
- **依存**: PBI-01（SettingsRepository shim 廃止）に依存
- **テスタビリティ**: pure function 化により、テストは content script 環境をモックして gate logic を検証可能
- **非機能要件**: コード可読性向上。バグの local 化。

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "pageState" src/content/extractor.ts | head -20
grep -n "loadSettings" src/content/extractor.ts
wc -l src/content/extractor.ts
```

### 実装手順
1. `PageState` を per-tab factory に変更（`createPageState(tabId)`）
2. `extractor.ts` から `visitGate.ts` を抽出（pure `shouldRecordVisit` + injected `getSettings`）
3. `scrollTracker.ts` を抽出（scroll + throttle + visibilitychange）
4. `contentReporter.ts` を抽出（content extraction + offscreen send）
5. `loadSettings` を `SettingsRepository` 経由に変更
6. `CLEANSING_RULES.map` でルールを導出

### 落とし穴
- `extractPageContent` は既に pure function 化されている（PBI 2026-08-17-28）。`applyExtractResultToPageState` の呼び出し順を維持する。
- content script は service worker の再起動で state が失われる可能性がある。`PageState` の統計情報は永続化不要か確認する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
