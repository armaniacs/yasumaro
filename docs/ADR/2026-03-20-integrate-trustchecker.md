# TrustCheckerをrecordingLogicに統合

## Context

TrustChecker・TrustDbは実装されていますが、recordingLogic.tsへの統合が不完全です。信頼されていないドメインでの警告機能が期待通りに動作していません。

**現状:**
- `recordingLogic.ts`:
  - `getPermissionManager()`を使用し、拒否ドメインで記録を中止する実装を持つ
  - TrustCheckerはインポートされているが使用されていない

- `TrustChecker` (`src/utils/trustChecker.ts`):
  - `checkDomain(url)`メソッドがドメインの信頼度を判定
  - `TrustCheckResult`:
    - `canProceed`: 記録続行可否
    - `trustResult`: Trust判定結果
    - `showAlert`: 警告表示フラグ
    - `reason`: 中了理由（��話Hash）

**問題点:**
- TrustCheckerが提供する3段階チェック（Finance/Sensitive/Unverified警告）がrecordingLogicで使用されていない
- ユーザー設定による警告抑制（`alertFinance`, `alertSensitive`, `alertUnverified`）が無効
- `saveAbortedPages`設定（警告で中断したページを履歴に残す）が動作しない
- Trancoリストに基づく未検証サイト検出がrecordingLogicに組み込まれていない

## Decision

### 統合設計

recordingLogic.tsのドメインチェックロジックにTrustChecker.checkDomain()を統合します。

**統合ポイント:**
1. 記録開始前のドメインチェック（権限チェックと併置）
2. Trust結果に基づく記録続行判定
3. 警告表示・通知機能
4. `saveAbortedPages`による中断ページの履歴記録

**実装方針:**
```typescript
// recordingLogic.ts での統合例
const trustChecker = new TrustChecker();
const checkResult = await trustChecker.checkDomain(url);

if (!checkResult.canProceed) {
  // 記録阻止
  NotificationHelper.showNotification('Record blocked', checkResult.reason);
  if (checkResult.trustResult.config.saveAbortedPages) {
    // 履歴に中断記録を残す
    await saveAbortedPage(url, checkResult.trustResult);
  }
  return { blocked: true };
}
```

## Consequences

### Positive

- 信頼ドメインに基づく3段階警告機能が有効化
- ユーザー設定による警告抑制が正常動作
- `saveAbortedPages`設定で中断ページの履歴保存が可能
- 未検証サイト（Trancoランク外）の検出・警告

### Negative

- 非同期処理追加（TrustChecker初期化待機）による若干の遅延
- 新しい依存関係の追加（TrustChecker）

### Mitigation

- 非同期処理は初期化時のみ（`ensureInitialized`）
- 既存のPermissionManager使用と共存

## Implementation Steps

- [x] ADR作成
- [x] TDD Red: TrustChecker統合テスト作成
- [x] TDD Green: recordingLogicにTrustChecker.checkDomain()統合
- [x] TDD Refactor: テストコード整理
- [x] 通知・警告表示の追加（NotificationHelper.notifyError使用）
- [ ] `saveAbortedPages`処理の実装（次フェーズ）
- [x] 統合テスト実行・検証（1747件パス、Regressionなし）
- [ ] ドキュメント更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: -
- **Superseded By**: -