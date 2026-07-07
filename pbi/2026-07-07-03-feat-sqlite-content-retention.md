# PBI: content（本文）の古いエントリ削除機能

## ユーザーストーリー
ユーザーとして、SQLite に保存された browsing_logs の content（本文）を、古いエントリから自動的に削除する設定が欲しい。なぜなら content は最も容量を消費するフィールド（最大 64KB/エントリ）であり、長期間の蓄積で DB サイズが肥大化するのを防ぎたいから。レコード自体は削除せず、content のみを NULL にしたい。

## ビジネス価値
- SQLite DB の肥大化を抑制できる
- content が不要なユーザー（一覧表示のみで十分なユーザー）は容量を節約できる
- レコード自体は保持されるため、URL, title, summary, tags 等の基本情報は失われない
- 既存の保持ポリシー（`SQLITE_RETENTION_DAYS` / `SQLITE_MAX_RECORDS`）とは直交する機能（レコード削除ではなく content のみを対象）

## 既実装確認（Phase 0）
- `offscreen/sqlite.ts` の `purgeOldRecords()`: レコード全体を削除する機能。content のみを対象としない
- `offscreen/storageFallback.ts` の `purgeOldRecords()`: 同上
- `dailyPurgeHandler.ts`: 日次アラームで `purgeOldRecords()` を呼び出す。content 専用の処理はなし
- ダッシュボードの保持ポリシー設定: `SQLITE_RETENTION_DAYS` / `SQLITE_MAX_RECORDS` の設定 UI は存在するが、content 専用はなし
- `legacy` ストレージ側: レガシー `savedUrlsWithTimestamps` に対しては `MAX_CONTENT_ENTRIES=10` で content の保持件数制限が既にある。SQLite 側には同等機能なし
- 未実装と判断

## BDD受け入れシナリオ

```gherkin
Feature: content 保持ポリシー
  SQLite の content カラムを一定条件で自動的に NULL にする。

  Scenario: content 保持日数を過ぎたエントリの content が NULL になる
    Given ユーザーが content 保持日数を "30 日" に設定している
    And browsing_logs に 40 日前の content="古い本文..." を持つエントリが存在する
    And browsing_logs に 10 日前の content="新しい本文..." を持つエントリが存在する
    When 日次 content パージ処理が実行される
    Then 40 日前のエントリの content が NULL になる
    And 10 日前のエントリの content は維持される

  Scenario: content 最大保持件数を超えたエントリの content が NULL になる
    Given ユーザーが content 最大保持件数を "100" に設定している
    And content が NULL でないエントリが 150 件存在する
    When 日次 content パージ処理が実行される
    Then 古い 50 件の content が NULL になる
    And 新しい 100 件の content は維持される

  Scenario: 両方の条件が設定されている場合、より厳しい方が適用される
    Given ユーザーが content 保持日数を "7 日"、最大保持件数を "500" に設定している
    And 3 日前の content を持つエントリが 600 件存在する
    When 日次 content パージ処理が実行される
    Then 3 日前のエントリのうち、古い 100 件の content が NULL になる（件数制限が勝つ）

  Scenario: content 保持が「無制限」の場合、content は削除されない
    Given ユーザーが content 保持を「無制限」に設定している
    And 1 年前の content を持つエントリが存在する
    When 日次 content パージ処理が実行される
    Then 1 年前のエントリの content は維持される

  Scenario: ダッシュボードから content パージを手動実行できる
    Given ユーザーがダッシュボードの設定パネルを開いている
    When 「content を今すぐ削除」ボタンをクリックする
    Then 設定された保持ポリシーに従って content パージが即時実行される
    And 削除された content の件数が通知される
```

## 受け入れ基準
- [ ] content 保持日数（日数ベース）の設定項目がある（デフォルト: null = 無制限）
- [ ] content 最大保持件数（件数ベース）の設定項目がある（デフォルト: null = 無制限）
- [ ] 日次アラームで content パージが自動実行される（`dailyPurgeHandler` に統合、または別アラーム）
- [ ] content パージは content カラムのみを NULL に設定し、レコード自体は削除しない
- [ ] ダッシュボードに content パージ設定 UI（保持日数/件数のセレクトボックス、手動実行ボタン）がある
- [ ] スター付きエントリの content は削除対象外（オプション、ユーザー判断）
- [ ] i18n メッセージキーが追加されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 日次アラーム → content パージの一連の流れのテスト

