# Backlog: アーキテクチャ Deepening PBI 一覧 (2026-08-23)

アーキテクチャレビューで発見した7つのDeepening候補をRICEで採点し、着手順を決定。

---

## RICEスコアリング

| # | 候補 | Reach | Impact | Confidence | Effort (pw) | RICE | 依存 |
|---|------|-------|--------|------------|-------------|------|------|
| 1 | Protocol version 単一ソース化 | 3 | 2 | 100% | 0.1 | **600** | なし |
| 2 | piiStripper pass-through 削除 | 4 | 1 | 100% | 0.1 | **400** | なし |
| 3 | SettingsRepository instanceof 統合 | 30 | 3 | 80% | 1.5 | **480** | #4 (キャッシュ統合) |
| 4 | Storage 3重キャッシュ統合 | 30 | 2 | 80% | 2.0 | **240** | なし |
| 5 | extractor.ts God Module 分割 | 5 | 3 | 80% | 2.0 | **60** | #1 (loader.ts) |
| 6 | メッセージ検証二層統合 | 19 | 2 | 80% | 2.0 | **152** | #1 |
| 7 | createBackgroundServices DI化 | 17 | 1 | 50% | 2.5 | **34** | #3, #4 |

**Reach**: 影響するコールサイト/モジュール数
**Impact**: 3=開発速度に圧倒的影響 / 2=大きな改善 / 1=中程度の改善
**Confidence**: 推定への確信度
**Effort**: 人週 (person-weeks)

---

## 最終順位（依存関係適用後）

| 順位 | PBI | RICE | 根拠 |
|------|-----|------|------|
| 1 | Protocol version 単一ソース化 | 600 | 最小工数・依存なし・即座にバグ防止効果 |
| 2 | piiStripper pass-through 削除 | 400 | 最小工数・PII漏洩リスク削減 |
| 3 | Storage 3重キャッシュ統合 | 240 | SettingsRepository (#3) の前提。キャッシュ一元化で次ステップが容易 |
| 4 | SettingsRepository instanceof 統合 | 480 | 30+コールサイトに影響。#4完了後に着手で効率的 |
| 5 | メッセージ検証二層統合 | 152 | セキュリティ改善。#1完了後に loader.ts 共有が可能 |
| 6 | extractor.ts God Module 分割 | 60 | 最大工数。テストカバレッジ改善のため #1後に loader 連携 |
| 7 | createBackgroundServices DI化 | 34 | 最後に。#3, #4 完了後に DI の恩恵が最大化 |

---

## 依存関係図

```
#1 Protocol version ──→ #5 extractor split (loader.ts 連携)
                    ──→ #6 Message validation (loader.ts 共有)

#4 Storage cache ──→ #3 SettingsRepository (キャッシュ前提)

#3 SettingsRepository ──→ #7 DI container (アダプタ前提)
#4 Storage cache ──→ #7 DI container (キャッシュ一元化前提)
```

---

## ファイル一覧

| 順位 | ファイル | 種別 |
|------|---------|------|
| 1 | `2026-08-23-01-fix-protocol-version-single-source.md` | fix |
| 2 | `2026-08-23-02-fix-pii-stripper-boundary.md` | fix |
| 3 | `2026-08-23-03-refactor-storage-triple-cache-unify.md` | refactor |
| 4 | `2026-08-23-04-refactor-settings-repository-polymorphic.md` | refactor |
| 5 | `2026-08-23-05-refactor-message-validation-collapse.md` | refactor |
| 6 | `2026-08-23-06-refactor-extractor-god-module-split.md` | refactor |
| 7 | `2026-08-23-07-refactor-create-background-services-di.md` | refactor |
