# PBI: データ整合性 — dual-write除去・settingsStore重複抽出・TOCTOU文書化

元指摘: Checking Team (Medium: Data Integrity Expert, Refactoring Evangelist)

## ユーザーストーリー
開発チームとして、(1) `savedUrlStore.setSavedUrlsWithTimestamps()` の互換性用キー書き込みを削除し、(2) `settingsStore.getSettings()` の新旧パスに重複する移行/復号ロジックを共通ヘルパーに抽出し、(3) `optimisticLock.ts` の TOCTOU リスクをコードコメントで文書化したい、なぜなら (1) SQLite が信頼できるストレージになった現在、互換性用の二重書き込みは不要かつ不整合の原因であり、(2) 重複ロジックは将来の設定項目追加時に両方のパスを更新し忘れるリスクがあり、(3) TOCTOU のリスクは低いが認識しておくべき設計上の制約であるから

## ビジネス価値
- データ不整合リスクの排除（dual-write削除）
- 設定追加時の更新漏れ防止
- 設計上のトレードオフの明示化

## BDD受け入れシナリオ

```gherkin
Feature: データ整合性クリーンアップ

  Scenario: savedUrlStore に互換性用キー書き込みが存在しない
    Given setSavedUrlsWithTimestamps が呼ばれる
    When savedUrlsWithTimestamps の書き込み後
    Then 以前存在した savedUrls（互換性用）キーへの書き込みが行われない
    And savedUrls キーが既存ユーザーで削除されていない（後方互換）ことを確認する

  Scenario: settingsStore に重複移行ロジックが存在しない
    Given getSettings() の新旧2パスに同一の migration + decryption ロジックが重複している
    When _applyMigrationsAndDecrypt(settings, rawEncrypted?) ヘルパーに抽出する
    Then 両パスともヘルパーを呼び出す
    And 既存のテストがすべてパスする

  Scenario: optimisticLock の TOCTOU リスクが文書化されている
    Given performCasUpdate のコード
    When 書き込み後再検証の条件が無効化されている場合
    Then TOCTOU のリスクと影響範囲がコメントで明記されている
```

## 受け入れ基準
- [ ] `savedUrlStore.setSavedUrlsWithTimestamps()` から `chrome.storage.local.set({ savedUrls })` の互換性用書き込みを削除
- [ ] ただし `savedUrls` キーを `chrome.storage.local` から即座に削除はしない（後方互換）
- [ ] `settingsStore.ts` に `_applyMigrationsAndDecrypt(settings, rawEncrypted?)` ヘルパーを抽出
- [ ] 新旧両パスからヘルパーを呼び出すよう変更
- [ ] `optimisticLock.ts` の TOCTOU リスクを `performCasUpdate` 関数のコメントで文書化
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- dual-write削除後も既存の `savedUrlStore` テストがパスすることを確認
- `_applyMigrationsAndDecrypt` ヘルパーが新旧両パスをカバーするテスト

### 単体テスト
- ヘルパー関数のユニットテスト

## 実装アプローチ
- **Safe Refactor**: 各項目は独立しているため順不同で実装可能
- dual-write削除は1行の削除（実際の書き込み処理の片方を削除）。ただし影響範囲の確認が必要（他モジュールが `savedUrls` キーを直接読んでいないか）
- settingsStore のリファクタリングは重複ロジックを特定し、共通ヘルパーに抽出する

## 見積もり
2pt（3項目とも小規模なリファクタリング）

## 技術的考慮事項
- `savedUrls` キーの書き込み削除後も、既存ユーザーの `chrome.storage.local` に残っている `savedUrls` データは影響しない。`getSavedUrlsWithTimestamps()` は `savedUrlsWithTimestamps` キーを読み取るため、互換性キーの存在有無に依存しない
- `_applyMigrationsAndDecrypt` の抽出により、`getSettings()` の可読性が向上する。ただし既存の型は変更しない

## 落とし穴
- dual-write削除後、他モジュールが `savedUrls` キーを直接読み取っていないことを確認する。`grep -rn '"savedUrls"' src/ entrypoints/` で参照箇所を洗い出す
- ヘルパー抽出時に両パスのロジックが完全に同一であることを確認（部分的な差異がある場合は共通化せず、差異をコメントで明記する）

## Definition of Done
- [ ] savedUrlStore の互換性用書き込みが削除されている
- [ ] settingsStore の重複ロジックがヘルパー抽出されている
- [ ] optimisticLock の TOCTOU が文書化されている
- [ ] 既存テストがすべてパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
