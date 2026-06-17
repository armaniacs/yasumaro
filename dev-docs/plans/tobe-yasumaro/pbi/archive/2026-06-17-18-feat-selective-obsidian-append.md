# PBI-18: 記録履歴/SQLite History から選択した記事を Obsidian に追記する

## ユーザーストーリー

Yasumaro のユーザーとして、記録履歴または SQLite History の一覧で記事をチェックボックスで選び、まとめて Obsidian に追記したい。なぜなら、普段はすべての閲覧履歴を SQLite にだけ記録しておき、後から本当に残したい記事だけを絞って Obsidian のデイリーノートに書き出したいから。

## ビジネス価値

- **ノートの S/N 比向上**: 自動記録の全件ではなく、ユーザーが選んだ価値ある記事だけが Obsidian に残るため、デイリーノートのノイズが減る
- **「記録」と「保管」の分離**: SQLite を網羅的なバッファ、Obsidian を厳選アーカイブとして役割分担できる
- **PBI-17 の自然な続き**: PBI-17 で Obsidian 連携を OFF（SQLite のみ保存）にできるようにした上で、本 PBI が「後から選んで追記」する出口を提供する
- **手戻りの削減**: 録画時に Obsidian へ書くかどうかを毎回判断する必要がなくなる

## 調査結果（フェーズ0）

### 既存コードの確認

```bash
grep -rn "appendToDailyNote" src/background/obsidianClient.ts
grep -rn "DASHBOARD_SQLITE\|sqliteHistoryPanel\|historyPanel" src/dashboard/
grep -rn "obsidian_enabled\|OBSIDIAN_ENABLED" src/ public/ entrypoints/
```

確認できた事実:

- **追記 API は既存**: `src/background/obsidianClient.ts:192` に `appendToDailyNote(content: string)` が実装済み。録画パイプラインの `src/background/pipeline/steps/saveToObsidianStep.ts:51` がこれを呼んでデイリーノートに markdown を追記している
- **履歴 UI は2系統存在**:
  - `src/dashboard/historyPanel.ts`（記録履歴 / 旧 chrome.storage ベース）
  - `src/dashboard/sqliteHistoryPanel.ts`（SQLite History / FTS5 検索・カレンダー・star/delete 付き）
- **SQLite データアクセス**: `src/dashboard/dashboardSqliteService.ts` が `DASHBOARD_SQLITE` メッセージ経由で SW の SqliteClient を叩く。`queryLogs` / `searchLogs` が `BrowsingLogEntry`（id, url, title, domain, summary, created_at, is_starred …）を返す
- **エントリ描画**: `sqliteHistoryPanel.ts` の `renderEntryList()`（276行〜）が各行を生成。現状チェックボックスは無く、star/delete のみ
- **PBI-17 のフラグ**: `obsidian_enabled` / `StorageKeys.OBSIDIAN_ENABLED` は PBI-17 で導入予定。本 PBI は OFF でも手動追記を許容する設計とする（後述）

### 未実装の確認

- 履歴一覧の複数選択チェックボックス UI: 未実装
- 選択記事をまとめて Obsidian に追記するアクション・メッセージハンドラ: 未実装
- 既存 `BrowsingLogEntry` から markdown を生成する整形関数（パイプライン外で再利用可能なもの）: 未確認（`saveToObsidianStep` 内は `context.markdown` に依存しており、履歴から直接生成する経路は無い）

## 設計方針（深掘りセッションでの決定事項）

| 項目 | 決定 | 理由 |
|------|------|------|
| 対象パネル | SQLite History を主、記録履歴を従 | SQLite が網羅バッファであり、絞り込み（検索/日付）と相性が良い。記録履歴側は同一コンポーネントで横展開 |
| 選択 UI | 各行の先頭にチェックボックス + 一括バー（全選択/選択解除/件数表示） | 複数選択を直感的に。アクセシビリティ確保 |
| 追記アクション | 「選択した記事を Obsidian に追記」ボタン（選択0件時は無効） | 明示的操作。誤爆防止 |
| 追記先 | 既存 `appendToDailyNote` で今日のデイリーノートに追記 | 既存資産を再利用。日付指定追記は本 PBI の対象外（将来 PBI） |
| Obsidian 未設定/OFF 時 | ボタンは表示するが、押下時に「Obsidian を設定してください」と通知し追記しない | 手動操作はユーザーの明示意図なので、API Key 未設定のみをガードにする |
| 重複追記の扱い | 同一記事を再度追記してもブロックしない（v1） | 重複検知は複雑。まずは素直に追記し、将来 PBI で「追記済みバッジ」を検討 |
| 整形 | `BrowsingLogEntry` → markdown 整形関数を新設し単体テスト可能にする | パイプラインの markdown 整形ロジックと独立してテストできる |

## BDD 受け入れシナリオ

