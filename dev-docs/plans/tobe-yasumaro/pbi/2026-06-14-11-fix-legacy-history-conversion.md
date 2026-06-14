# PBI: レガシー記録履歴 → SQLite 変換の改善（全フィールド移行＋手動 UX）

> 種別: fix/改善（既存 migrationService の取りこぼし修正＋UX 整備）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 進め方: **TDD 必須**

## ⚠️ 既実装あり（フェーズ0 確認結果）

この機能は**新規ではない**。以下が既存:
- `src/background/migrationService.ts`: `chrome.storage.local` → SQLite の一括移行
- `src/background/handlers/dashboardSqliteHandlers.ts`: `migrate` subtype ハンドラ
- `src/dashboard/dashboardSqliteService.ts:180` `migrateLogs()`: 手動再実行 API（confirm token 付き）

**ただし重大な取りこぼしがある:**
`migrationService.ts:73` 付近で各エントリを `title:null, summary:null, tags:null` でしか移行していない。一方 `SavedUrlEntry`（`src/utils/urlEntry.ts:23`）は `tags`, `aiSummary`, title 相当を保持している。→ AI 要約・タグが SQLite に移らず、検索価値が大きく損なわれている。

本 PBI は「再実装」ではなく**この取りこぼしの修正と手動 UX の確認**である。

## ユーザーストーリー

既存ユーザーとして、これまで蓄積した記録履歴（AI 要約・タグ込み）を設定画面のボタンで SQLite に取り込みたい、なぜなら SQLite History で過去ログも全文検索・閲覧したいからだ。

## ビジネス価値

- 既存ユーザーの蓄積データが SQLite 検索の対象になる（移行直後から価値が出る）
- 測定: 移行後、AI 要約・タグを含むレコードが FTS5 検索でヒットする

## BDD 受け入れシナリオ

```gherkin
Scenario: レガシー履歴を全フィールド込みで変換する
  Given chrome.storage.local に AI 要約とタグを持つ記録履歴が存在する
  And   設定画面（ダッシュボード）を開いている
  When  「SQLite へ変換」ボタンを押す
  Then  対象件数・取り込み成功・スキップ・失敗の件数が表示される
  And   変換後、各レコードの summary と tags が SQLite に保存され FTS5 で検索できる
  And   元の chrome.storage.local データは削除されず残っている

Scenario: 重複なく再実行できる（冪等）
  Given 一度変換を実行済み
  When  もう一度「SQLite へ変換」ボタンを押す
  Then  既存レコードは INSERT OR IGNORE でスキップされ、重複が発生しない
```

## 受け入れ基準

- [ ] `SavedUrlEntry` の `aiSummary`→`summary`、`tags`(配列)→`tags`、title→`title`、`timestamp`→`created_at`、url→url、domain を正しくマッピング
- [ ] 元データ（chrome.storage.local）を削除しない
- [ ] 再実行で重複が増えない（UNIQUE(url, created_at) + INSERT OR IGNORE）
- [ ] ダッシュボードに手動ボタンがあり、結果（read / inserted / skipped / failed 件数）を表示
- [ ] 変換失敗時もパイプライン全体は落ちず、失敗件数として可視化

## テスト戦略（t_wada スタイル）

### 統合テスト
- `migrate` ハンドラ：storage.local のサンプルデータ → SQLite 取り込み → 件数レポート
- 冪等性：2 回実行で件数が二重化しない

### 単体テスト
- `SavedUrlEntry` → `BrowsingLogRecord` マッピング（tags 配列の結合形式、aiSummary→summary、欠損フィールドの扱い）
- 空データ時 / 一部不正エントリ時の挙動
- 進捗・件数集計ロジック

### E2E / 手動
- ダッシュボードでボタン押下 → 件数表示 → SQLite History で検索ヒット

## 実装アプローチ

- Outside-In: 「ボタン押下で AI 要約付きレコードが検索可能になる」統合テストを先に失敗させる
- `migrationService.ts` のバッチ変換部のマッピングを修正（null 固定をやめる）
- tags 配列 → SQLite の TEXT 形式（既存 schema の `tags TEXT` に合わせる。区切り規約を既存 importLogs と統一）

## 見積もり

3〜5 pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし。**現状の IndexedDB VFS 上で完成させる**（OPFS 実装 PBI-12 を待たない）。これによりユーザーが早期に実データで SQLite History をテストできる
- OPFS 移行（PBI-12）後は、IndexedDB 上の変換済みデータは破棄し、本変換を再実行して OPFS 側へ再投入する（元データは残るため冪等に再現可能）
- `tags` の保存形式を既存 `importLogsService` / `sqliteHistoryPanel` の読み取りと一致させる
- `legacyStoreReadOnly` フラグの意味（読み取り専用化）と「元データを残す」方針の整合確認

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
sed -n '40,120p' src/background/migrationService.ts   # マッピング箇所
grep -rn "migrateLogs\|subtype: 'migrate'" src/dashboard/ src/background/
grep -n "interface SavedUrlEntry" -A 30 src/utils/urlEntry.ts
grep -rn "tags" src/dashboard/importLogsService.ts src/offscreen/sqlite.ts  # tags 形式の規約
```

### 落とし穴

- `tags` は配列。SQLite 側は TEXT。結合/分割の規約を全経路で統一しないと検索でズレる
- `migrationService` には status フラグ（pending/completed/fresh_install）がある。手動再実行（force）と自動 run の経路が別なので、両方でマッピング修正を反映する
- AI 要約のクレンジング済みバイト数など補助フィールドは SQLite schema にない。移行対象外として明示

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト化されパス
- [ ] マッピング修正の単体テスト・冪等性の統合テストがグリーン
- [ ] ダッシュボードでの手動変換を実機確認
- [ ] レビュー・リファクタリング完了