### 統合テスト
- `sqlite.ts` の `purgeContent()`: 日数ベース・件数ベースのパージロジックのテスト
- `offscreen.ts` のメッセージハンドラ: CONTENT_PURGE メッセージの処理テスト
- `sqliteClient.ts` の `purgeContent()`: Service Worker → Offscreen のメッセージパッシングテスト

### 単体テスト
- `dailyContentPurgeHandler.ts`: 設定値の読み取りとパージ関数呼び出しのテスト
- 設定のシリアライズ/デシリアライズテスト

## 実装アプローチ
- **既存の保持ポリシーとの統合**: `dailyPurgeHandler` に content パージ処理を追加するか、別の `dailyContentPurgeHandler` を作成する。ユーザー設定の一貫性を考慮して、同一アラーム内で実行する方が望ましい
- **パージ処理**: SQL: `UPDATE browsing_logs SET content = NULL WHERE content IS NOT NULL AND (条件)` を実行する
- **設定キー**: 新規 StorageKeys を追加
  - `CONTENT_RETENTION_DAYS`（デフォルト: null = 無制限）
  - `CONTENT_MAX_RECORDS`（デフォルト: null = 無制限）

## 見積もり
8 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- **依存関係**: PBI-1（SQLite への content 永続化）が完了していること
- **content NULL 時の表示**: PBI-2 の SQLite 履歴パネルで content が NULL の場合にトグルボタンを表示しない処理との連携が必要
- **スター付きエントリの扱い**: スター付きエントリの content は削除対象から除外するオプションを検討（ユーザーが手動でスターを付けた記事は content を残したいケースがある）
- **フォールバックモード**: `FallbackStorage`（chrome.storage.local）にも同様の content パージ機能が必要か？ フォールバックモードは 5MB 制限があるため、content パージはより重要。ただし本 PBI のスコープは SQLite のみとし、フォールバックは別途判断
- **パフォーマンス**: content が大量にある場合の UPDATE は DB ロックに注意。バッチ処理にするか、一定件数ずつ実行する

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "purgeOldRecords\|handleDailyPurgeAlarm" src/
grep -rn "update(" src/offscreen/sqlite.ts
grep -rn "CONTENT_RETENTION\|CONTENT_MAX" src/utils/storage/
```

### 実装手順
1. `src/utils/storage/types.ts` に `CONTENT_RETENTION_DAYS` / `CONTENT_MAX_RECORDS` を追加
2. `src/utils/storage/defaults.ts` にデフォルト値（null）を追加
3. `offscreen/sqlite.ts` に `purgeContent(options: { retentionDays?: number; maxRecords?: number })` を追加
   ```sql
   -- 日数ベース: content を NULL に
   UPDATE browsing_logs SET content = NULL
   WHERE content IS NOT NULL
     AND created_at < $cutoff
     AND (is_starred = 0 OR $includeStarred = 1);

   -- 件数ベース: 古いエントリから content を NULL に
   -- （content IS NOT NULL のレコードを created_at ASC でソートし、上限超え分を NULL に）
   ```
4. `src/offscreen/offscreen.ts` に `CONTENT_PURGE` メッセージハンドラを追加
5. `src/background/sqliteClient.ts` に `purgeContent()` メソッドを追加
6. `src/background/dailyPurgeHandler.ts` を拡張（または `dailyContentPurgeHandler.ts` を新規作成）
7. ダッシュボードの保持ポリシー設定 UI に content 専用セクションを追加
8. i18n メッセージキーを追加
9. 全テストを追加

### 落とし穴
- `UPDATE ... ORDER BY created_at ASC LIMIT n` は SQLite のサブクエリが必要。単純な UPDATE + ORDER BY + LIMIT は SQLite のバージョンや設定によって制限がある
  ```sql
  -- 推奨パターン: サブクエリで ID を特定して UPDATE
  UPDATE browsing_logs SET content = NULL
  WHERE id IN (
    SELECT id FROM browsing_logs
    WHERE content IS NOT NULL
    ORDER BY created_at ASC
    LIMIT $excessCount
  );
  ```
- OPFS Worker パス（`opfsWorker.ts`）でも同様の `handleContentPurge` が必要
- フォールバックストレージ（`storageFallback.ts`）にも対応する場合、別途実装が必要

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 日次アラームによる自動 content パージが動作する
- [ ] ダッシュボードから手動 content パージが実行できる
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] i18n メッセージキー追加済み
- [ ] `dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md` を更新（content パージ戦略を追記）
