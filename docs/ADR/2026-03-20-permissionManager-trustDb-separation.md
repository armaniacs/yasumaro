# PermissionManagerとTrustDbの境界明確化

## Context

PermissionManagerとTrustDbが似た機能（ドメインの許可/拒否管理）を持ち、責務が重複しています。

**PermissionManager:**
- Chrome Permissions API による host_permissions 取得/拒否
- ユーザー拒否ドメインの記録（`deniedDomains`）
- Top 1000 プリセットドメイン（manifest.host_permissions）

**TrustDb:**
- Tranco リストによるドメイン信頼度評価
- Finance/Sensitive/Unverifiedの3段階分類
- カスタム信頼ドメイン管理（ホワイトリスト/ブラックリスト）

**問題点:**
1. 責務重複: どちらもドメイン許可/拒否を管理
2. 違合リスク: PermissionManagerが拒否しているドメインをTrustDbが許可する可能性
3. 開発者混乱: 新規開発者がどちらを使用すべきか分からない

## Decision

### 責務分離の設計

**PermissionManager（Chrome Permissions層）:**
- 範囲: manifest.host_permissionsの実行時チェック
- 機能:
  - Chrome Permissions APIのラップ（isHostPermitted, requestPermission）
  - ユーザー拒否ドメインの記録（deniedDomains）
  - プリセットドメインの許可判定
- データソース: manifest.json + chrome.storage.local.deniedDomains

**TrustDb（ドメイン信頼度層）:**
- 範囲: ドメイン信頼度評価と警告判定
- 機能:
  - Trancoランクに基づく信頼度評価
  - Finance/Sensitive/Unverified分類
  - カスタムブラックリスト/ホワイトリスト
- データソース: Trancoリスト + ユーザー定義リスト

**統合順序（recordingLogic.ts）:**
1. PermissionManager.isHostPermitted() - Chrome Permissionsレベルチェック
2. TrustChecker.checkDomain() - 信頼度レベルチェック（警告のみ、ブロックしない）

## Consequences

### Positive

- 責務明確: 各モジュールの担当範囲が定義
- 開発者容易: 新規開発者が使用モジュールを判断可能
- ADR記録: 設計判断が明文化

### Negative

- 既存コードの理解コスト: 違合リスクがあることを知る必要
- 文書化負担: ADRの更新が必要

### Mitigation

- ADRを参照リンクによりドキュメント化
- コメントでどちらを使用すべきか明記

## Implementation Steps

- [x] ADR作成
- [ ] TDD Red: 境界違合を検証するテスト作成
- [ ] ADRに詳細設計追記
- [ ] ドキュメント更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: ADRによる責務分離文書化
- **Superseded By**: -

---

## 設計詳細

### 使用ガイドライン

| シナリオ | 使用モジュール | 理由 |
|---------|--------------|------|
| Chrome Permissions API呼び出し | PermissionManager | 機能の直接ラップ |
| ユーザー拒否ドメイン管理 | PermissionManager | deniedDomains管理 |
| manifest.domainチェック | PermissionManager | host_permissionsレベル |
| Trancoランク確認 | TrustDb | 信頼度評価専用 |
| Finance/Sensitiveサイト警告 | TrustChecker | 通知・警告レベル |
| カスタム信頼リスト管理 | TrustDb | カテゴリ管理 |

### 統合ポイント

recordingLogic.ts内で以下の順序で使用すること：
```typescript
// 1. Chrome Permissions レベル
const permitted = await permissionManager.isHostPermitted(url);
if (!permitted) {
  return { success: false, error: 'PERMISSION_REQUIRED' };
}

// 2. 信頼度レベル（警告のみ）
const trustCheck = await trustChecker.checkDomain(url);
// trustCheck.canProceedは常にtrue（警告は通知のみ）
if (trustCheck.showAlert) {
  NotificationHelper.showNotification(...);
}
```