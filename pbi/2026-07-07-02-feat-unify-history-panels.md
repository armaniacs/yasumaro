# PBI: ダッシュボード「履歴」タブの統一 — SQLite パネルを「記録履歴」と同等にする

## ユーザーストーリー
ユーザーとして、ダッシュボードの SQLite 履歴タブで、従来の「記録履歴」（レガシーパネル）と同じ情報量（AI要約、トークン数、バイト数、AIプロバイダ/モデル、content 表示、クレンジング統計等）を確認したい。なぜなら 2 つの履歴パネルを行き来する必要をなくし、SQLite 版で全て完結させたいから。

## ビジネス価値
- ユーザーが 2 つの履歴パネルを使い分ける必要がなくなる
- レガシー `historyPanel.ts`（`savedUrlsWithTimestamps` 依存）を将来的に削除可能になる
- フォールバックモードでも全情報が SQLite から表示される（PBI-1 完了後）

## 依存関係
**この PBI は PBI-1（SQLite への診断メタデータ永続化）の完了を前提とする。** SQLite にデータが保存されていないと表示できないため。

## 既実装確認（Phase 0）
- `src/dashboard/historyPanel.ts` — レガシーパネル。`getSavedUrlEntries()` で `savedUrlsWithTimestamps` を読み込み、`historyEntryRow.ts` でリッチな表示を行う
- `src/dashboard/sqliteHistoryPanel.ts` — SQLite パネル。`queryLogs()` / `searchLogs()` で SQLite を読み込むが、表示項目が最小限（URL, title, timestamp, tags, star/delete のみ）
- `src/dashboard/historyEntryRow.ts` — AI要約、トークン数、バイト数、AIプロバイダ/モデル、content toggle、クレンジング統計、フォールバックフラグ等を表示。レガシーパネル専用で SQLite パネルでは未使用

レガシーパネルが表示しているが SQLite パネルが未表示の項目（全量）:
- AI要約（aiSummary / summary）
- トークン数（sentTokens / receivedTokens / originalTokens / cleansedTokens）
- バイト数（pageBytes / candidateBytes / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes）
- AI クレンジング理由・要素数
- AIプロバイダ・モデル
- AI処理時間
- content（本文）表示トグル
- AI要約表示トグル
- フォールバックフラグ
- レコードタイプバッジ（recordType）
- マスク件数バッジ（maskedCount）
- クレンジング理由バッジ（cleansedReason）
- Content Cleansing 進捗バー
- タグ編集モーダル

## BDD受け入れシナリオ

```gherkin
Feature: SQLite 履歴パネルの情報充実
  SQLite ベースの履歴パネルが、従来の「記録履歴」パネルと同等の情報を表示する。

  Scenario: AI要約が SQLite 履歴パネルに表示される
    Given SQLite browsing_logs に summary="これはAI要約です" が保存されている
    When ユーザーがダッシュボードで SQLite 履歴タブを開く
    Then エントリの一覧に "これはAI要約です" が表示される

  Scenario: content(本文) の表示/非表示をトグルできる
    Given SQLite browsing_logs に content="長い本文..." が保存されている
    When ユーザーがエントリの「AIへ送信したデータ」ボタンをクリックする
    Then content が展開表示される
    When 再度クリックする
    Then content が非表示になる

  Scenario: AIプロバイダ・モデル・処理時間が表示される
    Given SQLite browsing_logs に ai_provider="openai", ai_model="gpt-4",
      ai_duration_ms=5000 が保存されている
    When ユーザーがダッシュボードで SQLite 履歴タブを開く
    Then エントリに "AI: openai / gpt-4" と "処理時間 5.0秒" が表示される

  Scenario: トークン数・バイト削減率が表示される
    Given SQLite browsing_logs に sent_tokens=100, received_tokens=50,
      page_bytes=10000, candidate_bytes=5000 が保存されている
    When ユーザーがダッシュボードで SQLite 履歴タブを開く
    Then エントリに "送信: 100, 受信: 50" と "コンテンツ抽出" の削減率が表示される
```

