# 2026-09-23 arch-delivery-loop 第2ラウンド台帳（archloop-0923b）

Phase 0 診断（サブエージェント探索 + HTML レポート: `$TMPDIR/architecture-review-20260923-0710.html`）→ Phase 1 RICE スコアリングの記録。第1ラウンド（archloop-0923）の 01-05・VulnHunt 修正・ADR 保護項目・live 台帳候補は除外済み。実装対象は順位 6〜10（RICE 降順、依存なし・直列で消化）。CleansingRuleView・KeyDerivation は live 台帳へ。

PBI 番号は本日の通し連番（第1ラウンド 01-05 の続き、0918b ラウンドの 26-30 継承の前例に準拠）。

## RICE スコア表

| 順位 | PBI | Reach | Impact | Confidence | Effort(人週) | RICE | 判定 |
|------|-----|-------|--------|-----------|--------------|------|------|
| 6 | 06 isRecordable shim 削除 | 3 | 0.5 | 100% | 0.1 | 15.0 | 実装 |
| 7 | 07 SavePhase Module | 6 | 2 | 80% | 0.75 | 12.8 | 実装 |
| 8 | 08 VisitGating Module | 5 | 2 | 80% | 0.75 | 10.7 | 実装 |
| 9 | 09 ExtractionReport Module | 5 | 2 | 80% | 1.0 | 8.0 | 実装 |
| 10 | 10 TrustLookup Module | 6 | 2 | 50% | 1.0 | 6.0 | 実装 |
| — | CleansingRuleView（view 3 重列挙） | 6 | 1 | 80% | 1.0 | 4.8 | live 台帳 |
| — | KeyDerivation（KDF 知識 3 箇所＋cache 3 系統） | 5 | 1 | 50% | 1.0 | 2.5 | live 台帳 |

06 の高スコアは Effort 0.1 のマイクロタスク効果であり、ラウンド冒頭で片付けるクイックウィンとして正当。

## 依存グラフ

```
06 ──┐
07 ──┤ すべて独立（並行可・実装は RICE 降順の直列）
08 ──┤ 07→08→09 は録画 path の上流順だがハード依存なし
09 ──┤
10 ──┘
```

## 5 Whys サマリー

- **06**: なぜ shim が残るのか → 移行完了の確認が PBI 化されず「いつか消す」が所有者不在になった → 解: 生産 importer 0 を grep で再確認して即削除（0.1 週）。
- **07**: なぜ保存 tail が二重登録なのか → retry 部分集合が「配列の複製」として育ち、投影という概念が不在だった → 解: `savePhase.retryProjection()` の所有化。
- **08**: なぜ gate 構築が 3 箇所なのか → 閾値 cache の所有者が未定義で、timer・kernel・extractor が各々善意で構築した → 解: `evaluate(state, now)` の寿命一元化。
- **09**: なぜ 18 field を全消費者が知るのか → 「診断の見え方」の所有が extractor closure にあり、report という Module が不在だった → 解: `extract(config) → { content, report }`。
- **10**: なぜ 2 経路が乖離しうるのか → display 用の近道（admin+policy 直呼び）が判定経路と別に育ち、単一 lookup が不在だった → 解: `lookup(url)` 単一 async interface。

## 実装記録（Phase 2 完了後）

Phase 2 の実行順: 06 → 07 → 08 → 09 → 10（RICE 降順・依存なし）。結果は各 PBI の実装記録節および `pbi/00-INDEX.md` のアーカイブ履歴に記載する。
