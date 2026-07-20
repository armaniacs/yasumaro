# PBI: コンテンツスクリプトのスクロール/ポーリング負荷軽減

元指摘: Checking Team (High: Tuning Expert; Medium: Edge & Mobile Strategist)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、コンテンツスクリプト (`src/content/extractor.ts`) が全ページで1秒ごとに `setInterval` を実行し、スクロールイベントを監視している現状を改善したい。なぜなら、これはモバイル端末やヘビーなページでフレームドロップや入力遅延を引き起こし、ユーザー体験を損なうから。

## ビジネス価値

- ページ読み込みパフォーマンス向上
- モバイル・バッテリー消費の削減
- Chrome Web Store レビュー時のパフォーマンス評価向上

## 前提・制約

- 現在の `init()` は `loadSettings()` → scroll listener → `startPeriodicCheck()` を同期的に実行
- `updateMaxScroll` はスクロール深度追跡用
- `startPeriodicCheck` は1秒間隔で `updateMaxScroll` を呼び出す
- Content Script は `chrome.storage.local.get` を30+キーで呼び出している可能性がある

## BDD受け入れシナリオ

```gherkin
Feature: Content script performance

  Scenario: Scroll tracking uses IntersectionObserver where beneficial
    Given the page has scrollable content
    When the user scrolls
    Then scroll depth is updated without continuous scroll listeners polling DOM

  Scenario: Initialization is deferred after page load
    Given the page is loading
    When DOMContentLoaded fires
    Then heavy initialization is scheduled via requestIdleCallback

  Scenario: Storage reads are batched into a single settings object
    Given the content script needs settings
    When it loads
    Then it calls chrome.storage.local.get with one key instead of 30+ keys
```

## 受け入れ基準

- [ ] `window.addEventListener('scroll', ...)` を `IntersectionObserver` ベースまたは `requestAnimationFrame` 限界 throttling に置き換え
- [ ] `setInterval(updateMaxScroll, 1000)` を `requestIdleCallback` または `visibilitychange` 駆動に変更（ページが active のみ実行）
- [ ] `loadSettings()` での `chrome.storage.local.get` を単一 `get('settings')` に統合（移行完了済みならフォールバックコードを削除）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `extractor.test.ts` において、スクロール時の呼び出し回数・間隔を検証
- `IntersectionObserver` モックを使用したテスト

### 統合テスト
- 実際の Web ページ（E2E）でパフォーマンスプロファイルを取得し、メインスレッドブロッキング時間が削減されることを確認

## 実装アプローチ

- **Inside-Out**: まず `setInterval` を除去 → scroll listener の最適化 → storage 読取統合
- `updateMaxScroll` の本質的な目的を確認し、本当にポーリングが必要か再設計

## 見積もり
3pt（イベント駆動への書き換え + storage 読取統一 + テスト）

## 副作用
🟡 軽微 — スクロール深度追跡の挙動がわずかに変わる可能性がある。記録トリガーの閾値に影響がないよう注意。

## 落とし穴
- `IntersectionObserver` は全ブラウザでサポートされているが、Chrome 拡張の Content Script 内での挙動は検証が必要
- `requestIdleCallback` は非アクティブタブでは発火しない。記録条件を満たすタイミングを見逃さないよう、`visibilitychange` 時の補完処理が必要

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加/更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