## 受け入れ基準
- [ ] SQLite 履歴パネルが AI要約（summary）を表示する
- [ ] SQLite 履歴パネルが content（本文）の表示/非表示トグルを持つ
- [ ] SQLite 履歴パネルが AIプロバイダ・モデル・処理時間を表示する
- [ ] SQLite 履歴パネルがトークン数・バイト削減率を表示する
- [ ] SQLite 履歴パネルが recordType / maskedCount / cleansedReason のバッジを表示する
- [ ] SQLite 履歴パネルがフォールバックフラグを表示する
- [ ] SQLite 履歴パネルが content cleansing / ai summary cleansing の統計を表示する
- [ ] SQLite 履歴パネルにタグ編集モーダルがある
- [ ] SQLite 履歴パネルに削除ボタンがある（フラグ更新ではなく論理削除でも可）
- [ ] レガシーパネル（historyPanel）と同じ情報が SQLite パネルで確認できる
- [ ] 全ての多言語（i18n）キーが追加されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- SQLite 履歴パネルの全項目表示確認（モック SQLite クライアント使用）

### 統合テスト
- `dashboardSqliteService.ts`: 新規フィールドを含むクエリ結果の型テスト
- `sqliteHistoryPanel.ts`: 各表示項目の DOM 生成テスト

### 単体テスト
- `sqliteHistoryPanel.ts` の renderEntryList: 各フィールドの有無による条件分岐テスト
- content toggle の表示/非表示テスト
- トークン数表示のフォーマットテスト
- バッジ生成テスト

## 実装アプローチ
- **Outside-In**: SQLite 履歴パネルに不足している表示項目をリストアップし、1項目ずつテスト→実装を繰り返す
- **既存コードの活用**: `historyEntryRow.ts` の表示ロジックを参考に、SQLite パネルの `renderEntryList()` を拡張する
- **レガシーパネル削除は別 PBI**: 本 PBI では SQLite パネルの機能拡充のみ。レガシーパネル（`historyPanel.ts`）の削除は別途判断

## 見積もり
21 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- **依存関係**: PBI-1（SQLite への診断メタデータ永続化）が完了していること
- **content の遅延読み込み**: content は巨大なため、一覧表示時に毎回 SELECT するとパフォーマンスが低下する。content は個別エントリのトグル時のみ取得する設計を検討
- **タグ編集**: レガシーパネルでは `urlMetadata.ts` の `setUrlTags()` で `savedUrlsWithTimestamps` を更新。SQLite 版では SQLite の `tags` カラムを直接更新する。PBI-1 で SQLite に tags が永続化済みなら、SQLite を直接書き換える
- **削除操作**: レガシーパネルは `removeSavedUrl()` で `savedUrlsWithTimestamps` から削除。SQLite 版は論理削除（`is_deleted=1`）を使用
- **i18n**: 多くのメッセージキーは `historyEntryRow.ts` で使用済み。SQLite パネルでも同じキーを使い回せる

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "renderEntryList\|sqlite-entry" src/dashboard/sqliteHistoryPanel.ts
grep -rn "history-entry" src/dashboard/historyEntryRow.ts
grep -rn "getMessage\|t(" src/dashboard/sqliteHistoryPanel.ts | head -20
```

### 実装手順
1. `src/dashboard/sqliteHistoryPanel.ts` の `renderEntryList()` を拡張
   - AI要約（summary）の表示追加
   - AIプロバイダ/モデル/処理時間の表示追加
   - トークン数・バイト削減率の表示追加
   - content トグルの追加（遅延読み込み推奨）
   - recordType / maskedCount / cleansedReason のバッジ追加
   - フォールバックフラグ表示追加
   - クレンジング統計表示追加
2. タグ編集モーダルの統合（`historyTagEditModal.ts` を SQLite パネルから呼び出せるようにする）
3. 削除処理の統合（SQLite の論理削除で統一）
4. i18n メッセージキーの確認と追加
5. 全テストをパスさせる

### 落とし穴
- content が NULL のエントリでトグルボタンを表示しない
- PBI-1 未完了の状態で本 PBI に着手しない（データが存在しないため表示テストができない）
- レガシーパネルは削除しない（フォールバック対応として当面維持）。本 PBI 完了後にレガシーパネル削除の PBI を立てるか判断
- SQLite パネルとレガシーパネルの表示が完全一致していることを確認するテストケースを必ず書く

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] SQLite 履歴パネルとレガシー「記録履歴」パネルの表示項目が一致している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] i18n メッセージキーが全キー追加済み
