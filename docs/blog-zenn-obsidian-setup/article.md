---
title: "ブラウザで読んだページをObsidianに自動保存するChrome拡張「Yasumaro」を使ってみた"
emoji: "📝"
type: "tech"
topics: ["obsidian", "chrome拡張", "pkm", "生産性"]
published: false
---

## いそがしい人向けの結論

Yasumaro は、読んだ Web ページの情報を自動的に Obsidian のデイリーノートに保存してくれる Chrome 拡張機能です。

- **セットアップ時間**: 約10分
- **必要なもの**: Obsidian + Chrome + Local REST API プラグイン
- **できること**: 30秒以上滞在したページのタイトル・URL・要約を自動保存
- **インストール**: [Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)

---

## Obsidianに自動保存される、ということ

気になる記事を見つけたら、とりあえずブックマーク。あとで読もうと思って溜め込んだタブ、あなたはいくつありますか？

私はというと、ブックマークの数が500を超えても「そのうち整理しよう」と言い続けていました。そして気づいたのです。ブックマークは「保存」するだけで「見返す」仕組みにはなっていない、と。

Obsidian を使っているなら、全文検索が効く形で記録を残したい。でも、いちいち手動でコピペするのは面倒。Readwise のようなサービスもありますが、月額課金が続くかどうかは別問題です。

Yasumaro はこの問題に対して「ブラウジングのついでに、Obsidian に自動で送る」という答えを出しています。しかも Local REST API 経由のローカル通信なので、データが外部に出ることもありません。

---

## セットアップは3ステップ

実際のセットアップはとても簡単です。詳細な手順は [Obsidian連携ガイド](https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md) にまとめていますが、大まかな流れだけ紹介します。

### 1. Local REST API プラグインを入れる

Obsidian の設定 → コミュニティプラグイン → 閲覧 から「Local REST API」を検索してインストール、有効化します。

ここで生成される API キーをコピーしておきます。これが Yasumaro と Obsidian の間の認証情報になります。

### 2. Chrome 拡張をインストールする

[Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc) からインストールするだけです。ソースからビルドする必要はありません。

### 3. APIキーをダッシュボードに貼る

拡張機能のアイコンを右クリック → オプション でダッシュボードを開き、「Obsidian を使う」にチェックを入れて、API キーと Obsidian の URL、Daily Note Path を入力します。

**接続テスト** ボタンを押して ✓ 成功と表示されれば完了です。

![TODO: ダッシュボード設定画面のスクリーンショット](images/dashboard-settings.png)

---

## 自動記録の条件

「ブラウジング中に逐一保存ダイアログが出るのでは？」と心配になるかもしれませんが、そんなことはありません。Yasumaro は以下の条件をすべて満たしたときだけ記録します：

| 条件 | デフォルト値 | なぜ必要か |
|------|------------|-----------|
| ページ滞在時間 | 30秒以上 | 一瞬通り過ぎたページを記録しないため |
| スクロール深さ | 50%以上 | 広告ページを弾くため |
| 重複チェック | 同一URLは上書き | 同じページを何度も記録しないため |

これらの条件はダッシュボードで変更できます。私は滞在時間を10秒、スクロールを30%に緩めて使っています。「読んだ」というより「目にした」くらいの感覚で残したいからです。

また、ページ内容の要約には AI を使うこともできます。Gemini・OpenAI・Groq などに対応しており、ローカル LLM（Ollama）も選べます。私は Ollama で動かしていますが、API キー不要で気軽に試せるのがいいところです。

---

## Obsidianのデイリーノートに溜まっていく様子

セットアップが終われば、あとは普段通りブラウジングするだけです。30秒以上見たページが、こんな感じで Obsidian のデイリーノートに自動で蓄積されていきます。

![TODO: Obsidianデイリーノートに記録が溜まっているスクリーンショット](images/obsidian-daily-note.png)

「あの記事、先週見たんだけどなんだったっけ」というときも、Obsidian の全文検索で一発です。ブックマークを整理する必要も、フォルダ分けに悩む必要もありません。見た時間軸で並んでいるので、「そういえば月曜の昼休みに見たあれ」という記憶の手がかりで探せます。

---

## よくある詰まりポイント

### Q. 証明書エラーが出て接続できない

A. 大丈夫です。よくある話です。

Local REST API プラグインは自己署名証明書を使っています。初回だけ Chrome で証明書を許可する必要があります。

`https://127.0.0.1:27124` を Chrome で開いて、「詳細設定」→「127.0.0.1 にアクセスする（安全でない）」をクリックすれば解決します。

> この操作は Obsidian Local REST API というローカル環境限定のツールのものです。一般の Web サイトで証明書を無視しないでください。

### Q. Daily Note Path って何を入れればいい？

A. Obsidian の Daily Note プラグインで「新建作成場所」に指定しているフォルダ名です。

たとえば `DailyNotes/2026-06-29.md` という形で保存されているなら、`DailyNotes` と入力します。`Journal` フォルダを使っているなら `Journal` です。

### Q. 接続テストがタイムアウトする

A. 以下を順に確認してください。

1. Obsidian が起動していますか？
2. Local REST API プラグインは有効化されていますか？
3. URL は `https://127.0.0.1:27124` ですか？
4. ファイアウォールでポートがブロックされていませんか？

詳細なトラブルシューティングは [Obsidian連携ガイド](https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md) にまとめてあります。

---

## まとめ

Yasumaro は「読んだページを Obsidian に自動保存する」という単一の目的に特化した拡張機能です。

- セットアップは10分
- 条件フィルタで記録するページを制御できる
- データはすべてローカル（Obsidian Local REST API 経由）
- AI 要約も使えるが必須ではない

「ブックマークはするけど見返さない」という問題に、Obsidian の全文検索と自動保存で答えを出しています。興味があれば、ぜひ一度試してみてください。

インストールはこちら → [Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)
ソースコードと詳しいドキュメント → [GitHub](https://github.com/armaniacs/yasumaro)
