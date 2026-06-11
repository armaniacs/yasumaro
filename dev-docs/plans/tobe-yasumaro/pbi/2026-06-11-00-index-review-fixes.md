# PBI インデックス — Checking Team Review 2026-06-11

**作成日**: 2026-06-11  
**元レビュー**: `plans/2026-06-11-0432-review-tobe-yasumaro.md`  
**対象**: 24件の指摘（HIGH 6件 + MEDIUM 10件 + LOW 8件）

---

## PBI一覧（優先度順）

### 🔴 CRITICAL / HIGH 優先

| # | PBI | ポイント | 対象指摘 |
|---|-----|---------|---------|
| 01 | [SQLite データ整合性強化](2026-06-11-01-fix-sqlite-data-integrity.md) | 8pt | Migration競合、UNIQUE制約、CHECK制約、バルクINSERT、入力検証 |
| 02 | [GDPR 完全準拠](2026-06-11-02-fix-gdpr-compliance.md) | 5pt | 物理DELETE、PRIVACY.md更新、同意ダークパターン修正 |
| 03 | [ドキュメント刷新 & i18n](2026-06-11-03-fix-documentation-i18n.md) | 5pt | README/AGENTS/CONTRIBUTING更新、ビルドパス、i18n完全対応 |

### 🟡 MEDIUM 優先

| # | PBI | ポイント | 対象指摘 |
|---|-----|---------|---------|
| 04 | [Service Worker モジュラー化](2026-06-11-04-fix-service-worker-modularization.md) | 8pt | 3モジュール分割（urlNotificationHandlers, rateLimiter, manualContentFetcher） |
| 05 | [SqliteClient DRY 違反解消](2026-06-11-05-fix-sqlite-client-dry.md) | 3pt | call<T>()ヘルパー導入、11メソッドのボイラープレート削除 |
| 06 | [モバイル OPFS フォールバック](2026-06-11-06-fix-mobile-opfs-fallback.md) | 8pt | OPFSチェック、chrome.storage.localフォールバック |
| 07 | [AI プロバイダー最適化 & サプライチェーン](2026-06-11-07-fix-ai-provider-supply-chain.md) | 5pt | リトライ制限、ライセンス記録、favicon権限、多言語プロンプト |

---

## 合計見積もり

**42 ポイント**（7 PBI）

---

## 実装順序の推奨

1. **PBI-01** (SQLite整合性) → データ層の基盤強化
2. **PBI-02** (GDPR) → PBI-01のCHECK制約を活用
3. **PBI-05** (SqliteClient DRY) → PBI-01で変更したsqlite.tsと統合
4. **PBI-03** (ドキュメント) → 機能変更の文書化
5. **PBI-04** (Service Worker分割) → 大規模リファクタリング
6. **PBI-06** (モバイルOPFS) → 新機能追加
7. **PBI-07** (AI/サプライチェーン) → 最適化・健全化

---

## 並列実施可能なグループ

- **グループA**: PBI-01, PBI-03, PBI-07（独立した変更）
- **グループB**: PBI-02, PBI-05（データ層関連）
- **グループC**: PBI-04, PBI-06（アーキテクチャ変更）

---

## 完了基準

- [ ] 全7 PBIが完了
- [ ] 全テストがパス
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] 総合スコアが85以上（ランクA）
