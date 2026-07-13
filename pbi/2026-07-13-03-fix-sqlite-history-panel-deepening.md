# PBI: sqliteHistoryPanel.ts の深化 — カレンダー・診断・エンリッチメント分離

## ユーザーストーリー
開発者として、1087行の `sqliteHistoryPanel.ts` からカレンダー操作、診断メタデータ整形、chrome.storage エンリッチメントを独立したモジュールに分離してほしい。
なぜなら現在1ファイルに8つの関心事が混在しており、カレンダーのバグ修正に全ファイルを読む必要があり、各機能の単体テストも不可能だから。

## ビジネス価値
- **テスタビリティ**: カレンダーウィジェット、診断フォーマッタ、エントリレンダラが独立して単体テスト可能になる
- **再利用性**: `CalendarWidget` が他のダッシュボードパネルでも使えるようになる
- **保守性**: 各モジュールが 50〜200 行に収まり、1つの関心事を理解するのにファイル全体を読む必要がなくなる

## BDD受け入れシナリオ

```gherkin
Scenario: カレンダーウィジェットが独立して動作する
  Given CalendarWidget が初期化されている
  When  ユーザーが日付ボタンをクリックしたとき
  Then  選択日がコールバックで呼び出し元に通知され
  And  カレンダーUIが選択状態を反映して再描画される

Scenario: 診断フォーマッタがエントリデータからHTMLを生成する
  Given トークン数・バイト数・クレンジング率を含む BrowsingLogEntry がある
  When  DiagnosticFormatter.format(entry) が呼ばれたとき
  Then  プログレスバー付きの診断HTMLが返され
  And  データが欠落している場合は空文字列が返される

Scenario: ストレージエンリッチャが欠損データを補完する
  Given SQLite エントリに sent_tokens が null だが chrome.storage に該当データがある
  When  StorageEnricher.enrich(entry, storageMap) が呼ばれたとき
  Then  sent_tokens が chrome.storage の値で補完され
  And  既に値があるフィールドは上書きされない

Scenario: パネルが分離後も全機能を維持する
  Given sqliteHistoryPanel.ts が CalendarWidget + DiagnosticFormatter + EntryRenderer + StorageEnricher を使用している
  When  ユーザーが履歴を検索・フィルタ・ページネーションするとき
  Then  分離前と完全に同じUIと動作が提供される
```

## 受け入れ基準
- [ ] `CalendarWidget` モジュールが抽出され、`renderCalendarNav()` / `handleDateSelect()` / `dateRangeFromSelected()` を含む
- [ ] `DiagnosticFormatter` モジュールが抽出され、`formatDiagnosticMetadataHtml()` / `buildCleansingProgressBarHtml()` を含む
- [ ] `StorageEnricher` モジュールが抽出され、`enrichEntryWithChromeStorage()` / `getChromeStorageLookup()` を含む
- [ ] `EntryRenderer` モジュールが抽出され、`renderEntryList()` を含む（ただし DOM アクセスはパネルに残す）
- [ ] `sqliteHistoryPanel.ts` が 400 行以下になる
- [ ] 各抽出モジュールが対応する単体テストを持つ
- [ ] 既存の全テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードの履歴パネルが分離前と同一のUI・動作を提供すること

### 統合テスト
- `CalendarWidget` がパネルのデータ読み込み（`loadData`）と正しく連携すること
- `StorageEnricher` が `chrome.storage` のキャッシュ機構と正しく連携すること

### 単体テスト
- `CalendarWidget.getMonthDateRange(year, month)` が正しい since/until を返す（境界値: 月末、閏年）
- `DiagnosticFormatter.format()` が全フィールド欠損時に空文字列、全フィールド存在時に完全な HTML を返す
- `DiagnosticFormatter.buildProgressBar()` が base=0 で空文字列を返す
- `StorageEnricher.enrich()` が既存値の上書きをしない
- `StorageEnricher.getLookup()` がキャッシュTTLを守る（5秒以内は再構築しない）

## 実装アプローチ
- **依存**: PBI #1（StorageBackend アダプタ）の完了後に着手（パネルのデータアクセスがアダプタ経由になる可能性があるため）
- **抽出のみ**: ロジックの変更は一切行わず、関数を別ファイルに移動して import する純粋なリファクタリング
- **段階的**: 1モジュールずつ抽出し、各段階でテストがパスすることを確認

## 深掘り結果（2026-07-13）
ファイル分割は不要。関数シグネチャの引数化で十分。変更量が最小でテスト可能になる。
→ 詳細は [設計ドキュメント](../docs/superpowers/specs/2026-07-13-sqlite-history-panel-deepening-design.md) 参照

## 見積もり
1 ストーリーポイント（関数シグネチャの引数化 + 単体テスト追加）

## 技術的考慮事項
- **依存関係**: PBI #1 完了後が望ましいが、独立して着手可能
- **テスタビリティ**: 抽出後の各モジュールは DOM 非依存でテスト可能
- **非機能要件**: UI のパフォーマンス劣化なし（関数呼び出しのオーバーヘッドは無視できる）
- **ADR参照**: 特になし

## 実装者向け注記

### 現状コードの確認
```bash
# 抽出対象の関数を確認
rg -n "^function " src/dashboard/sqliteHistoryPanel.ts
# 各行数のおおよその分布
wc -l src/dashboard/sqliteHistoryPanel.ts
```

### 実装手順
1. `src/dashboard/CalendarWidget.ts` を作成: `renderCalendarNav`, `handleDateSelect`, `dateRangeFromSelected`, `formatDate`, `_getMonthDateRange` を抽出
2. `src/dashboard/DiagnosticFormatter.ts` を作成: `formatDiagnosticMetadataHtml`, `buildCleansingProgressBarHtml` を抽出
3. `src/dashboard/StorageEnricher.ts` を作成: `enrichEntryWithChromeStorage`, `getChromeStorageLookup`, `_invalidateChromeStorageCache` を抽出
4. `src/dashboard/EntryRenderer.ts` を作成: `renderEntryList` を抽出（ただし DOM アクセス用の要素IDは引数で受け取る）
5. `sqliteHistoryPanel.ts` で各モジュールを import して呼び出すだけにする

### 落とし穴
- `CalendarWidget` は `state.selectedDate` を直接参照している。抽出時は状態を引数で受け取るか、コールバックでパネルに通知する設計にする
- `renderCalendarNav()` 内の `document.getElementById` 呼び出しはパネルから要素を渡す形に変更
- `escapeHtml` と `debounce` は汎用ユーティリティなので `src/dashboard/utils/` に移動
- テスト用の `_test` エクスポートは移行先モジュールでも維持する

## Definition of Done
- [ ] 4つの抽出モジュールが作成されている
- [ ] sqliteHistoryPanel.ts が 400 行以下
- [ ] 各抽出モジュールに対応する単体テストが存在しパスする
- [ ] 既存の全テストがパスする
- [ ] `npm run build` が成功する
- [ ] コードレビュー完了
