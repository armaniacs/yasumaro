# バックログ台帳: arch-delivery-loop 0918（archloop-0918）

2026-09-18 の arch-delivery-loop 実行。Phase 0（HTML レポート: `$TMPDIR/architecture-review-20260918-1309.html`）で抽出した3候補を RICE 採点し、Phase 2 で自律実装する。直近40コミットのホットスポット（messaging / offscreen / dashboard panels / alarm / storage）から、直近ラウンド（holistic-0918・0918b・0918c 05-16）で触っていない領域に絞った。

## 採点基準

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 影響するコールサイト/トランザクション数（相対 1-10）
Impact: 3=圧倒的 / 2=大 / 1=中 / 0.5=小 / 0.25=極小
Confidence: 100% / 80% / 50%
Effort: ストーリーポイント
```

## RICE スコア表

| スコア順 | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | allowedUrls デッドコピー削除 | 4 | 2 | 1.0 | 0.5 | 16.0 | → PBI 17 |
| 2 | getMsgWithCache if-chain 解消 | 3 | 1 | 1.0 | 0.5 | 6.0 | → PBI 18 |
| 3 | logger barrel 移行完了（Wave 4） | 8 | 1 | 1.0 | 2.5 | 3.2 | → PBI 19 |

## 実行順

```
17（allowedUrls 削除）→ 18（getMsgWithCache）→ 19（barrel 移行）
```

純 RICE 降順からの逸脱なし。3件ともファイル非重複・解の前提関係なし → 1バッチで並列可（実装は直列で進める）。

## 依存マップ・バッチ計画

- 17: 対象 `src/utils/allowedUrls.ts`（削除）+ `src/utils/storageUrls.ts`（4再export除去）。依存なし
- 18: 対象 `src/popup/errorUtils.ts`（getMsgWithCache 本体のみ）。依存なし。17・19 とファイル非重複
- 19: 対象 94 production + 39 test import 元ファイル、storage 系 dynamic import 3箇所、`src/utils/logger.ts`（削除）、`eslint.config.js`（barrel 特例・warn ルール除去）。依存なし。17・18 とファイル非重複

## 台帳送り

なし（Phase 0 で4件目として挙げた console → logger 統一は holistic-0918c 台帳に台帳送り済みのため本ラウンドの対象外）。

## 5 Whys サマリー

- 17: なぜ分身が残るか → urlWhitelist 側の SSOT 化（2026-09-11-05）で FILTER_LIST_SOURCES への置換が新コピーのみに適用され、旧コピー（allowedUrls.ts）が生き残った。なぜ生き残るか → storageUrls barrel の再export が削除対象に見えないから。→ 解: barrel の4再export ごと削除
- 18: なぜ if-chain か → MessagesCache 型を key ごとに絞る手書き type guard の代替として if が並べられた。→ 解: `key in cache` ルックアップ1本に置換
- 19: なぜ残作業か → Wave 4（2026-09-05-03）が配線と lint 反転までを範囲にし、呼び出し側133箇所の移行を別 PBI 化して終わった。→ 解: 機械移行 → barrel 削除 → eslint 特例除去まで閉じる
