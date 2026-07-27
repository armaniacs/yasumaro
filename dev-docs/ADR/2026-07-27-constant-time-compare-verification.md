# ADR: constantTimeCompare フォールバック実装の定数時間性検証

## ステータス

記録日: 2026-07-27

検証進行中。自動化可能な範囲（実行環境での可用性チェック）は完了。実ブラウザ Service Worker Console でのタイミング計測は未実施。

## 背景

PBI-11 は `src/utils/crypto/index.ts` の `constantTimeCompare()` におけるフォールバック実装（`timingSafeEqual` が利用不可の場合の文字ループ比較）が、実際のブラウザ実行環境で定数時間に動作するかを検証することを目的としている。

## 検証環境

| 項目 | 値 |
|---|---|
| 実行コンテキスト | Playwright 経由で起動した拡張機能の Service Worker |
| User Agent | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36` |
| 反復回数 | 可用性チェックのみ実施（タイミング計測は未実施） |

## crypto.subtle.timingSafeEqual の利用可能性

Playwright で起動した HeadlessChrome/149 の Service Worker コンテキストでは **`crypto.subtle.timingSafeEqual` は `undefined`** であり、利用できない。

```text
hasCrypto: true
hasSubtle: true
timingSafeEqualType: 'undefined'
hasTimingSafeEqual: false
```

## 影響

この環境では、`constantTimeCompare()` は毎回フォールバック実装（文字列長のビット XOR 合成＋最大長までのループ比較）を実行する。

これは以下を意味する:

- **フォールバックパスはデッドコードではない**。特定の Chrome/Chromium ビルドや実行コンテキストでは実際に実行される。
- **PBI-11 のタイミング計測は依然として価値がある**。フォールバックパスの定数時間性を実証していない環境が存在する。
- **実行環境ごとに `timingSafeEqual` の有無が変わる可能性がある**。Playwright バンドルの Headless Chromium では欠如しているが、一般ユーザーが使用する Google Chrome や Chromium では利用可能な可能性が高い。

## ベンチマークスクリプト

計測用のスタンドアロンスクリプト `scripts/benchmark-constant-time-compare.mjs` を作成済み。Node.js 上での予備実行は成功しているが、**Node.js の V8 は Chrome Service Worker の V8 と最適化が異なるため、本結果は sanity-check のみ**とする。

## 未完了事項

以下は実際の Chrome ブラウザ（headed モード、または一般ユーザー環境）で人手または追加自動化により実施が必要:

1. Service Worker DevTools Console への `scripts/benchmark-constant-time-compare.mjs` の貼り付け実行
2. early-mismatch / late-mismatch / match の比較時間計測
3. 統計的に有意な時間差の有無の判定
4. 判定結果に基づく追加対策の要否決定

## 仮結論

- `crypto.subtle.timingSafeEqual` の可用性は **実行環境に依存する**。
- Playwright テスト環境ではフォールバックパスが実行されることが確認されたため、フォールバック実装の定数時間性検証を放置することはできない。
- 一方、一般ユーザーが使用する最新の Google Chrome では `timingSafeEqual` が利用可能な可能性が高く、その場合フォールバックパスは実行されない。
- 確定的な結論を出すためには、複数の実 Chrome 環境（バージョン、OS、チャネル）での計測が必要。

## 次のアクション

1. 実 Chrome ブラウザで `scripts/benchmark-constant-time-compare.mjs` を実行し、結果を本 ADR に追記する。
2. フォールバック実装で有意な時間差が検出された場合は、定数時間比較ライブラリの採用や実装見直しを検討する別 PBI を起票する。
3. 有意差が見られない場合は、フォールバック実装で対策十分と判断し、PBI-11 をクローズする。
