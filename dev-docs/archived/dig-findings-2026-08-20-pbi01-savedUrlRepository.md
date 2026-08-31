# Deep Dig Findings — PBI #01 SavedUrlRepository

**Date:** 2026-08-20
**Scope:** SavedUrlRepository への統合 — Legacy Dual-Write メタデータ蓄積の崩壊

---

## 挑戦した仮定

| # | 仮定 | リスク | 発見 | 決定 |
|---|------|--------|------|------|
| A | 30行のプロパティ列挙を削除できる | 高 | setSavedUrlsWithTimestamps() と updateUrlTimestamp() の2箇所に存在。エントリが単一配列で格納されているため更新時に全フィールドを手動保持する必要がある | spread + Object.entries ループに置換。エントリを不透明に |
| B | RecordingContextFieldMapper が不要になる | 中 | saveMetadataStep と BrowsingLogRecordMapper の2箇所が使用。削除すると41フィールドの抽出ロジックが重複 | PBIに反するが残置。DRY原則が優先。型安全性の改善のみ |
| C | savedUrls ミラーキーは不要になる | 低 | isUrlSaved(), getSavedUrlCount() が O(1) で使用。削除すると O(n) スキャンに | ミラーを維持 |
| D | re-export barrel を削除できる | 高 | storage.ts / storageUrls.ts が 17+ ファイルから import されている。削除は破壊的変更 | barrel は維持。repository からの再エクスポートに変更 |
| E | retryQueue 統合は変更不要 | 中 | pendingChromeStorageQueue が SavedUrlEntryMetadataPatch 形式に依存 | パッチ形式は維持。repository が同じ形式を出力 |

---

## 新たに発見したリスク

- **既存テストのモック破壊**: 11のテストファイルがsavedUrlStore.jsを直接モック。repository移行後にモック対象が変わる
- **purgeLegacyStorage() の white-list パターン**: 「全フィールド保持」ではなく「特定フィールドのみ保持」。property enumeration 削減とは異なるロジックのため、repository 内に分離して維持

---

## 決定事項

1. repository は **functional module**（recordsRepo.ts パターンに合わせる）
2. storage 形式は **変更なし**（単一配列の維持、移行不要）
3. property enumeration は **spread + loop** で置換
4. RecordingContextFieldMapper は **残置**（PBI の受け入れ基準を変更）
5. re-export barrel は **維持**（段階的移行）

---

## 未解決の疑問

- なし
