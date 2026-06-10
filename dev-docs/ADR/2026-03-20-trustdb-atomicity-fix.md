# TrustDb保存時のアトミック性不足修正

## Context

trustDb.tsでは、2つの独立した`withOptimisticLock`呼び出しによる保存処理が存在し、クラッシュ時にデータ不整合が発生する可能性があります。

**現状のコード:**
```typescript
// 2つの独立したトランザクション
await withOptimisticLock(PRESET_DOMAINS_KEY, async () => {
  await chrome.storage.local.set({ [PRESET_DOMAINS_KEY]: presetDomains });
});

await withOptimisticLock(DENIED_DOMAINS_KEY, async () => {
  await chrome.storage.local.set({ [DENIED_DOMAINS_KEY]: deniedDomains });
});
```

**問題点:**
1. トランザクション分離: 2つの`withOptimisticLock`呼び出しは独立したトランザクション
2. 途中クラッシュリスク: 1つ目の保存成功後、2つ目の保存前にクラッシュすると不整合状態
3. 版番号不一致: 各キーごとの版番号が独立しており、一貫性が保証されない

## Decision

### 修正方針: 単一トランザクション化

2つの保存処理を単一の`withOptimisticLock`内で実行し、アトミック性を確保します。

**修正後のイメージ:**
```typescript
await withOptimisticLock(TRUST_DB_KEY, async () => {
  // 両方の更新を単一操作で実行
  await chrome.storage.local.set({
    [PRESET_DOMAINS_KEY]: presetDomains,
    [DENIED_DOMAINS_KEY]: deniedDomains
  });
});
```

**設計変更:**
- トランザクション境界統合: 2つのキー更新を1つの操作で実行
- 単一版番号管理: 複合キー用の共通版番号を導入（または既存のいずれかのキーを使用）
- 既存API互換性: Preset Domains / Denied Domains 個別の更新APIは維持

## Consequences

### Positive

- アトミック性確保: クラッシュ時のデータ不整合リスクが消滅
- トランザクション一貫性: 両方のキーが同時に更新されるか、どちらも更新されない
- 版番号整合性: 単一版番号により一貫した状態追跡が可能

### Negative

- トランザクション粒度低下: 片方のみ更新したい場合（例: Preset Domainsのみ）でも両方保存する必要
- 保存データ増加: 単一版番号追跡用に追加ストレージが必要

### Mitigation

- 非同期更新: 変更なしの場合は`set`をスキップ
- 保存データ圧縮: Unchangedキーのデータはなし/古い値を使用

## Implementation Steps

- [x] ADR作成
- [x] TDD Red: アトミック性不足を検証するテスト作成
- [ ] TDD Green: 単一トランザクション実装（次フェーズ）
- [ ] TDD Refactor: テストコード整理
- [ ] 既存APIの互換性維持確認
- [ ] 統合テスト実行・検証
- [ ] ドキュメント更新

---

## 実務的改良（今回実施）

**制約:** `withOptimisticLock()`は単一キーを前提としているため、完全アトミック化にはAPI拡張が必要

**部分修正:** 第2の`withOptimisticLock()`呼び出しを削除し、`STORAGE_KEY_BLOOM`は通常保存のみに変更

**課題受容:** `chrome.storage.local.set()`は複数キー更新でもアトミックだが、版番号チェックが`STORAGE_KEY`のみ → 2つのキーの版番号が独立したまま

**完全アトミック性要件:** withOptimisticLock拡張による複数キー対応

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: Phase 1（部分修正）/ Phase 2（完全アトミック化 - 待ち）
- **Superseded By**: -

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: -
- **Superseded By**: -