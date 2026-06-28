# PBI: Obsidian連携ガイドドキュメントの新規作成

## ユーザーストーリー

Obsidianを初めてYasumaroと連携するユーザーとして、Local REST APIプラグインの設定方法を一から丁寧に説明したガイドドキュメントがほしい、なぜなら現在の `docs/SETUP_GUIDE.md` にはObsidian側の設定が1〜2行で完結しており、初めて使うユーザーが迷うポイント（証明書エラー、ポート番号、APIキーのコピー方法）をカバーしていないからだ。

## ビジネス価値

- Obsidian連携のセットアップ失敗によるユーザー離脱を減らす
- サポート問合せ（「接続できない」「APIキーが分からない」）の削減
- Obsidianユーザー層への訴求力強化

## 前提条件（ガイドに明記すること）

ガイドの冒頭に以下の前提条件を明示すること：
- Obsidianがインストール済みであること（[obsidian.md](https://obsidian.md/)からダウンロード）
- Obsidian Vaultが作成済みであること（初回起動時に作成）
- Yasumaroが Chrome にインストール済みであること
- Google Chrome ブラウザを使用していること

## BDD受け入れシナリオ

```gherkin
Scenario: 新規ユーザーがObsidian側の設定を完了できる
  Given YasumaroをChrome Web Storeからインストールしたばかりのユーザーがいる
  And そのユーザーはObsidianを使っているがLocal REST APIプラグインを未インストールである
  When ユーザーがガイドドキュメントを読み進める
  Then Obsidianコミュニティプラグインのインストール手順がスクリーンショット付きで記載されており
  And APIキーのコピー場所が明示されており
  And プロトコル(https)・ポート(27124)のデフォルト値と変更が不要な理由が説明されており
  And 自己署名証明書エラーへの対処法が「ローカル環境限定の操作」として記載されている

Scenario: 英語ユーザーも同じガイドを参照できる
  Given ガイドドキュメントを開く
  When English セクションまでスクロールする
  Then English セクションが存在し、日本語と同等の情報・同じセクション構成が英語で記載されている

Scenario: 証明書エラーで行き詰まったユーザーが対処できる
  Given ユーザーがhttpsプロトコルで接続テストを実行した
  When 「証明書エラー」でテスト失敗の通知が届く
  Then トラブルシューティングセクションに「https://127.0.0.1:27124 を Chrome で開いて証明書を許可する手順」が記載されており
  And httpへのフォールバック手順も案内されている
  And 「この操作はローカル環境（Obsidian）限定であり、一般的な証明書警告の無視を推奨するものではない」旨が明示されている
```

## 受け入れ基準

### ドキュメント構成（DoDに列挙するセクション）

`docs/OBSIDIAN_SETUP_GUIDE.md` は以下のセクション構成で作成すること：

```
# Obsidian 連携ガイド / Obsidian Integration Guide
[日本語](#日本語) | [English](#english)

## 日本語

### 前提条件
### 1. Local REST API プラグインのインストール
  （スクリーンショット: 設定→コミュニティプラグイン→閲覧）
  （スクリーンショット: 「Local REST API」の検索・インストール）
### 2. APIキーのコピー
  （スクリーンショット: 設定→Local REST API→APIキーの場所）
### 3. プロトコルとポートの確認
### 4. Daily Note Pathの設定
### 5. Yasumaroダッシュボードへの入力と接続テスト
### トラブルシューティング
  #### 証明書エラー（self-signed certificate）
  #### 接続タイムアウト
  #### Daily Note Pathが正しく認識されない

## English
（同構成）
```

### チェックリスト

- [ ] `docs/OBSIDIAN_SETUP_GUIDE.md` が上記セクション構成で作成される
- [ ] バイリンガル（日本語 / English）形式で構成される（`docs/i18n-guide.md` の規約に準拠）
- [ ] スクリーンショットを含む（最低3枚: プラグイン検索・インストール完了・APIキーのコピー）
- [ ] ガイド冒頭に前提条件（Obsidianインストール済み・Vault作成済み）が明記されている
- [ ] プロトコル・ポートのデフォルト値（https/27124）と変更が必要なケースが記載されている
- [ ] 自己署名証明書エラーの対処法が「ローカル環境限定の操作」というスコープ明示付きで記載されている
  - 対象OS: macOS / Windows を最低限カバーすること（Linux はオプション）
- [ ] Daily Note Pathの設定例（`Journal`、`092.Daily` など複数例）が記載されている
- [ ] 接続テスト（Obsidianテストボタン）の確認方法が記載されている
- [ ] `docs/SETUP_GUIDE.md` の既存Obsidianセクション（Step 1）を「詳細は OBSIDIAN_SETUP_GUIDE.md 参照」の1行リンクに置き換える（Single Source of Truth）
- [ ] `README.md` の関連セクションにこのドキュメントへのリンクを追加する
- [ ] `AGENTS.md` のUser-Facing Documentationテーブルに `docs/OBSIDIAN_SETUP_GUIDE.md` を追記する
- [ ] 日英セクションの手順番号・見出し構成が一致していること

## テスト戦略

このPBIはドキュメント作成が主目的のため、自動テストは不要。代わりに以下でレビューする：

### レビューチェックリスト
- [ ] Obsidian未経験者に読んでもらい、手順通りに進められることを確認
- [ ] Markdown Lintエラーがないこと（`npx markdownlint-cli docs/OBSIDIAN_SETUP_GUIDE.md` で確認）
  - ※ `markdownlint-cli` がdevDependenciesに未インストールの場合は追加すること
- [ ] 全リンクが有効であること
- [ ] 日本語・英語の見出し構成・手順番号が一致していること
- [ ] スクリーンショットのalt属性が記述されていること（アクセシビリティ）

## 実装アプローチ

1. `docs/SETUP_GUIDE.md` の Step 1（Obsidianのセットアップ）を確認し、重複する内容を洗い出す
2. `docs/OBSIDIAN_SETUP_GUIDE.md` を上記セクション構成で新規作成する
3. `docs/SETUP_GUIDE.md` の Step 1 を「詳細は [Obsidian連携ガイド](OBSIDIAN_SETUP_GUIDE.md) を参照」の1行に置き換える
4. `README.md` と `AGENTS.md` のドキュメント一覧を更新する

## 見積もり

3pt（スクリーンショット撮影・日英作成・既存ドキュメント修正を含む）

## 技術的考慮事項

- 依存関係: なし（PBI 02 はこのドキュメントのURL確定後にマージ）
- 非機能要件: バイリンガル形式必須（`docs/i18n-guide.md` 参照）
- スコープ: 対象OSはmacOS/Windows。Linux手順はオプションとして「確認中」と明記でよい

## 実装者向け注記

### 現状コードの確認

```bash
# Obsidian関連の既存ドキュメントを確認
grep -n "Local REST API\|Obsidianのセットアップ" docs/SETUP_GUIDE.md

# Markdown Lint 環境の確認
ls node_modules/.bin/markdownlint 2>/dev/null || echo "要インストール: npm install --save-dev markdownlint-cli"
```

### 参考リソース
- Obsidian Local REST API プラグイン: https://github.com/coddingtonbear/obsidian-local-rest-api
- 証明書許可手順: ユーザーが `https://127.0.0.1:27124` に Chrome で直接アクセスし、「詳細設定」→「127.0.0.1 にアクセスする（安全でない）」をクリックする手順を記載すること
- **重要**: 「証明書警告は無視してよい」という一般論ではなく、「Obsidian Local REST API のローカル自己署名証明書に限定した操作」として明示すること

### 落とし穴
- Obsidian Local REST APIはデフォルトで自己署名証明書を使用するため、初回は必ずChromeで証明書許可が必要
- httpとhttpsでポートが異なる場合があるため、その点を明記すること（https: 27124、http: 27123がデフォルト）
- `docs/SETUP_GUIDE.md` のStep 1を削除せず「1行リンク」に置き換えること（既存ユーザーの参照を壊さない）

## Definition of Done

- [ ] `docs/OBSIDIAN_SETUP_GUIDE.md` が上記セクション構成で作成され、受け入れ基準を満たす
- [ ] スクリーンショット最低3枚が含まれている
- [ ] `docs/SETUP_GUIDE.md` の Step 1 が1行リンクに置き換えられている（Single Source of Truth）
- [ ] `README.md` への参照リンク追加済み
- [ ] `AGENTS.md` のドキュメント一覧テーブルに追記済み
- [ ] Markdown Lintエラーがゼロ
- [ ] 日英セクションの構成・手順番号が一致
- [ ] コードレビュー完了
- [ ] このPBIがマージ済みであることを確認後、PBI 02（ダッシュボードUIリンク追加）をマージ可能にする
