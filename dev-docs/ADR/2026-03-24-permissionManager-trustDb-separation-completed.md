# PermissionManager と TrustDb の責務分離（完了済み）

## Context

ADR `2026-03-20-permissionManager-trustDb-separation.md` で既に実施済み。

**レビュー指摘:**
- **指摘者**: Domain Logic Expert
- **場所**: `src/utils/permissionManager.ts`, `src/utils/trustDb/trustDb.ts`
- **優先度**: Medium
- **影響**: 両クラスが似た機能（ドメインの許可/拒否管理）を持ち、責務が重複している。

## Decision

### 実装方針

既にADR `2026-03-20-permissionManager-trustDb-separation.md` で実施済み。

**責務分離:**
- **PermissionManager**: Chrome Permissions API ラッパー、ドメイン拒否管理
- **TrustDb**: Tranco ベースの信頼度評価、記録器専用の許可・拒否判断

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: Complete (ADR exists)
- **Superseded By** -
- **Note**: このADRは既に存在しており、実装済み。重複して作成しない。
