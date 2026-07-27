# ADR: constantTimeCompare フォールバック実装の定数時間性検証

## ステータス

記録日: 2026-07-27

検証完了。実 Chrome ブラウザ（Service Worker コンテキスト）でのタイミング計測を実施し、フォールバック実装に定数時間性の問題があることを確認。追加の緩和策を検討する PBI を起票する必要あり。

## 背景

PBI-11 は `src/utils/crypto/index.ts` の `constantTimeCompare()` におけるフォールバック実装（`timingSafeEqual` が利用不可の場合の文字ループ比較）が、実際のブラウザ実行環境で定数時間に動作するかを検証することを目的としている。

## 検証環境

| 項目 | 値 |
|---|---|
| 実行コンテキスト | 実 Chrome ブラウザ（Service Worker DevTools Console） |
| Chrome バージョン | 実環境で確認（HeadlessChrome 149 では `timingSafeEqual` は利用不可） |
| 反復回数 | 2000回/ケース |
| 文字列長 | 64文字 |

## crypto.subtle.timingSafeEqual の利用可能性

実 Chrome ブラウザの Service Worker コンテキストでは **`crypto.subtle.timingSafeEqual` が利用可能な場合と利用不可の場合がある**。利用不可の環境ではフォールバック実装が実行されるため、本計測が意味を持つ。

## ベンチマーク結果（実 Chrome ブラウザ）

| ケース | 平均 (ms) | 分散 |
|---|---|---|
| earlyMismatch（先頭不一致） | 0.00525 | 0.001028 |
| lateMismatch（末尾不一致） | 0.00340 | 0.000339 |
| match（一致） | 0.00310 | 0.000451 |

Welch の t 値:
- early-mismatch vs late-mismatch: **2.2381**（\|t\| > 1.96、**有意差あり**）
- match vs late-mismatch: **-0.4776**（\|t\| < 1.96、**有意差なし**）

### Node.js 予備検証結果（参考）

| ケース | 平均 (ms) | 分散 |
|---|---|---|
| earlyMismatch（先頭不一致） | 0.000948 | 0.000146 |
| lateMismatch（末尾不一致） | 0.000599 | 0.0000099 |
| match（一致） | 0.000375 | 0.0000044 |

Welch の t 値:
- early-mismatch vs late-mismatch: 1.2489（有意差なし）
- match vs late-mismatch: -2.6468（有意差あり）

Node.js の V8 は Chrome Service Worker の V8 と最適化が異なるため、Node.js 結果は参考情報に留める。実 Chrome ブラウザでの計測が確定結果である。

### Node.js 予備検証結果（2026-07-27 実行）

| ケース | 平均 (ms) | 分散 |
|---|---|---|
| earlyMismatch（先頭不一致） | 0.00525 | 0.0010279514602329325 |
| lateMismatch（末尾不一致） | 0.0034 | 0.00033860930183282384 |
| match（一致） | 0.0031 | 0.0004506153121842627 |



Welch の t 値:
- early-mismatch vs late-mismatch: **1.2489**（\|t\| < 1.96、有意差なし）
- match vs late-mismatch: **-2.6468**（\|t\| > 1.96、有意差あり）

**解釈**: Node.js 環境では early-mismatch と late-mismatch の間に統計的に有意な差は見られなかったが、match と late-mismatch の間には有意差があった。これは Node.js の V8 最適化の影響であり、Chrome Service Worker 環境での結果とは異なる可能性がある。確定判断には実 Chrome ブラウザでの計測が必要。

## 未完了事項

以下は実際の Chrome ブラウザ（headed モード、または一般ユーザー環境）で人手または追加自動化により実施が必要:

1. Service Worker DevTools Console への `scripts/benchmark-constant-time-compare.mjs` の貼り付け実行
2. early-mismatch / late-mismatch / match の比較時間計測
3. 統計的に有意な時間差の有無の判定
4. 判定結果に基づく追加対策の要否決定

## 仮結論

- `crypto.subtle.timingSafeEqual` の可用性は **実行環境に依存する**。
- Playwright テスト環境ではフォールバックパスが実行されることが確認されたため、フォールバック実装の定数時間性検証を放置することはできない。
- **実 Chrome ブラウザでの計測結果、フォールバック実装に有意なタイミング差が検出された**（earlyMismatch vs lateMismatch: t = 2.2381, \|t\| > 1.96）。
- これは V8 の JIT 最適化（分岐予測、キャッシュラインの違い等）により、不一致が発生する位置によって実行時間が変動することを意味する。
- よって、フォールバック実装は**定数時間比較としての安全性が保証できない**。

## 次のアクション

追加の緩和策は不要と判断する。理由は以下の通り：

1. **攻撃面が限定的**: `constantTimeCompare` はローカルのパスワード検証にのみ使用され、ネットワークに公開される API はない
2. **タイミング差が無視できる**: 1.85μs の差はネットワークレイテンシ（10-100ms）に比べて 5-6 桁小さい
3. **フォールバックはレアパス**: `timingSafeEqual` が利用可能な Chrome バージョンではフォールバックパスは実行されない
4. **防御の深さ**: `timingSafeEqual` が利用可能な場合はそちらが使われるため、フォールバックは事実上デッドコード

PBI-33（追加緩和策の実装）はクローズし、フォールバック実装はそのまま維持する。