```gherkin
Scenario: SQLite History で複数記事を選んで Obsidian に追記する
  Given ユーザーが Obsidian API Key を有効に設定している
  And   SQLite History に複数の記録が存在する
  And   ダッシュボードの SQLite History パネルを開いている
  When  ユーザーが3件の記事のチェックボックスを ON にする
  And   「選択した記事を Obsidian に追記」ボタンをクリックする
  Then  選択した3件が今日のデイリーノートに markdown として追記される
  And   追記成功の通知が表示される
  And   チェックボックスの選択が解除される

Scenario: 1件も選択せずに追記ボタンを押そうとする
  Given ユーザーが SQLite History パネルを開いている
  And   どの記事も選択していない
  Then  「選択した記事を Obsidian に追記」ボタンは無効（disabled）になっている

Scenario: 全選択チェックボックスで現在表示中の記事をまとめて選択する
  Given SQLite History に表示中の記事が20件ある
  When  ユーザーが一括バーの「全選択」をクリックする
  Then  表示中の20件すべてのチェックボックスが ON になる
  And   一括バーに「20件選択中」と表示される

Scenario: Obsidian API Key が未設定の状態で追記しようとする
  Given Obsidian API Key が未設定である
  And   ユーザーが記事を2件選択している
  When  「選択した記事を Obsidian に追記」ボタンをクリックする
  Then  「Obsidian を設定してください」という通知が表示される
  And   Obsidian への追記は実行されない
  And   選択状態は保持される

Scenario: 追記が一部失敗してもユーザーに結果が伝わる
  Given Obsidian への接続が途中で失敗する状況である
  And   ユーザーが記事を3件選択して追記を実行した
  When  追記処理がエラーになる
  Then  エラー通知が表示される
  And   どの段階で失敗したかが分かるメッセージが出る
  And   SQLite の記録自体は削除・変更されない
```

## 受け入れ基準

- [ ] SQLite History の各記事行にチェックボックスが表示される
- [ ] 一括バーに「全選択 / 選択解除 / 選択件数」が表示され、表示中の記事に対して機能する
- [ ] 「選択した記事を Obsidian に追記」ボタンは選択0件時に無効、1件以上で有効になる
- [ ] 追記実行時、選択記事が markdown 整形されて今日のデイリーノートに `appendToDailyNote` 経由で追記される
- [ ] Obsidian API Key 未設定時は追記せず通知のみ行う
- [ ] 追記の成功/失敗がユーザーに通知される
- [ ] 追記後に選択状態がクリアされる（失敗時は保持）
- [ ] SQLite の記録は追記操作で変更されない（読み取りのみ）
- [ ] 記録履歴（`historyPanel.ts`）側にも同一の選択+追記 UI が適用される
- [ ] 全 BDD シナリオが自動テストとして実装されパスする

## テスト戦略（t_wada スタイル）

### E2E テスト（1件）
- SQLite History で複数チェック → 追記ボタン → デイリーノートへの追記呼び出しが行われ、選択がクリアされる（`appendToDailyNote` はモック）

### 統合テスト（3件）
- ダッシュボード → SW のメッセージハンドラ（例: `DASHBOARD_SQLITE` の `subtype: 'append_to_obsidian'`）が選択 id 群を受け取り、`ObsidianClient.appendToDailyNote` を呼ぶ
- API Key 未設定時にハンドラが追記せずエラー/未設定ステータスを返す
- 追記途中失敗時に SQLite 側のデータが変更されないこと（読み取り専用であること）

### 単体テスト（5件）
- `formatEntriesToMarkdown(entries)`: 複数 `BrowsingLogEntry` を期待する markdown（タイトル・URL・要約・時刻）に整形する
- `formatEntriesToMarkdown([])`: 空配列で空文字または安全な値を返す（境界値）
- 選択状態管理: チェックボックス ON/OFF で選択 id Set が更新され、件数とボタン活性が連動する
- 全選択: 表示中エントリの id すべてが選択 Set に入る／全選択解除で空になる
- ページ遷移・検索・日付変更で選択がリセットされる（表示集合が変わるため誤追記を防ぐ）

## 実装アプローチ

- **Outside-In**: E2E（失敗）→ 統合（失敗）→ 単体（失敗）→ 実装 → グリーン → リファクタリング
- **整形ロジックを先に純粋関数化**: `formatEntriesToMarkdown` を `src/dashboard/`（または共有 util）に切り出し、単体テストから固めてから UI/メッセージ配線を行う
- **既存資産の再利用**: 追記は新 API を作らず `ObsidianClient.appendToDailyNote` を流用。`saveToObsidianStep` の整形フォーマットを参照して見た目を揃える

### 想定実装ステップ

