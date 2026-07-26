# PBI: デュアルライトの調停メカニズムを整理しLEGACY_DUAL_WRITE_ENABLEDのデフォルトを見直す

**作成日**: 2026-07-26
**優先度**: High
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（デフォルト値変更は既存ユーザーのダッシュボード「履歴」パネル等、chrome.storage.local依存機能に影響する可能性がある）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の System Architect, Data Integrity Expert からの High指摘。同一データが `chrome.storage.local` と SQLite (OPFS) の両方に書き込まれている。一方の書き込みが成功し他方が失敗した場合の調停処理が存在しない。`pendingSqliteQueue` は SQLite 失敗時のみの退避であり、chrome.storage 書き込み失敗時にはデータが消失する。デフォルトの `LEGACY_DUAL_WRITE_ENABLED` を `false` に変更することが提案されている。

**2026-07-26時点の調査で以下を確認した。** `src/background/pipeline/steps/saveMetadataStep.ts:66-75` に既に `LEGACY_DUAL_WRITE_ENABLED` フラグの分岐が実装されており、コメントに「無効化するとSQLiteのみがsingle source of truthになる」と明記されている。ただし `src/utils/storage/defaults.ts:182` で `[StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: true` とデフォルトが `true` のままであり、レビューが指摘した「デフォルトをfalseに」という対応は未実施。また、SQLite書き込み失敗時の `pendingSqliteQueue` はあるが、chrome.storage書き込み失敗時の同様のリカバリ機構は存在しない（片側のみのセーフティネット）。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "LEGACY_DUAL_WRITE_ENABLED" src/utils/storage/defaults.ts src/background/pipeline/steps/saveMetadataStep.ts src/background/pipeline/steps/saveSqliteStep.ts
grep -n "pendingSqliteQueue" src/background/pipeline/steps/saveSqliteStep.ts
```

**このPBIはデフォルト値変更の影響が大きいため、段階的に進める。** まず「chrome.storage側の書き込み失敗時にもリカバリ機構を用意する」対応を先に行い、その後デフォルト値の変更（`true`→`false`）を検討する。既存ユーザーの「ダッシュボード履歴パネル」等、`chrome.storage.local` の `savedUrlsWithTimestamps` に依存する機能がSQLite単独で完全に代替できているかを確認してからデフォルト変更に着手する。

## 受け入れ基準（BDD）

```gherkin
Scenario: chrome.storage書き込み失敗時にもリカバリキューに退避される
  Given SQLite書き込みが成功し、chrome.storage.local書き込みが失敗する
  When saveMetadataStep が実行される
  Then 失敗したchrome.storage書き込みが pendingChromeStorageQueue（新設）に退避され、再試行される

Scenario: 両方の書き込みが成功した場合は従来通り動作する
  Given SQLiteとchrome.storage.local両方の書き込みが成功する
  When saveMetadataStep が実行される
  Then 既存の挙動と変わらない

Scenario: デフォルト変更前にSQLite単独での機能充足を確認する
  Given LEGACY_DUAL_WRITE_ENABLED をfalseに設定した状態
  When ダッシュボードの履歴パネル・重複チェック等、chrome.storage.localのsavedUrlsWithTimestampsに依存する機能を使う
  Then SQLiteのみのデータで全て正常に動作する

Scenario: デフォルトをfalseに変更した後も既存ユーザーのデータが失われない
  Given 既存ユーザーがLEGACY_DUAL_WRITE_ENABLED未設定（デフォルト適用）のままアップデートする
  When 拡張機能が新しいデフォルト値（false）で起動する
  Then chrome.storage.local内の既存データはそのまま残り、新規書き込みのみSQLite単独になる
```

## 受け入れ基準
- [ ] chrome.storage.local書き込み失敗時のリカバリキュー（`pendingChromeStorageQueue` 相当）を実装する
- [ ] `saveMetadataStep.ts` の依存先（`savedUrlsWithTimestamps` を読む全箇所）がSQLite経由でも同等の機能を提供できることを確認する
- [ ] リカバリキューの実装確認後、`LEGACY_DUAL_WRITE_ENABLED` のデフォルトを `true` から `false` に変更する
- [ ] 既存の `saveMetadataStep`, `saveSqliteStep` 関連テストが全てパスする
- [ ] デフォルト変更に関するCHANGELOG.md記載とマイグレーションガイドを用意する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- chrome.storage書き込み失敗をシミュレートし、リカバリキューへの退避と再試行が正しく動作することを確認
- `LEGACY_DUAL_WRITE_ENABLED=false` の状態で記録フロー全体（記録→SQLite書き込み→ダッシュボード表示）が正常動作することを確認

### 単体テスト
- リカバリキューの追加・処理ロジックの単体テスト
- 既存の `saveMetadataStep` テストの回帰確認

## 実装アプローチ

1. `saveMetadataStep.ts` のchrome.storage書き込み失敗時の挙動を確認し、リカバリキューを設計・実装
2. `savedUrlsWithTimestamps` に依存する全箇所（ダッシュボード、重複チェック等）を洗い出し、SQLite単独でも機能することを確認
3. 上記が確認できたら `defaults.ts` のデフォルト値を変更
4. CHANGELOG.mdにデフォルト変更を記載

## 見積もり

3pt以上（リカバリキュー実装 + 依存箇所の網羅確認 + デフォルト変更 + 移行ガイド）。規模が大きいため、リカバリキュー実装とデフォルト変更を別々のPRに分割することも検討する。

## 技術的考慮事項
- 依存関係: `src/background/pipeline/steps/saveMetadataStep.ts`, `saveSqliteStep.ts`, `src/utils/storage/defaults.ts`
- テスタビリティ: 書き込み失敗のシミュレーションが必要
- 非機能要件: データ整合性、後方互換性

## Definition of Done
- [ ] chrome.storage書き込み失敗時のリカバリキューが実装されている
- [ ] SQLite単独での機能充足が確認されている
- [ ] デフォルト値が変更されている（段階的に実施した場合はその旨を記録）
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（System Architect, Data Integrity Expert指摘、High）
- 対象コード: `src/background/pipeline/steps/saveMetadataStep.ts:66-75`, `src/utils/storage/defaults.ts:182`
