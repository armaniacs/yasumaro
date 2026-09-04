# Backlog — Branch `0902a` Review Findings（2026-09-04、重複・dead-code 7件）

`0902a` ブランチレビュー（`origin/main` 差分 11870行/211ファイル、6トラック並列）で検出された high-confidence findings 7件を 3 PBI に束ね、RICE 降順で着手順を決める。security / business logic / deploy safety / performance は NO_FINDINGS のため PBI 化しない。

> **Note:** タブバッジの per-event storage I/O 指摘は `SettingsRepository` の 1秒 cache で緩和済みかつバッジ更新が非同期 fire-and-forget のため、単独 PBI 化を見送る（RICE ~0.8）。やるなら将来のキャッシュ統合リファクタのついでに検討する。

## 優先度一覧（RICE 降順）

| Rank | PBI | RICEスコア | 内訳 | 根拠 / 依存 |
|------|-----|-----------|------|-------------|
| 1 | [01 fix-api-key-list-ssot](2026-09-04-01-fix-api-key-list-ssot.md) | **60** | R4×I3×C1.0 / E0.2 | 秘匿キー一覧の二重管理は片方の更新漏れで平文残留・漏洩に直結。工数最小で Impact 最大。依存なし |
| 2 | [02 fix-domain-filter-duplication](2026-09-04-02-fix-domain-filter-duplication.md) | **2.4** | R1×I1×C0.95 / E0.4 | 即時障害ではないが次回 blacklist・mode 変更時の回帰を block。mock 移行が前提。依存なし（01 と並行可） |
| 3 | [03 cleanup-review-dead-exports](2026-09-04-03-cleanup-review-dead-exports.md) | **~5（chore）** | R1×I1×C1.0 / E0.2 | ランタイム影響ゼロの負債返済。機械的削除でリスク低。依存なし（01・02 と並行可） |

**RICE定義:** `Score = (Reach × Impact × Confidence) / Effort`。Reach は影響トランザクション・モジュール数、Impact は 3=圧倒的 / 2=大きい / 1=中、Confidence は 0.5〜1、Effort は人週。03 はユーザー価値なしの chore のため参考値。

## なぜなぜ分析サマリ（レビュー findings 由来）

| PBI | 原因 → 示唆 → 解 |
|-----|------------------|
| 01 api-key-list | 新プロバイダー追加時に `types.ts`＋新旧2リストの4箇所更新が必要 → 片方漏れがサイレント漏洩 → 秘匿キー一覧を SSOT に一本化し drift 検出テストを追加（hoisting 回避は維持） |
| 02 domain-filter | キャッシュ判定2コピー＋保存時検証2エンジンが並存 → 片方の修正が他方に伝播しない → 判定分岐を共有ヘルパーに抽出し検証を `DomainFilter` に統合（`isValidDomain` 移植＋mock 移行） |
| 03 dead-exports | stage-branding 残骸・DI 未使用 singleton・未配線 decorator が export のまま残留 → 読み手が live と誤解 → live の関数・class 以外を削除し doc を同期 |

## 依存グラフ

```
01 api-key-list ─── 独立（storagePort / settingsMigration、他 PBI と並行可）

02 domain-filter ── 独立（DomainFilter / dashboard save、他 PBI と並行可）

03 dead-exports ─── 独立（削除のみ、他 PBI と並行可）
```

全3件は相互に独立。依存はスコアより優先するが本バックログでは依存なしのため RICE 降順がそのまま着手順になる。

## 推奨着手順

1. **01 api-key-list SSOT** — 最小 Effort で最大 Impact。セキュリティ境界のドリフトを即座に塞ぐ
2. **02 domain-filter duplication** — 次回 mode 変更時の回帰防止。mock 移行が鍵
3. **03 dead-exports** — dev のみでユーザー影響なしのため最後にまとめてもよいが、01・02 と並行着手可

> 01〜03 はいずれも独立のため、レビュアー帯域があれば並行着手も可能。
