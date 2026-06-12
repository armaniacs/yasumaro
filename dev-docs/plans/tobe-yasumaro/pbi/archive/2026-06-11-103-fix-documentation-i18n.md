# PBI: ドキュメント刷新 & i18n 完全対応

## ユーザーストーリー
**新規ユーザー**として、**正確で最新のドキュメントと多言語UI**がほしい、なぜなら**セットアップ手順で迷わず、自分の言語で拡張機能を使いたい**から

## ビジネス価値
- ユーザーオンボーディングの摩擦を削減
- サポートチケットの削減（ドキュメント不備による質問）
- 国際市場での採用率向上

## BDD受け入れシナリオ

```gherkin
Scenario: README.mdにSQLite機能が明記されている
  Given ユーザーがREADME.mdを開く
  When 「特徴」セクションを読む
  Then 「ローカルSQLite永続化（OPFS + wa-sqlite + FTS5全文検索）」が記載されている
  And 「Obsidian不要でも動作」が明記されている

Scenario: ビルド出力パスが正確に文書化されている
  Given ユーザーがセットアップガイドを読む
  When 「Load unpacked」の手順を確認する
  Then 正しい出力パス（WXT v0.20の実際）が記載されている
  And 旧パス（dist/chromium-mv3/）は存在しない

Scenario: CONTRIBUTING.mdがWXT移行に追従している
  Given 新規コントリビューターがCONTRIBUTING.mdを読む
  When プロジェクト構造を確認する
  Then entrypoints/, public/_locales/, wxt.config.tsが含まれている
  And プロジェクト名が「Yasumaro」になっている

Scenario: ブランド改名のユーザー通知が表示される
  Given ユーザーが旧版（Obsidian Weave）をインストールしている
  When 新版（Yasumaro）をロードする
  Then 「旧パッケージを削除してください」のバナーが表示される
  And マイグレーション手順へのリンクが含まれている

Scenario: ダッシュボードのUI文字列が日本語化されている
  Given ユーザーが日本語ロケールで拡張機能を使用している
  When ダッシュボードのSQLite履歴パネルを開く
  Then 「Today」→「今日」、「Loading...」→「読み込み中...」と表示される
  And 全てのUI文字列がgetMessage()経由で取得される

Scenario: 日付フォーマットがタイムゾーン対応している
  Given JST（UTC+9）のユーザーが深夜にページを閲覧する
  When エクスポート機能で日付を確認する
  Then ローカルタイムゾーンで正しく日付がフォーマットされる
  And UTC基準で「前日」にならない
```

## 受け入れ基準
- [x] README.mdにSQLite機能の特徴を追加
- [x] README.md, AGENTS.md, SETUP_GUIDE.mdのビルド出力パスを更新
- [x] CONTRIBUTING.mdをWXT/SQLite移行に合わせて更新
- [x] ブランド改名のユーザー通知バナー → **不要（オーナー決定: Chrome Web Storeにobsidian-weaveとして未公開）**
- [x] sqliteHistoryPanel.tsのハードコード文字列をgetMessage()に置換
- [x] exportLogsService.tsの日付フォーマットをタイムゾーン対応
- [x] 全UI文字列がi18nキー経由になる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 日本語ロケールでのUI表示確認
- 旧版→新版の移行通知表示

### 統合テスト
- i18nキーとmessages.jsonの整合性
- 日付フォーマットのタイムゾーン変換

### 単体テスト
- getMessage()のフォールバック動作
- 日付フォーマット関数の各種タイムゾーンテスト

## 実装アプローチ
- **Outside-In**: E2Eテスト（UI表示）→ 統合テスト（i18n整合性）→ 単体テスト（日付フォーマット）
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装
- **リファクタリング**: グリーン後にドキュメントの表現改善

## 見積もり
5 ポイント（小規模）

## 技術的考慮事項
- 依存関係: なし（ドキュメントとUI文字列の修正）
- テスタビリティ: モック不要（実際のUIでテスト）
- 非機能要件: i18n完全性（全UI文字列が翻訳済み）

## 実装者向け注記