1. `formatEntriesToMarkdown(entries: BrowsingLogEntry[]): string` を新設（単体テスト先行）
2. `sqliteHistoryPanel.ts` の `renderEntryList()` に行頭チェックボックスを追加し、選択 id を保持する `Set<number>` を state に追加
3. 一括バー（全選択/解除/件数/追記ボタン）を `renderState()` に追加し、選択件数でボタン活性を制御
4. `dashboardSqliteService.ts` に `appendToObsidian(ids: number[])` を追加（`DASHBOARD_SQLITE` メッセージ `subtype: 'append_to_obsidian'`）
5. SW 側の `DASHBOARD_SQLITE` ハンドラに `append_to_obsidian` を追加。id 群で SQLite から行を取得 → `formatEntriesToMarkdown` → API Key チェック → `appendToDailyNote`
6. 成功/失敗を通知し、成功時に選択 Set をクリアして再描画
7. `historyPanel.ts`（記録履歴）にも同一 UI/ロジックを横展開
8. i18n メッセージ追加（ja/en）
9. `npm run type-check && npm test` で検証

### i18n メッセージ（追加分）

`public/_locales/ja/messages.json` と `en/messages.json` に追加（例）:

- `historySelectAll`（全選択）
- `historyClearSelection`（選択解除）
- `historySelectionCount`（$1件選択中）
- `historyAppendToObsidian`（選択した記事を Obsidian に追記）
- `historyAppendSuccess`（$1件を Obsidian に追記しました）
- `historyAppendObsidianNotConfigured`（Obsidian を設定してください）
- `historyAppendFailed`（追記に失敗しました）

## 見積もり

**5 SP**（純粋関数の整形 + 2パネルへの選択 UI + メッセージハンドラ + 通知 + テスト）

## 技術的考慮事項

- **依存関係**: PBI-17 の完了を推奨（`obsidian_enabled` の概念と Obsidian セクション UI の前提を共有）。ただし本 PBI の追記ガードは「API Key の有無」で行うため、PBI-17 未完了でも独立して動作可能
- **後方互換性**: 既存の録画パイプラインの自動追記には一切影響しない（読み取り＋手動追記のみ追加）
- **テスタビリティ**: `appendToDailyNote` と `DASHBOARD_SQLITE` メッセージはモック可能。整形は純粋関数で単体テスト容易
- **データ整合性**: 追記操作は SQLite に対して読み取りのみ。書き込み/削除を行わない
- **アクセシビリティ**: チェックボックスに `aria-label`、一括バーの件数を `aria-live` で通知。star/delete ボタンと選択チェックボックスのフォーカス順序を整理
- **パフォーマンス**: 選択は表示中ページ（最大 PAGE_SIZE=20 件）に限定。大量一括追記は v1 の対象外

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "appendToDailyNote" src/background/obsidianClient.ts
grep -rn "renderEntryList\|sqlite-entry" src/dashboard/sqliteHistoryPanel.ts
grep -rn "DASHBOARD_SQLITE" src/background/ src/dashboard/dashboardSqliteService.ts
grep -rn "obsidian_enabled\|OBSIDIAN_ENABLED" src/ public/ entrypoints/
```

### 落とし穴

- `sqliteHistoryPanel.ts` の `renderEntryList()` は `querySelectorAll(...).forEach((el, i) => ...)` で **インデックス順** にハンドラを束ねている。チェックボックスも同様に id ではなくインデックスでバインドすると、検索/ページ遷移後にズレる恐れがある。可能なら `data-id` を使って id ベースで参照する
- `loadData()` は検索・ページ・日付変更で `state.entries` を丸ごと差し替える。**表示集合が変わったら選択をリセット**しないと、画面に無い記事を誤って追記する
- `updateDynamicRegions()` と `renderState()` の2系統の描画パスがある。一括バーの件数・ボタン活性は両方の経路で更新されるよう注意
- 追記の markdown フォーマットは `saveToObsidianStep` のパイプライン出力と見た目を揃えること。整合性が崩れるとデイリーノート内で書式が混在する
- Obsidian API Key の有効判定は既存の閾値（16文字未満はスキップ）に合わせる
- 記録履歴（`historyPanel.ts`）と SQLite History は別実装。共通化できる部分（整形関数・選択状態ロジック）は util へ切り出して重複を避ける

### 実装順序

1. `formatEntriesToMarkdown` の単体テスト → 実装
2. SQLite History パネルへのチェックボックス + 一括バー
3. `dashboardSqliteService.appendToObsidian` + SW ハンドラ
4. 通知・選択クリア
5. 記録履歴パネルへ横展開
6. i18n（ja/en）
7. `npm run type-check && npm test`

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（該当する場合）
- [x] i18n 日本語/英語両方に対応
- [ ] SQLite History と記録履歴の両パネルで手動追記が動作することを手動確認
- [x] 既存の録画パイプラインの自動追記に影響がないことを確認
