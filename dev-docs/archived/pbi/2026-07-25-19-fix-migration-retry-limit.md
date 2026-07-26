# PBI: マイグレーション失敗時の無限リトライに上限を設ける

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存の「次回起動時に無条件で再試行」という仕様を変更するため、リトライ上限到達時の挙動を新たに定義する必要がある）

## 実装メモ（2026-07-26）

コア機能（リトライ上限、`failed_permanently` 状態、成功時のリセット）を実装・テスト済み。
`src/background/migrationService.ts` に `MAX_MIGRATION_RETRY_COUNT = 5` を追加し、`recordFailureAndMaybeGiveUp()` で管理。
`src/background/__tests__/migrationService-extra.test.ts` に4件のテストケースを追加（全58件パス）。

**未実装（フォローアップとして別PBI化を推奨）**: 診断パネル（dashboard）への `failed_permanently` 状態の表示。
現状はログ（`addLog(LogType.ERROR, 'Migration: retry limit reached, giving up', ...)`）にのみ記録される。
表示するには `dashboardSqliteService.ts` の `getSqliteStatus()` 相当の仕組みで Service Worker 側のマイグレーション状態を
dashboard に伝える経路が必要（現状はSQLite自体のステータスのみを扱っており、レガシーマイグレーション状態は含まれない）。

---

## 背景

Checking Team レビュー（2026-07-25）の Legacy Bridge Architect からの指摘。`src/background/migrationService.ts:152, 172, 175, 194` では、バッチ挿入失敗時に `hasErrors = true` とし、マイグレーション完了フラグを立てずに次回起動時の再試行に委ねる設計になっている。**リトライ回数の上限やバックオフ制御が実装されておらず**、恒久的に失敗し続けるデータがあった場合、拡張機能の起動のたびに同じ失敗を繰り返す（無限リトライ）。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "will retry\|hasErrors\|MigrationStatus" src/background/migrationService.ts
```

`setMigrationStatus`, `getMigrationStatus` の型定義（`MigrationStatus`）を確認し、`'completed'` 以外にどんな状態値が定義されているか把握する。リトライ回数を記録する新しいストレージキーが必要になる。

## 受け入れ基準（BDD）

```gherkin
Scenario: リトライ回数が上限に達するまでは再試行を続ける
  Given マイグレーションが3回連続で失敗している
  When 拡張機能が再起動する
  Then 4回目のマイグレーション試行が実行される

Scenario: リトライ上限に達すると再試行を停止する
  Given マイグレーションがMAX_RETRY_COUNT（例: 5回）連続で失敗している
  When 拡張機能が再起動する
  Then マイグレーションは実行されず、ステータスが 'failed_permanently' 等に設定される
  And ユーザーに診断パネル等で失敗が通知される

Scenario: 成功時はリトライカウントがリセットされる
  Given リトライカウントが2回目である状態
  When マイグレーションが成功する
  Then リトライカウントがクリアされ、ステータスが 'completed' になる
```

## 受け入れ基準
- [ ] `MigrationStatus` にリトライ上限到達を表す状態（例: `'failed_permanently'`）を追加する
- [ ] リトライ回数を `chrome.storage.local` に記録し、起動のたびにインクリメントする
- [ ] `MAX_MIGRATION_RETRY_COUNT`（例: 5）に達したらマイグレーションを実行せず、失敗状態として扱う
- [ ] 失敗状態になった場合、診断パネル（dashboard）でユーザーに表示する
- [ ] マイグレーション成功時はリトライカウントをリセットする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- リトライ回数が上限未満の場合は再試行されることを確認
- リトライ回数が上限に達した場合は再試行されず `failed_permanently` になることを確認
- 成功時にリトライカウントがリセットされることを確認

### 統合テスト
- 複数回の起動シミュレーションでリトライカウントが正しく積み上がることを確認

## 実装アプローチ

1. `migrationService.ts` にリトライカウント用のストレージキーを追加
2. マイグレーション開始時にカウントをインクリメント、上限チェック
3. 成功時にカウントをリセットするロジックを追加
4. 診断パネルに失敗状態の表示を追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/dashboard/` の診断パネルへの表示追加が必要
- テスタビリティ: `chrome.storage.local` のモックでリトライカウントの遷移をテスト可能

## Definition of Done
- [ ] リトライ上限が実装されている
- [ ] 上限到達時にユーザーへ通知される
- [ ] 成功時にカウントがリセットされる
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Legacy Bridge Architect指摘）
- 対象コード: `src/background/migrationService.ts:130-196`
