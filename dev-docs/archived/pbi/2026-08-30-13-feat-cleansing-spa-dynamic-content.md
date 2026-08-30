# PBI: SPA動的コンテンツのクレンジングタイミングを改善する

## ユーザーストーリー

SPA(無限スクロール/遅延読み込み)の閲覧者として、スクロールで追加されたコンテンツも含めてクレンジングされた要約がほしい。なぜなら現行 `contentKernel.ts` は `requestIdleCallback` で1回だけ抽出し、スクロールで追加されたコメント欄や広告がクレンジング対象外になるから。

## 優先度

- 順位: 13 / 15
- RICE: Reach 5 / Impact 2 / Confidence 0.5 / Effort 3日 = 1.67
- 根拠: SPAの普及率は高いが、Yasumaroの `VALID_VISIT` 判定(滞在5秒+スクロール50%)で既に一定の遅延があるため、追加コンテンツの取りこぼしは部分的。`MutationObserver` 導入の複雑さでEffortは中。

## 背景

- 現行: `contentKernel.ts` の `scheduleNextCheck` は `requestIdleCallback(2000ms)` で1回 `updateMaxScroll` → `checkVisitConditions` → `VALID_VISIT` 達成で `extractPageContent` を1回実行。`lazyLoad` ルールは `loading="lazy"` 要素を削除するが、遅延読み込み自体は対象外。
- 課題: 無限スクロールで追加されたDOMは `VALID_VISIT` 後の `extractPageContent` に含まれない。コメント欄の遅延読み込み(Disqus等)は `VALID_VISIT` 時点で未描画のため、クレンジング対象にならない。
- 機会: `MutationObserver` でDOM変化を監視し、一定量の変化があれば再抽出をスケジュールする。または `VALID_VISIT` のタイミングを `MutationObserver` の静穏化(1秒間変化なし)まで遅延させる。
- 追加見落とし: 当初の11案では動的コンテンツの取りこぼしが考慮されていなかった。`lazyLoad` ルールは「遅延読み込み要素を削除する」が、「遅延読み込みが完了するまで待つ」ではない。

## BDD 受け入れシナリオ

```gherkin
Scenario: 無限スクロール後のコンテンツもクレンジングされる
  Given ページで VALID_VISIT が達成された
  And その後スクロールで10件の新要素が追加された
  When 再抽出がスケジュールされる
  Then 追加された要素も含めてクレンジングが実行される

Scenario: 遅延読み込み完了後にクレンジングされる
  Given ページに loading="lazy" の画像が10件ある
  And 画像の読み込みが完了していない
  When MutationObserver が静穏化する(1秒間変化なし)
  Then クレンジングが実行される

Scenario: 変化がなければ再抽出しない
  Given ページで VALID_VISIT が達成された
  And その後DOM変化がない
  When 5秒経過する
  Then 再抽出はスケジュールされない

Scenario: 従来の VALID_VISIT フローは維持される
  Given 通常の静的ページがある
  When VALID_VISIT が達成される
  Then 従来通り1回でクレンジングが実行され、MutationObserver は追加の再抽出をしない
```

## 受け入れ基準

- [ ] `contentKernel.ts` または `extractor.ts` に `MutationObserver` によるDOM変化監視が追加される
- [ ] 一定量のDOM変化(例: 10要素追加)または静穏化(1秒間変化なし)で再抽出がスケジュールされる
- [ ] 再抽出は `extractPageContent` の再実行 + `VALID_VISIT` の再報告(または更新)として実装される
- [ ] 変化がなければ再抽出しない(無限ループ防止)
- [ ] 従来の静的ページでの挙動は変わらない
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- Playwrightで無限スクロールページを開き、スクロール後のクレンジング結果を検証(手動)

### 統合
- `contentKernel.test.ts` に `MutationObserver` の統合テスト。`FakeScheduler` と `jsdom` の `MutationObserver` モックで再抽出を検証

### 単体
- `MutationObserver` コールバックの単体テスト: 変化検出 / 静穏化判定 / 閾値判定
- 再抽出スケジューリングの単体テスト: 変化あり→スケジュール / 変化なし→スキップ
- 無限ループ防止のテスト: 再抽出後のDOM変化で再々抽出が無限に続かない

## 実装アプローチ

- **Spike分離**: `MutationObserver` の挙動(どの変化を検出するか、パフォーマンス影響)を先に検証するスパイク
- **Outside-In**: `contentKernel.test.ts` にREDテスト → `contentKernel.ts` に `MutationObserver` 追加 → グリーン
- **段階移行**: Phase 1は `VALID_VISIT` 後の再抽出のみ。Phase 2で `VALID_VISIT` 自体の遅延(静穏化まで待つ)。Phase 1の成功をPhase 2の前提とする

## 見積もり

3pt (スパイク1 + 実装1 + テスト1)

## 技術的考慮事項

- 依存: `contentKernel.ts` / `MutationObserver` (ブラウザAPI)
- テスタビリティ: `MutationObserver` は jsdom で `window.MutationObserver` として利用可能。`FakeScheduler` で再抽出タイミングを制御
- 非機能: `MutationObserver` の監視コスト。`subtree: true, childList: true` で全DOM変化を監視すると高コスト。`throttle` で間引きが必要
- パフォーマンス: 再抽出のたびに `cloneNode(true)` + 74回 `querySelectorAll` が走る。再抽出の頻度は `throttle` (例: 5秒に1回)で制限

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "MutationObserver\|scheduleNextCheck\|checkVisitConditions" src/content/contentKernel.ts
cat src/content/contentKernel.ts | grep -A20 "scheduleNextCheck"
```

### 実装手順
1. スパイク: `MutationObserver` で `document.body` の変化を監視し、どの程度の頻度でコールバックが発火するか計測
2. `contentKernel.ts` に `observeDynamicContent` を追加。`MutationObserver` で `childList` 変化を監視し、 `throttle` で5秒に1回 `checkVisitConditions` を再実行
3. `contentKernel.test.ts` に `MutationObserver` のテストを追加。`FakeScheduler` で再抽出を検証
4. 従来の `VALID_VISIT` フローとの相互作用をテスト

### 落とし穴
- `MutationObserver` はクレンジング自体のDOM操作( `cloneNode` )でも発火する可能性がある。`observer.disconnect()` で一時的に停止するか、 `isInternalChange` フラグで無視する
- 無限スクロールで追加された広告は `stripAdElements` で除去されるが、追加された本文も `bodyProtection` で保護される必要あり。`markBodyElements` が再抽出時にも正しく動作するか確認
- `VALID_VISIT` の再報告は `VisitReporter` の `isValidVisitReported` フラグで1回のみに制限されている。再抽出時は `isValidVisitReported` をリセットするか、別メッセージタイプ( `CONTENT_UPDATED` )で報告する必要がある

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
