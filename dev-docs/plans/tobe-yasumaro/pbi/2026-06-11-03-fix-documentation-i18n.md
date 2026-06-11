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
- [ ] README.mdにSQLite機能の特徴を追加
- [ ] README.md, AGENTS.md, SETUP_GUIDE.mdのビルド出力パスを更新
- [ ] CONTRIBUTING.mdをWXT/SQLite移行に合わせて更新
- [ ] ブランド改名のユーザー通知バナーを実装
- [ ] sqliteHistoryPanel.tsのハードコード文字列をgetMessage()に置換
- [ ] exportLogsService.tsの日付フォーマットをタイムゾーン対応
- [ ] 全UI文字列がi18nキー経由になる

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

### 実装手順
1. README.mdにSQLite機能の特徴を追加
2. README.md, AGENTS.md, SETUP_GUIDE.mdのビルド出力パスを更新（WXT v0.20の実際を確認）
3. CONTRIBUTING.mdをWXT/SQLite移行に合わせて更新
4. ブランド改名のユーザー通知バナーを実装（popup/permissions）
5. sqliteHistoryPanel.tsのハードコード文字列をgetMessage()に置換
6. exportLogsService.tsの日付フォーマットをtoLocaleDateString()に変更

### 落とし穴
- WXT v0.20の実際の出力パスを確認する必要がある（ビルドして確認）
- i18nキーは既にmessages.jsonに追加済み（前セッション）→ 代码側の置換のみ
- 日付フォーマットのタイムゾーン対応はIntl.DateTimeFormatを使用
- ブランド改名通知はonInstalledフックで実装

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（README, AGENTS, SETUP_GUIDE, CONTRIBUTING）
