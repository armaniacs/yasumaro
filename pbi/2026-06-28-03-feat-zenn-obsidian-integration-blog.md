# PBI: Zenn向けブログ記事「Obsidian×YasumaroでWebの読書記録を自動化する」執筆

## ユーザーストーリー

YasumaroのZennブロガー（ar）として、Obsidian連携のセットアップ体験をZennに投稿したい、なぜならObsidianユーザーが「こんなChrome拡張があるのか」と気づく経路が今はほぼなく、ガイドドキュメント（PBI 01成果物）への流入導線を作ることが最大の集客施策だからだ。

## ビジネス価値

- Chrome Web Store以外のインストール流入経路の確立
- Obsidianコミュニティへのリーチ（Zennの「Obsidian」タグはアクティブ）
- PBI 01で作ったガイドドキュメントへのリンクが機能する導線になる

## 依存関係

**PBI 01（Obsidian連携ガイドドキュメント作成）が完了・マージ済みであること。**
記事本文からガイドドキュメントにリンクするため、リンク先が存在しない状態で公開しないこと。

## 記事の基本設計

### 想定読者

- Obsidianを使っていて、読んだWebページを記録したい人
- 「Webクリッパー」「Readwiseの代替」を探している人
- Chrome拡張でObsidianに自動保存したいが、ツールを知らない人
- 技術レベル: Obsidianのコミュニティプラグインを自分でインストールできる程度

### 切り口・タイトル案

**メインタイトル**（Zennのタグ検索・SEOを意識）:
```
ブラウザで読んだページをObsidianに自動保存する Chrome拡張「Yasumaro」を使ってみた
```

**サブタイトル（本文冒頭）で引く体験**:
```
（良い例）
気になる記事をブックマークしても、あとで見返すことはほぼありません。
Yasumaroを入れてから、「あの記事どこだっけ」がObsidianの全文検索一発で終わるようになりました。
```

### 構成案

```
## いそがしい人向けの結論
（インストールリンク・所要時間・何ができるか1行）

## Obsidianに自動保存される、ということ
（体験から入る。何がどう変わったか）

## セットアップは3ステップ
1. Local REST API プラグインを入れる
2. Chrome拡張をインストールする
3. APIキーをダッシュボードに貼る
（→ 詳細はガイドドキュメントへリンク）

## 自動記録の条件
（30秒滞在・スクロールなど、設定できること）

## Obsidianのデイリーノートに溜まっていく様子
（スクリーンショット）

## よくある詰まりポイント
Q. 証明書エラーが出る
Q. Daily Note Pathが分からない
（→ ガイドドキュメントのトラブルシューティングへリンク）

## まとめ・インストールリンク
```

### arスタイルの文体指針（tone.md より）

- 導入は「体験・疑問から」入る（「本記事では〜」と始めない）
- 「なぜ」を必ず書く（なぜLocal REST APIが必要か、なぜhttpsか）
- 短文と長文を交互に。箇条書きより表か短文を優先
- ですます調

## BDD受け入れシナリオ

```gherkin
Scenario: 記事を読んだObsidianユーザーがYasumaroをインストールできる
  Given Zennで「Obsidian Chrome拡張」を検索したユーザーが記事を見つける
  When 記事を最後まで読む
  Then Chrome Web Storeへのインストールリンクが分かり
  And ガイドドキュメントへのリンクからLocal REST APIの設定手順に辿り着ける
  And 所要時間（目安10分）が記事冒頭に明示されている

Scenario: 証明書エラーで詰まったユーザーが解決できる
  Given ユーザーが記事を読んでセットアップ中に証明書エラーに遭遇する
  When 記事の「よくある詰まりポイント」セクションを確認する
  Then トラブルシューティングへのリンクが記載されており、解決手順に辿り着ける
```

## 受け入れ基準

