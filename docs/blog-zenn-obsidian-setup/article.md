---
title: "ブラウザで読んだページをObsidianに自動保存するChrome拡張「Yasumaro」を使ってみた"
emoji: "🗒️"
type: "tech"
topics: ["obsidian", "chrome拡張", "pkm", "生産性"]
published: false
---

気になる記事をブックマークしても、あとで見返すことはほぼありません。

「あとで読む」フォルダは増えるのに、中身を開くことはなくなっていく。そういう経験を繰り返した末に、YasumaroというChrome拡張を使い始めました。ブラウザで読んだWebページを、AIが要約してObsidianのデイリーノートに自動で書き込んでくれます。

「あの記事どこだっけ」が、ObsidianのFTS5全文検索で一発で終わるようになりました。

---

## いそがしい人向けの結論

- **何ができるか**: 読んだWebページをAI要約付きでObsidianデイリーノートに自動保存
- **所要時間**: 初期設定まで約10分
- **インストール**: [Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)
- **必要なもの**: Obsidian + Local REST API with MCPプラグイン + AIプロバイダーのAPIキー（Groqなら無料）

---

## Obsidianに自動保存される、ということ

Yasumaroを入れる前は、気になったページをどこかに記録しようとするたびに手が止まっていました。コピーしてObsidianに貼る、タイトルを書く、タグをつける——この一連の作業が面倒で、結局ブックマークだけして終わりになっていたのです。

Yasumaroはこの摩擦をなくします。

ページを読んでいるあいだ、拡張機能がバックグラウンドで動いています。一定条件（デフォルトは5秒以上滞在かつスクロール50%以上）を満たすと、ページのURLとタイトル、AIが生成した要約が自動的にObsidianのデイリーノートに追記されます。

```
# 2026-06-28

## Yasumaro

- [なぜLLMは「考える」のか——Transformerの注意機構を図解する](https://example.com/llm-attention)
  - AIによる要約: Self-Attentionの直感的な説明。クエリ・キー・バリューの役割と、なぜこの仕組みが「文脈の理解」に有効なのかを図解している。読んで損のない入門記事。
```

こういうエントリが、読んだページの数だけデイリーノートに積み上がっていきます。1週間後に「あの記事どこだっけ」となっても、Obsidianで検索すれば出てきます。

---

## セットアップは3ステップ、約10分

### 1. ObsidianにLocal REST API with MCPプラグインを入れる

YasumaroはObsidianのLocal REST API with MCPプラグインを経由してデイリーノートに書き込みます。プラグインなしには動きません。

Obsidianの設定 → コミュニティプラグイン → 閲覧 で「Local REST API with MCP」を検索してインストール・有効化します。有効化するとAPIキーが自動生成されます。

> 以前は「Local REST API」という名称でしたが、現在は「Local REST API with MCP」に改名されています。

詳しいインストール手順とトラブルシューティングは、別途まとめた[Obsidian連携ガイド](https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md)を参照してください。証明書エラーの対処法など、初回設定で詰まりやすいポイントをまとめています。

### 2. Chrome拡張をインストールする

[Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)からインストールします。

![TODO: Chrome Web StoreのYasumaroページ](./images/cws-yasumaro.png)

### 3. APIキーをダッシュボードに貼る

拡張機能のアイコン → ⚙ アイコン → ダッシュボードを開きます。「Obsidian API Key」フィールドに、プラグインで生成されたAPIキーを貼り付けて保存します。「Obsidian テスト」ボタンで接続を確認できます。

![TODO: YasumaroダッシュボードにAPIキーを入力した状態](./images/yasumaro-dashboard.png)

AIプロバイダーの設定も同じ画面で行います。[Groq](https://console.groq.com/keys)は無料でAPIキーを取得でき、速度も十分です。

---

## 自動記録の条件とカスタマイズ

デフォルトの記録条件は「**5秒以上滞在かつスクロール50%以上**」です。通り過ぎただけのページは記録せず、ある程度読んだページだけを残す、という意図の設計です。

この条件はダッシュボードの「記録条件」パネルから変更できます。

| 設定項目 | デフォルト | 変更例 |
|---------|-----------|--------|
| 最小滞在時間 | 5秒 | 30秒（じっくり読んだページだけ残したい場合） |
| 最小スクロール深度 | 50% | 80%（ほぼ読み切ったページだけ残したい場合） |

ドメインフィルターも設定できます。記録したくないドメイン（SNS、メール、銀行など）をブラックリストに入れておけば、プライベートなページが混入しません。

---

## デイリーノートに溜まっていく様子

1週間使い続けると、デイリーノートがこんな状態になります。

![TODO: Obsidianのデイリーノートに記録が蓄積されている様子](./images/obsidian-dailynote.png)

読んだページがAI要約付きで時系列に並んでいて、全文検索もかかります。「先週読んだあの記事」を探すとき、ブラウザ履歴よりも確実に見つかります。ブラウザ履歴はURLだけですが、こちらには要約テキストがあるので、うろ覚えのキーワードでも引っかかります。

---

## よくある詰まりポイント

**Q. 接続テストで証明書エラーが出る**

Local REST API with MCPはデフォルトでhttpsを使い、自己署名証明書を利用します。Chromeが初回に警告を出すことがあります。Chrome で `https://127.0.0.1:27124` を直接開いて「詳細設定」→「127.0.0.1 にアクセスする（安全でない）」をクリックすると解消します。これはローカル環境限定の操作です。一般的な証明書警告を無視することとは異なります。

**Q. Daily Note Pathをどう設定すればよいか分からない**

Obsidianのデイリーノートが保存されているフォルダパスを入力します。Vault直下なら空欄、`Journal/` フォルダなら `Journal` と入力します。Obsidianの「デイリーノート」プラグイン設定の「新しいノートの保存場所」に表示されているフォルダ名と一致させてください。

詳しくは[Obsidian連携ガイドのトラブルシューティング](https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md#トラブルシューティング)を参照してください。

---

## Obsidianを使っているなら試す価値はあります

Webクリッパーやあとで読むサービスを試してきたけれど定着しなかった、という人には刺さります。保存の摩擦がゼロになると、記録することを考えなくなります。読むことに集中できて、あとから探せばいい、という状態になります。

AIによる要約の品質は、プロバイダーとモデルの選択で変わります。Groqの `llama-3.3-70b-versatile` は無料で使えて、要約の精度も実用的です。

- [Chrome Web Storeからインストール](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)
- [GitHubリポジトリ](https://github.com/armaniacs/yasumaro)
- [Obsidian連携ガイド（詳細設定・トラブルシューティング）](https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md)
