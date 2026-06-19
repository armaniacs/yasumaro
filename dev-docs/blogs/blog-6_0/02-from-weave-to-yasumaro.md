---
title: "Obsidian Weave から Yasumaro へ — ブラウザの記録を、もっと自由に"
emoji: "🦋"
type: "tech"
topics: ["chrome拡張機能", "obsidian", "ai", "sqlite", "プロダクト開発"]
published: false
---

半年前、私は Chrome 拡張機能「Obsidian Weave」を作りました。

ウェブページを自動で要約し、Obsidian のデイリーノートに保存するツールです。開発者の情報収集に便利だということで、一定のユーザーさんにも使っていただいていました。

しかし、使い続けるうちに一度、こんな気づきがありました。

> 「Obsidian を開いていないとき、記録したデータはどこにあるんだっけ。」

答えは「どこにもありませんでした」。Obsidian が起動していないと、要約結果は一時的なストレージに留まり、history として存在した形跡を残しませんでした。

その体験が、Obsidian Weave から Yasumaro への進化の起点となりました。

## Obsidian Weave が解決してきたこと

Obsidian Weave は、ブラウザで読んだページを「実際に読んだものだけ」記録する仕組みでした。

- 5秒以上滞在し、50%以上スクロールしたページのみ対象
- AI による自動要約（Groq / Gemini / OpenAI 対応）
- Obsidian のデイリーノートへの自動追記
- ドメインフィルター、PII マスキング、Trust Database によるサイト判定

これらは Yasumaro でも引き続き利用できます。Obsidian Weave で培った「ノイズを減らして本当に読んだものだけを残す」思想は、そのまま受け継がれています。

## なぜ名前を変えたか

ただ、Obsidian Weave という名前には壁がありました。

Minecraft の Mod として同名のライブラリが存在し、Obsidian 公式コミュニティプラグインにも「Weave」という名称のものがありました。Chrome Web Store での公開を見据えると、この名前のままでは混乱を招くと判断しました。

新しい名前は「Yasumaro（ヤスマロ）」です。古事記を編纂した太安万侶（おおのやすまろ）に由来しています。

稗田阿礼が「記憶する者」なら、太安万侶はそれを「記録（システム）に落とし込んだ者」です。流動的なブラウジング体験を、構造化された不変の記録に変換するというツールの性質に、ぴったり重なる名前だと感じています。

## Yasumaro で変わったこと

名前の変更だけではありません。アーキテクチャの中心に SQLite を据えたことで、ツールの性質が大きく変わりました。

### Obsidian なしでも動作する

Yasumaro は、Obsidian Local REST API に依存しなくなりました。AI 要約結果はまず拡張機能内の SQLite に保存されます。Obsidian が起動していれば並行して追記されますが、しなくても SQLite 上のデータは永続化されます。

これにより、「Obsidian を使っていない開発者」や「メモ環境が VS Code や Notion の人」も気軽に導入できるようになりました。

### データが消えなくなった

Obsidian Weave では、URL 履歴が一定件数を超えると古いものから自動削除されていました。chrome.storage.local の容量制限への対処でした。

Yasumaro では SQLite + OPFS の組み合わせにより、データを無制限に近い形で蓄積できます。ユーザーが明示的に削除するまでは、要約とメタデータが残り続けます。

### 全文検索が使えるようになった

蓄積したデータの価値を引き出すため、FTS5 全文検索を実装しました。日本語でも3文字以上の部分一致検索が可能です。「あの記事、なんだったっけ」という問いに、検索バーで答えられます。

### ダッシュボードが本格的になった

履歴の一覧表示、カレンダー表示、一括エクスポート、選択した記事の Obsidian への追記など、ダッシュボード単体で完結する機能が大幅に増えました。

## 移行はスムーズに設計した

既存の Obsidian Weave ユーザーが Yasumaro にアップデートしても、過去の履歴データは失われません。初回起動時に、chrome.storage.local に蓄積された旧データが自動的に SQLite に移行されます。

Obsidian 連携の設定もそのまま引き継がれます。ユーザーが意識しなくても、裏側でデータ構造がアップグレードされる設計です。

## どちらを使えばいいか

Obsidian Weave は事実上、Yasumaro に統合されました。新規に導入する場合は Yasumaro をお使いください。

Obsidian Weave をすでに使っている場合は、次回アップデートで自動的に Yasumaro へ移行されます。手作業での移行作業は不要です。

## まとめ

Obsidian Weave は「Obsidian にデータを流し込む」ツールでした。Yasumaro は「ブラウザ内でデータを蓄積し、Obsidian も選択肢の一つにする」ツールです。

記録の主体が「Obsidian」から「あなた自身」に移ったことで、自由度が大きく広がりました。

ブラウジングの記録を、もっと自由に。それが Yasumaro です。

---

## 関連リンク

- [Yasumaro - GitHub](https://github.com/armaniacs/yasumaro)
- [Obsidian Weave からの移行ガイド](https://github.com/armaniacs/yasumaro/blob/main/docs/SETUP_GUIDE.md)