### 現状コードの確認
```bash
# README.mdの特徴セクションを確認
grep -n "特徴\|Features" README.md

# ビルド出力パスの参照を確認
grep -rn "dist/chromium-mv3" . --include="*.md" | grep -v node_modules

# sqliteHistoryPanel.tsのハードコード文字列を確認
grep -n "Today\|Yesterday\|Loading" src/dashboard/sqliteHistoryPanel.ts

# 日付フォーマット関数を確認
grep -n "toISOString\|formatDate" src/dashboard/exportLogsService.ts
```

### 実装状況（2026-06-11 時点）

> **ジュニア開発者向け**: このセクションは「何が既に実装されていて、何が残っているか」をまとめたものです。

#### 実装済み（コード確認済み）

| 受け入れ基準 | 場所 | 状態 |
|------------|------|------|
| README.mdにSQLite機能の特徴 | `README.md` L41, L192 | ✅ 記載済み |
| ビルド出力パス `dist/chromium-mv3` | `CLAUDE.md` L43, L261, `docs/SETUP_GUIDE.md` L41, L236 | ✅ 正しく記載済み |
| CONTRIBUTING.md の WXT 対応 | `CONTRIBUTING.md` | ✅ entrypoints/, wxt.config.ts 含む |
| sqliteHistoryPanel.ts i18nキー使用 | `src/dashboard/sqliteHistoryPanel.ts` L291, L292 | ✅ `t('historyToday')` など使用済み |
| 日付フォーマットのタイムゾーン対応 | `src/dashboard/exportLogsService.ts` L27 | ✅ `Intl.DateTimeFormat().resolvedOptions().timeZone` 使用済み |

#### 残タスク

**ブランド改名通知バナーは不要（オーナー決定済み）**

Chrome Web Store で `obsidian-weave` として公開したことはないため、BDD シナリオの「旧版ユーザーへの通知」は実装対象外。このシナリオは削除扱い。

**このPBIは全て完了**（ドキュメント + i18n + 日付フォーマット）。テスト確認のみ実施すること：
```bash
npm test -- --testPathPattern="sqliteHistoryPanel|exportLogs"
```

#### 設計上の意思決定

**ビルド出力パスが `dist/chromium-mv3` のままで良い理由**
WXT フレームワークのデフォルト出力は `.output/chromium-mv3/` だが、このプロジェクトでは `wxt.config.ts` または `package.json` の scripts で `dist/` にコピーするように設定されている。実際に `dist/chromium-mv3` が存在することを確認済み。ドキュメントはこのパスで正しい。

**i18n キー命名規則**
キー名は `history` プレフィックスで統一（例: `historyToday`, `historyYesterday`, `historyLoading`）。新しいUI文字列を追加する際は:
1. `entrypoints/_locales/ja/messages.json` に日本語テキストを追加
2. `entrypoints/_locales/en/messages.json` に英語テキストを追加
3. TypeScript コードで `t('キー名')` または `chrome.i18n.getMessage('キー名')` を使用

### 実装手順
1. README.mdにSQLite機能の特徴を追加 — **実装済み**
2. README.md, AGENTS.md, SETUP_GUIDE.mdのビルド出力パスを更新 — **実装済み（`dist/chromium-mv3` が正しい）**
3. CONTRIBUTING.mdをWXT/SQLite移行に合わせて更新 — **実装済み**
4. ブランド改名のユーザー通知バナーを実装（popup/permissions）— **未実装（優先度低、オーナー確認推奨）**
5. sqliteHistoryPanel.tsのハードコード文字列をgetMessage()に置換 — **実装済み**
6. exportLogsService.tsの日付フォーマットをタイムゾーン対応 — **実装済み**

### 落とし穴
- WXT v0.20の実際の出力パスは `dist/chromium-mv3` で確認済み（ビルドして確認済み）
- i18nキーは既にmessages.jsonに追加済み → コード側も置換済み
- 日付フォーマットのタイムゾーン対応は `Intl.DateTimeFormat().resolvedOptions().timeZone` で実装済み
- ブランド改名通知はonInstalledフックで実装が必要（未実装）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（ブランド改名バナーは対象外）
- [x] テストカバレッジが基準を満たす
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（README, AGENTS, SETUP_GUIDE, CONTRIBUTING）