- [ ] 記事ファイルが `docs/blog-zenn-obsidian-setup/article.md` として作成される
- [ ] 上記構成案のセクションを網羅している
- [ ] arスタイル（tone.md）に準拠している（導入が体験から始まる・ですます調）
- [ ] Chrome Web Store インストールリンクが記事内に含まれる
- [ ] PBI 01 で作成した `docs/OBSIDIAN_SETUP_GUIDE.md` への GitHub リンクが含まれる
- [ ] 「よくある詰まりポイント」に証明書エラー・Daily Note Pathの2点を含む
- [ ] Zenn用フロントマター（`---` title/topics/type/published）が正しく設定されている
  - `topics: ["obsidian", "chrome拡張", "pkm", "生産性"]`
  - `type: "tech"`
  - `published: false`（公開前レビュー用）
- [ ] セットアップの所要時間目安（約10分）が冒頭に明記されている
- [ ] スクリーンショット挿入箇所が `![TODO: スクリーンショット](./images/xxx.png)` でマークされている

## テスト戦略

自動テスト不要。以下でレビューする：

### レビューチェックリスト
- [ ] tone.mdのルールに準拠しているか（導入パターン・文末・見出し）
- [ ] UI名・設定値・バージョンが実装と一致しているか（CHANGELOG参照）
- [ ] ガイドドキュメント（PBI 01）へのリンクが正しいか
- [ ] Chrome Web Storeのリンクが正しいか
- [ ] Zennプレビューで崩れがないか（`npx zenn preview` で確認）

## 実装アプローチ

1. PBI 01 の `docs/OBSIDIAN_SETUP_GUIDE.md` を読み、記事と内容に矛盾がないか確認する
2. CHANGELOG の最新バージョン（現在 v6.3.4）を確認し、紹介する機能の正確なバージョンを把握する
3. 構成案に沿って `docs/blog-zenn-obsidian-setup/article.md` を執筆する
4. スクリーンショットが必要な箇所を `![TODO: ...]` でマークし、撮影リストを別途作成する

### arスキルの利用

執筆時は `/ar-blogging` スキルを活用する。モードは **A: Draft Polish** または **B: Code→Blog**（CHANGELOG素材から執筆する場合）。

## 見積もり

2pt（初稿執筆。スクリーンショット撮影は別タスク扱い）

## 技術的考慮事項

- 依存関係: PBI 01完了が必須（ガイドリンク確定のため）
- Zenn CLIが未インストールの場合: `npm install -g zenn-cli` → `npx zenn init`
- 記事保存先: `docs/blog-zenn-obsidian-setup/article.md`（リポジトリ管理）
- Zennへのアップロードはリポジトリ連携 or 手動投稿どちらでも可

## 実装者向け注記

### 執筆前に確認するファイル

```bash
# ガイドドキュメント（PBI 01成果物）
cat docs/OBSIDIAN_SETUP_GUIDE.md

# 最新バージョンと機能
head -80 CHANGELOG.md

# Chrome Web Store URL
grep -r "chromewebstore\|chrome.google.com/webstore" README.md | head -5

# arの文体ルール
# → .config/claude/skills/ar-blogging/references/tone.md 参照
```

### 記事に含めるリンク

| 目的 | URL |
|------|-----|
| Chrome Web Store | `https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc` |
| Obsidian連携ガイド（PBI 01） | `https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md` |
| GitHub | `https://github.com/armaniacs/yasumaro` |

### 落とし穴

- 「Obsidian Weave」「obsidian-smart-history」など旧称を記事中で使わないこと（AGENTS.mdの命名規則参照）
- 正式名称: `Yasumaro` / `Yasumaro - AI Browsing Logger`

## Definition of Done

- [ ] **PBI 01が完了・マージ済みであること**（前提条件）
- [ ] `docs/blog-zenn-obsidian-setup/article.md` が作成されている
- [ ] 受け入れ基準のチェックリストを全て満たしている
- [ ] tone.mdとの整合性レビュー完了
- [ ] Zennプレビューで崩れがないことを確認
- [ ] スクリーンショット挿入箇所が `![TODO: ...]` でマークされている
- [ ] コードレビュー完了（内容の正確性確認）
- [ ] Zenn公開は手動（このPBIのDoDには含めない）
