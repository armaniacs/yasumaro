# 2026-09-23 arch-delivery-loop 第3ラウンド台帳（archloop-0923c）

Phase 0 診断（サブエージェント探索 + HTML レポート: `$TMPDIR/architecture-review-20260923-0907.html`）→ Phase 1 RICE スコアリングの記録。前 2 ラウンド（01-10）・VulnHunt 修正・ADR 保護項目・live 台帳候補は除外済み。実装対象は順位 11〜15（RICE 降順、依存なし・直列で消化）。Retry-policy は live 台帳へ。

PBI 番号は本日の通し連番（01-10 の続き）。

## RICE スコア表

| 順位 | PBI | Reach | Impact | Confidence | Effort(人週) | RICE | 判定 |
|------|-----|-------|--------|-----------|--------------|------|------|
| 11 | 11 HMAC twins 削除 | 5 | 0.5 | 100% | 0.1 | 25.0 | 実装 |
| 12 | 12 ByteStats 転送 Adapter | 5 | 2 | 80% | 0.5 | 16.0 | 実装 |
| 13 | 13 maintain 系 wire-table 化 | 4 | 2 | 80% | 0.5 | 12.8 | 実装 |
| 14 | 14 popup tab 読取一元化 | 4 | 1 | 80% | 0.5 | 6.4 | 実装 |
| 15 | 15 preset repository 移行 | 4 | 2 | 50% | 1.0 | 4.0 | 実装 |
| — | Retry-policy Module（7 経路統一） | 8 | 1 | 50% | 1.5 | 2.7 | live 台帳 |

11 の高スコアは Effort 0.1 のマイクロタスク効果であり、ラウンド冒頭で片付けるクイックウィンとして正当。

## 依存グラフ

```
11 ──┐
12 ──┤ すべて独立（並行可・実装は RICE 降順の直列）
13 ──┤ 12→13 は録画→通信の順だがハード依存なし
14 ──┤
15 ──┘
```

## 5 Whys サマリー

- **11**: なぜ sunset 待ちの双子が残るのか → 「いつか消す」が PBI 化されず所有者不在になった → 解: 生産 importer 0 を grep で再確認して即削除。
- **12**: なぜ 4 handler が手列挙するのか → builder が interface を持つ一方「転送」の所有が未定義で、各面が善意で列挙した → 解: `pickRecordDiagnostics(payload)` の所有化。
- **13**: なぜ maintain 7 分岐だけ手配線なのか → query/mutate/archive の行化ラウンドで maintain 系まで手が届かなかった → 解: 既存表への maintain 系追加（定義箇所の移動のみ）。
- **14**: なぜ 3 綴りが同居するのか → Seam 存在後に追加された箇所が素クエリのまま残り、唯一経路化が未完だった → 解: tabUtils への狭い Adapter 追加＋全箇所の寄せ。
- **15**: なぜ preset だけ素 storage なのか → トップレベル key 配置の歴史的経緯で Seam 移行が後回しになり、guard が race を補償する構造になった → 解: repository 背後化（Depth は保持）。

## 実装記録（Phase 2 完了後）

Phase 2 の実行順: 11 → 12 → 13 → 14 → 15（RICE 降順・依存なし）。結果は各 PBI の実装記録節および `pbi/00-INDEX.md` のアーカイブ履歴に記載する。
