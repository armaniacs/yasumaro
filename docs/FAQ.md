# よくある質問 / Frequently Asked Questions

[日本語](#日本語) | [English](#english)

---

## 日本語

### カテゴリ

- [基本・インストール](#基本インストール)
- [Obsidian 連携](#obsidian-連携)
- [AI 設定](#ai-設定)
- [プライバシーとデータ](#プライバシーとデータ)
- [記録の動作](#記録の動作)
- [トラブルシューティング](#トラブルシューティング)
- [その他の機能](#その他の機能)

---

### 基本・インストール

**Q1. Yasumaro という名前の由来は何ですか？**

『古事記』の編纂者、太安万侶（おおのやすまろ）に由来します。稗田阿礼が暗誦した膨大な記憶を文字に起こし、口承の言葉を永続的な記録へと変えた人物です。この拡張機能も同じように、ブラウザで目にした一時的なページを自動で記録に変え、あとから振り返れる形で残します。

**Q2. Yasumaro は何ができる拡張機能ですか？**

Yasumaro は、Chrome で閲覧した Web ページを自動または手動で記録し、AI が生成した要約とともに Obsidian のデイリーノートへ書き込む拡張機能です。履歴はデバイス上の SQLite データベースにも保存され、全文検索やフィルタリングができます。Obsidian を持っていなくても、履歴の閲覧・検索機能だけを使うことができます。

**Q3. Obsidian がなくても使えますか？**

使えます。Obsidian 連携はオプションです。ダッシュボードの「Obsidian を使う」チェックボックスをオフにしておけば、閲覧履歴はデバイス上の SQLite データベースにのみ記録されます。全文検索・スター付け・削除などの履歴管理機能はすべて使えます。

**Q4. AI プロバイダーのアカウントや API キーがないと使えませんか？**

AI 要約を使わないのであれば不要です。ダッシュボードで「AI Provider」を設定しなければ、要約なしでページの URL・タイトル・滞在時間だけが記録されます。また、「Record without AI」ボタンを使うと、AI 処理をスキップして Obsidian へ直接記録することもできます。

**Q5. Chrome 以外のブラウザでも使えますか？**

Yasumaro は Chrome Web Store に公開されており、Chrome にそのままインストールできます。加えて Microsoft Edge や Brave など Chromium 系ブラウザでも動作し、実際に作者自身も日常的に Microsoft Edge で使用しています。Chrome Web Store 経由でない場合は `npm run build:edge`、`npm run build:brave` で各ブラウザ用にビルドできます。Firefox 版もビルド可能ですが、主要サポートは Chromium 系です。

**Q6. スマートフォンの Chrome でも使えますか？**

モバイル Chrome では拡張機能自体がサポートされていないため、通常の使い方はできません。ただし、デスクトップ版でも一部の環境で OPFS（SQLite の保存先）が利用できない場合は、自動的に簡易ストレージモードに切り替わります。詳細は [STORAGE_MODES.md](STORAGE_MODES.md) をご覧ください。

**Q7. 拡張機能はどこからインストールできますか？**

[Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc) から直接インストールできます（推奨）。ソースからビルドしたい場合は [GitHub リポジトリ](https://github.com/armaniacs/yasumaro) をクローンし、`chrome://extensions` の「デベロッパーモード」→「パッケージ化されていない拡張機能を読み込む」から `npm run build` 後の `dist/chromium-mv3` フォルダを選択してください。詳細は [完全セットアップガイド](SETUP_GUIDE.md) をご覧ください。

---

### Obsidian 連携

**Q8. Obsidian との連携に必要なものは何ですか？**

Obsidian に「Local REST API」コミュニティプラグインをインストール・有効化し、そのプラグインが発行する API キーを Yasumaro ダッシュボードに登録する必要があります。手順の詳細は [Obsidian 連携ガイド](OBSIDIAN_SETUP_GUIDE.md) を参照してください。

**Q9. Daily Note Path とは何を指定すればよいですか？**

Obsidian Vault 内でデイリーノートが保存されているフォルダ名を入力します。たとえば `DailyNotes`、`Journal`、`092.Daily` のように Vault のルートからの相対パスを指定します。Obsidian の「デイリーノート」プラグイン設定の「新規作成場所」に表示されているフォルダ名と一致させてください。先頭のスラッシュ `/` は不要です。

**Q10. Obsidian の URL はデフォルトのまま使えますか？**

ほとんどの場合、デフォルトの `https://127.0.0.1:27124` のまま使えます。ポート `27124` が他のアプリケーションと競合している場合のみ変更が必要です。HTTP を使う場合はポートを `27123` に変更してください。

**Q11. 「証明書エラー」が表示されて接続テストが失敗します。**

Local REST API プラグインが自己署名証明書を使用しているため、Chrome が初回に警告を表示することがあります。Chrome のアドレスバーに `https://127.0.0.1:27124` を直接入力してアクセスし、「詳細設定」→「127.0.0.1 にアクセスする（安全でない）」をクリックして Chrome に証明書を記憶させてください。その後、Yasumaro ダッシュボードで再度「接続テスト」を行ってください。詳細は [Obsidian 連携ガイド](OBSIDIAN_SETUP_GUIDE.md) のトラブルシューティングをご覧ください。

**Q12. どのデイリーノートに書き込まれますか？**

記録が実行された日付の `YYYY-MM-DD.md` ファイルに追記されます。ファイルが存在しない場合は自動的に作成されます。

**Q13. Obsidian が起動していないと記録されませんか？**

Obsidian への書き込みは Obsidian が起動している必要があります。ただし、履歴データはデバイス上の SQLite DB（ダッシュボードの History タブ）には Obsidian の起動状態に関わらず保存されます。後から Obsidian が起動しているときに手動再記録することも可能です。

---

### AI 設定

**Q14. どの AI プロバイダーが使えますか？**

以下のプロバイダーが公式にサポートされています。

| カテゴリ | プロバイダー例 |
|---------|--------------|
| クラウド（OpenAI互換） | OpenAI、Anthropic（Claude）、Groq、Mistral AI、OpenRouter、DeepSeek など |
| Google | Gemini |
| ローカル | Ollama、LM Studio |

完全なリストは [完全セットアップガイド](SETUP_GUIDE.md) の「サポートされている AI プロバイダー」テーブルをご覧ください。

**Q15. Groq を使うにはどう設定しますか？**

ダッシュボードの「AI Provider」で「OpenAI Compatible」を選択し、Base URL に `https://api.groq.com/openai/v1`、API Key に [Groq Console](https://console.groq.com/keys) で取得したキー、Model Name に `llama-3.3-70b-versatile` などを入力して「Save & Test Connection」をクリックします。

**Q16. Gemini を使うにはどう設定しますか？**

ダッシュボードの「AI Provider」で「Google Gemini」を選択し、[Google AI Studio](https://aistudio.google.com/) で取得した API キーと、モデル名（例: `gemini-2.0-flash-lite`）を入力します。

**Q17. Ollama などのローカル LLM を使えますか？**

使えます。「AI Provider」で「OpenAI Compatible 2」を選択し、Base URL に `http://localhost:11434/v1`（Ollama の場合）、API Key は空欄、Model Name に `ollama list` で確認したモデル名を入力します。ダッシュボードに「Ollama」プリセットボタンがあり、クリックすると自動入力されます。LM Studio の場合は Base URL を `http://localhost:1234/v1` にします。詳細は [完全セットアップガイド](SETUP_GUIDE.md) をご覧ください。

**Q18. AI 要約のプロンプトをカスタマイズできますか？**

できます。ダッシュボードの「AIプロンプト」タブでシステムプロンプトとユーザープロンプトを自由に編集できます。複数のプロンプトを保存して切り替えることも可能です。ユーザープロンプトには必ず `{{content}}` プレースホルダーを含めてください。詳細は [AIプロンプトカスタマイズガイド](USER-GUIDE-AI-PROMPT.md) をご覧ください。

**Q19. 登録していない AI プロバイダーの URL を設定したら接続がブロックされました。**

セキュリティ上の理由から、Yasumaro は公式にサポートしているドメインへの接続のみを許可しています。サポートされていないドメインへの接続は CSP によってブロックされます。サポート対象のドメイン一覧は [完全セットアップガイド](SETUP_GUIDE.md) を確認してください。

**Q20. AI が「2プロバイダー」設定できますが、何が違いますか？**

「OpenAI Compatible」と「OpenAI Compatible 2」の2枠があります。これにより、たとえばクラウド AI（Groq）とローカル LLM（Ollama）を並行して設定しておき、シーンに応じて切り替えて使うことができます。

---

### プライバシーとデータ

**Q21. 閲覧データはどこに保存されますか？開発者のサーバーに送られますか？**

すべてのデータはあなたのデバイス上にのみ保存されます。開発者はサーバーを一切運営していないため、データが開発者の手に渡ることはありません。閲覧履歴はデバイス上の OPFS（SQLite DB）に、設定情報は Chrome のローカルストレージに保存されます。詳細は [プライバシーポリシー](PRIVACY.md) をご覧ください。

**Q22. AI プロバイダーにはどんなデータが送られますか？**

ページのテキスト内容（最大 64KB）が AI 要約のために選択したプロバイダーの API に送信されます。PIIマスキング（Mode C）を有効にしている場合、クレジットカード番号・電話番号・メールアドレスなどは送信前に `[MASKED]` に置換されます。URL・タイトル・滞在時間は AI には送られません。

**Q23. API キーは安全に保管されますか？**

はい。API キーは Chrome のローカルストレージに保存される前に、AES-GCM（PBKDF2 鍵導出）で自動的に暗号化されます。ユーザーが何か設定する必要はありません。さらに高いセキュリティを求める場合は、ダッシュボードの「プライバシー」タブで「マスターパスワード保護」を有効にすることで、暗号化キー自体をパスワードから導出させることができます。詳細は [プライバシーポリシー](PRIVACY.md) をご覧ください。

**Q24. 設定をエクスポートしたファイルには API キーが含まれますか？**

含まれません。セキュリティ上の理由から、API キーはエクスポートから除外されています。別のデバイスに設定を移行する際は、インポート後に API キーを手動で再入力してください。マスターパスワードを設定している場合は、エクスポートファイル全体が AES-GCM で暗号化されます。

**Q25. PII マスキングとは何ですか？**

ページのテキスト内にある個人情報（クレジットカード番号・マイナンバー・電話番号・メールアドレスなど）を正規表現で検出し、AI に送信する前に `[MASKED:CREDIT_CARD]` のように自動で置き換える機能です。ダッシュボードの「プライバシー」タブで「Masked Cloud（Mode C）」を選択すると有効になります。詳細は [PII 機能ガイド](PII_FEATURE_GUIDE.md) をご覧ください。

**Q26. プライベートページ（ネットバンキングなど）は自動記録されますか？**

HTTP レスポンスヘッダー（`Cache-Control: private`、`Set-Cookie` など）を解析し、プライベートページを自動検出します。ダッシュボードの「プライバシー」→「Confirmation Settings」で動作を設定できます。`save`（デフォルト）では通常通り保存、`skip` では保存せず履歴に「スキップ済み」として残す、`confirm` では Chrome 通知で毎回確認を求めます。

**Q27. 記録した履歴を削除できますか？**

できます。ダッシュボードの History タブで個別エントリを削除できます（GDPR 第17条に準拠した物理削除）。「すべてのデータを削除」ボタンで全件一括削除も可能です。保持ポリシーを設定すれば、一定期間・件数を超えたエントリを自動的に削除することもできます。

---

### 記録の動作

**Q28. どんな条件で自動記録されますか？**

ページへの滞在時間とスクロール深度が設定した閾値を超えると自動記録されます。また、ドメインフィルターの設定（ホワイトリスト・ブラックリスト）によって記録対象を絞ることができます。デフォルトはブラックリストモードで、Amazon・Google・Facebook などの一般的なサイトがあらかじめ除外されています。

**Q29. 手動で記録するにはどうしますか？**

拡張機能のアイコンをクリックしてポップアップを開き、「📝 今すぐ記録」ボタンをクリックします。自動記録の条件を満たしていないページでも記録でき、同じページを何度でも記録できます。

**Q30. 特定のサイトを記録したくない（または記録したい）場合は？**

ダッシュボードの「ドメインフィルター」タブで設定します。ブラックリストモードで除外したいドメインを追加するか、ホワイトリストモードで記録したいドメインだけを登録してください。「現在のページドメインを追加」ボタンを使うと、現在開いているページのドメインをワンクリックで追加できます。uBlock Origin 形式のフィルターリストをインポートすることも可能です。詳細は [uBlock フィルターガイド](USER-GUIDE-UBLOCK-IMPORT.md) をご覧ください。

**Q31. スキップされたページはどこで確認できますか？**

ダッシュボードの History タブで「Skipped」フィルターを選択すると、プライバシー検出によりスキップされたページの一覧が表示されます。「今すぐ記録」ボタンからその場で手動保存することもできます。スキップされたページは 24 時間後に自動削除されます。

**Q32. 同じページが何度も記録されてしまいます。**

自動記録は滞在時間・スクロール深度の条件を満たすたびに実行されます。重複を避けたい場合は、ドメインフィルターでそのサイトをブラックリストに追加するか、保持ポリシーで古い記録を定期削除する設定をご検討ください。

**Q33. 記録完了メッセージの「(6.0秒 / AI: 2.2秒)」は何を表していますか？**

最初の秒数（6.0秒）は、記録開始から完了までの合計処理時間です。ページ本文の取得、PIIマスキング、AI要約、Obsidian/ローカルへの保存まで、一連の処理全体にかかった時間を表します。「AI: 」に続く秒数（2.2秒）は、そのうちAIプロバイダーへの要約リクエスト1回分にかかった時間です。クラウドAI（Masked Cloud / Full Pipelineモード）を使う設定の場合のみ表示され、ローカルAIのみを使う設定（Local Onlyモード）では表示されません。

---

### トラブルシューティング

**Q33. 接続テストで「接続エラー」が出ます。**

以下を順に確認してください。(1) Obsidian が起動しているか。(2) Local REST API プラグインが有効化されているか（Obsidian 設定 → コミュニティプラグイン）。(3) URL とポートが正しいか（デフォルト: `https://127.0.0.1:27124`）。(4) 証明書エラーが出ていないか（Q11 を参照）。詳細は [Obsidian 連携ガイド](OBSIDIAN_SETUP_GUIDE.md) のトラブルシューティングをご覧ください。

**Q34. AI 要約が返ってきません。**

以下を確認してください。(1) API キーが正しく入力されているか。(2) 選択したモデル名がプロバイダーで使用可能か。(3) Base URL のドメインが Yasumaro のサポートリストに含まれているか（Q19 参照）。Groq などの無料枠は利用制限があるため、リクエスト数の上限に達している可能性もあります。

**Q35. Obsidian にページが記録されているのに、AI 要約がありません。**

AI 要約なしで記録する設定（「Record without AI」）を使用しているか、AI プロバイダーの設定が未完了の場合に発生します。ダッシュボードで AI プロバイダーを設定し、「Save & Test Connection」で接続を確認してください。

**Q36. HTTP への切り替え後、Obsidian への接続が失敗します。**

HTTP に切り替えた場合、ポートも `27124` から `27123` に変更する必要があります。Yasumaro ダッシュボードの「Protocol」を `http`、「Port」を `27123` に設定してください。また、Obsidian の Local REST API プラグイン設定でも HTTP ポートが `27123` に設定されていることを確認してください。

**Q37. ダッシュボードに「簡易ストレージモードで動作中」という黄色いバナーが表示されています。**

お使いの環境で OPFS（SQLite の保存先）が使用できないため、`chrome.storage.local` へのフォールバックが有効になっています。保存件数が数百件に制限されます。Chrome のバージョンアップで OPFS が使えるようになると、自動的にデータが移行されます。詳細は [ストレージモードについて](STORAGE_MODES.md) をご覧ください。

**Q38. ページを開いても自動記録が全く実行されません。**

以下を確認してください。(1) ドメインフィルターでそのドメインがブラックリストに入っていないか。(2) 滞在時間やスクロール深度の閾値を満たしているか（ページをある程度スクロールして数秒待つ）。(3) プライベートページ検出でスキップされていないか（History タブの「Skipped」フィルターで確認）。

**Q39. 設定をエクスポート・インポートしたら API キーが消えました。**

仕様です（Q24 参照）。API キーはセキュリティ上の理由からエクスポートに含まれないため、インポート後に各 API キーを手動で再入力する必要があります。

**Q40. 「スキップ済み」のページが意図せず消えてしまいました。**

スキップされたページは保留状態から 24 時間後に自動削除されます。これは意図的な仕様です。重要なページはスキップされる前に「今すぐ記録」で手動保存してください。

---

### その他の機能

**Q41. 履歴の全文検索はどう使いますか？**

ダッシュボードの History タブの検索ボックスにキーワードを入力すると、URL・タイトル・AI 要約の全体を SQLite FTS5 で高速検索できます。日本語にも対応しています。

**Q42. FTS5 とは何ですか？**

SQLite に組み込まれている全文検索エンジンです。URLやタイトルを1文字ずつ愚直に比較していく方法（LIKE検索）とは異なり、あらかじめ単語の出現位置を索引化しておくことで、記録件数が増えても検索速度が落ちにくいという特徴があります。Yasumaro では履歴のURL・タイトル・AI要約をこのFTS5用のテーブルに登録しており、日本語を含むキーワード検索を高速に行えます。

**Q43. スター機能は何のためにありますか？**

よく参照するページにスターを付けておくと、後から素早く見つけられます。また、スター付きのエントリは保持ポリシーによる自動削除の対象外になります。

**Q44. 保持ポリシーを設定するとどうなりますか？**

設定した保持期間（30〜365日）または最大件数（1,000〜100,000件）を超えたエントリが、24時間ごとに自動的に物理削除されます。スター付きエントリは削除されません。デフォルトは無制限（自動削除なし）です。詳細は [プライバシーポリシー](PRIVACY.md) をご覧ください。

**Q45. uBlock Origin のフィルターリストをインポートできると聞きましたが、何のためにありますか？**

大量のドメインをブラックリストに一括登録するためです。既存の uBlock Origin フィルターや Steven Black の hosts リストをそのままインポートでき、記録したくないサイトを効率よく管理できます。詳細は [uBlock フィルターガイド](USER-GUIDE-UBLOCK-IMPORT.md) をご覧ください。

**Q46. Obsidian なしで Markdown に書き出せますか？**

できます。ダッシュボードの「初期設定」→「ローカル Markdown 書き出し」を ON にすると、`~/Downloads/Yasumaro/YYYY-MM-DD.md` に日次ファイルが書き出されます。書き出しタイミングは「手動のみ / 即時 / アイドル時・30分ごと（デフォルト） / 日付が変わったとき」の4つから選べます。開始日・終了日を指定した手動エクスポートも別途いつでも可能です。詳細は [ローカル Markdown 書き出しガイド](MARKDOWN_DOWNLOAD.md) をご覧ください。

**Q47. 書き出しのたびにダウンロード通知が表示されるのが気になります。**

ブラウザの設定で非表示にできます。Chrome の場合は `chrome://settings/downloads` を開き、「ダウンロードが完了したとき、ダウンロード一覧を表示する」のトグルを OFF にしてください。Edge の場合は `edge://settings/downloads` で同様の設定があります。ダウンロード自体は正常に行われます。

---

## English

### Categories

- [Basics & Installation](#basics--installation)
- [Obsidian Integration](#obsidian-integration)
- [AI Settings](#ai-settings)
- [Privacy & Data](#privacy--data)
- [Recording Behavior](#recording-behavior)
- [Troubleshooting](#troubleshooting)
- [Other Features](#other-features)

---

### Basics & Installation

**Q1. Where does the name 'Yasumaro' come from?**

It's named after Ō no Yasumaro, the compiler of the Kojiki, Japan's oldest chronicle. He transcribed the vast oral memory recited by Hieda no Are into writing, turning spoken words into a permanent record. This extension does the same thing: it turns the fleeting pages you browse into a lasting record you can look back on later.

**Q2. What can Yasumaro do?**

Yasumaro is a Chrome extension that automatically or manually records the web pages you visit, then writes an AI-generated summary to your Obsidian daily note. History is also saved to a local SQLite database on your device, supporting full-text search and filtering. Even without Obsidian, you can use the history browsing and search features.

**Q3. Can I use it without Obsidian?**

Yes. Obsidian integration is optional. If you leave the "Use Obsidian" checkbox unchecked in the dashboard, browsing history will be saved only to the SQLite database on your device. All history management features—full-text search, starring, and deletion—remain available.

**Q4. Do I need an AI provider account or API key?**

Not if you don't want AI summaries. If you don't configure an AI provider in the dashboard, only the URL, title, and time spent on the page are recorded. You can also use the "Record without AI" button to save directly to Obsidian without any AI processing.

**Q5. Does it work on browsers other than Chrome?**

Yasumaro is published on the Chrome Web Store and installs directly into Chrome. It also works on other Chromium-based browsers such as Microsoft Edge and Brave — in fact, the author uses Microsoft Edge as their daily driver. If you're not installing from the Chrome Web Store, use `npm run build:edge` or `npm run build:brave` to build for each browser. Firefox builds are also possible, but Chromium-based browsers are the main supported platform.

**Q6. Does it work on mobile Chrome?**

Chrome extensions are not supported on mobile Chrome, so normal use is not available. On desktop, if OPFS (the SQLite storage backend) is unavailable, the extension automatically falls back to simplified storage mode. See [STORAGE_MODES.md](STORAGE_MODES.md) for details.

**Q7. Where can I install the extension?**

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc) (recommended). To build from source, clone the [GitHub repository](https://github.com/armaniacs/yasumaro), run `npm run build`, then load the resulting `dist/chromium-mv3` folder via `chrome://extensions` → "Developer mode" → "Load unpacked". See the [Complete Setup Guide](SETUP_GUIDE.md) for details.

---

### Obsidian Integration

**Q8. What do I need to connect Yasumaro to Obsidian?**

You need to install and enable the "Local REST API" community plugin in Obsidian, then enter the API key generated by that plugin into the Yasumaro dashboard. See the [Obsidian Integration Guide](OBSIDIAN_SETUP_GUIDE.md) for step-by-step instructions.

**Q9. What should I enter for Daily Note Path?**

Enter the name of the folder inside your Obsidian Vault where daily notes are stored—for example `DailyNotes`, `Journal`, or `092.Daily`. This is a path relative to the Vault root; no leading `/` is needed. Match it to the "New file location" shown in Obsidian's Daily Notes plugin settings.

**Q10. Can I use the default URL for Obsidian?**

In most cases, the default `https://127.0.0.1:27124` works as-is. Only change it if port `27124` conflicts with another application. If you need to use HTTP, switch the port to `27123`.

**Q11. The connection test fails with a certificate error.**

The Local REST API plugin uses a self-signed certificate, which Chrome may warn about on the first connection. Open `https://127.0.0.1:27124` directly in Chrome's address bar, click "Advanced", then "Proceed to 127.0.0.1 (unsafe)" to let Chrome remember the certificate. Then run the connection test in Yasumaro again. See the troubleshooting section of the [Obsidian Integration Guide](OBSIDIAN_SETUP_GUIDE.md) for details.

**Q12. Which daily note will content be written to?**

Content is appended to the `YYYY-MM-DD.md` file for the date the recording was triggered. If the file doesn't exist, it is created automatically.

**Q13. Does Obsidian need to be running for recording to work?**

For writing to Obsidian, yes. However, history data is saved to the SQLite DB on your device regardless of whether Obsidian is running. You can manually re-record to Obsidian later when it is running.

---

### AI Settings

**Q14. Which AI providers are supported?**

| Category | Examples |
|----------|---------|
| Cloud (OpenAI-compatible) | OpenAI, Anthropic (Claude), Groq, Mistral AI, OpenRouter, DeepSeek, etc. |
| Google | Gemini |
| Local | Ollama, LM Studio |

See the full provider table in the [Complete Setup Guide](SETUP_GUIDE.md).

**Q15. How do I set up Groq?**

In the dashboard, select "OpenAI Compatible" as the AI Provider. Set Base URL to `https://api.groq.com/openai/v1`, enter your API key from [Groq Console](https://console.groq.com/keys), set a Model Name such as `llama-3.3-70b-versatile`, and click "Save & Test Connection".

**Q16. How do I set up Gemini?**

Select "Google Gemini" as the AI Provider, enter the API key from [Google AI Studio](https://aistudio.google.com/), and set a Model Name such as `gemini-2.0-flash-lite`.

**Q17. Can I use a local LLM like Ollama?**

Yes. Select "OpenAI Compatible 2" as the AI Provider, set Base URL to `http://localhost:11434/v1` for Ollama (or `http://localhost:1234/v1` for LM Studio), leave API Key empty, and enter the model name shown by `ollama list`. The dashboard has preset buttons for Ollama and LM Studio that fill in the values automatically. See the [Complete Setup Guide](SETUP_GUIDE.md) for details.

**Q18. Can I customize the AI summarization prompt?**

Yes. The "AI Prompt" tab in the dashboard lets you edit the system and user prompts freely. You can save multiple prompts and switch between them. Always include the `{{content}}` placeholder in the user prompt. See the [AI Prompt Customization Guide](USER-GUIDE-AI-PROMPT.md) for examples.

**Q19. Connections to my AI provider's URL are being blocked.**

For security reasons, Yasumaro only allows connections to officially supported domains. Connections to unsupported domains are blocked by CSP. Check the supported domain list in the [Complete Setup Guide](SETUP_GUIDE.md).

**Q20. There are two "OpenAI Compatible" slots—what's the difference?**

"OpenAI Compatible" and "OpenAI Compatible 2" are two separate configuration slots. You can, for example, configure a cloud AI (Groq) in one slot and a local LLM (Ollama) in the other, then switch between them as needed.

---

### Privacy & Data

**Q21. Where is my browsing data stored? Is it sent to the developer?**

All data is stored only on your device. The developer does not operate any server, so your data never reaches the developer. Browsing history is stored in OPFS (SQLite DB) on your device; settings are stored in Chrome's local storage. See [PRIVACY.md](PRIVACY.md) for details.

**Q22. What data is sent to the AI provider?**

The text content of the page (up to 64 KB) is sent to the API of your chosen provider to generate a summary. With PII masking (Mode C) enabled, credit card numbers, phone numbers, and email addresses are replaced with `[MASKED]` before transmission. URLs, titles, and time-on-page are not sent to the AI.

**Q23. Are my API keys stored securely?**

Yes. API keys are automatically encrypted with AES-GCM (PBKDF2 key derivation) before being stored in Chrome's local storage—no user action is required. For stronger protection, you can enable "Master Password Protection" in the Privacy tab of the dashboard, which derives the encryption key from your password. See [PRIVACY.md](PRIVACY.md) for details.

**Q24. Does the exported settings file include API keys?**

No. API keys are excluded from exports for security reasons. When migrating to another device, re-enter the API keys manually after importing. If a master password is set, the entire export file is encrypted with AES-GCM.

**Q25. What is PII masking?**

PII masking detects personal information in page text—such as credit card numbers, My Number, phone numbers, and email addresses—using regex patterns, and automatically replaces them with tokens like `[MASKED:CREDIT_CARD]` before sending content to the AI. Select "Masked Cloud (Mode C)" in the Privacy tab of the dashboard to enable it. See the [PII Feature Guide](PII_FEATURE_GUIDE.md) for details.

**Q26. Are private pages like online banking automatically recorded?**

Yasumaro analyzes HTTP response headers (`Cache-Control: private`, `Set-Cookie`, etc.) to detect private pages automatically. You can configure the behavior under Dashboard → Privacy → Confirmation Settings: `save` (default) saves as normal, `skip` stores the page as "Skipped" in history for optional later save, `confirm` shows a Chrome notification asking you each time.

**Q27. Can I delete recorded history?**

Yes. Individual entries can be deleted from the Dashboard's History tab (physical deletion compliant with GDPR Art. 17). The "Delete All Data" button removes all records at once. You can also configure a retention policy to automatically purge entries older than a set period or beyond a maximum count.

---

### Recording Behavior

**Q28. What triggers automatic recording?**

A page is automatically recorded when both the time spent on it and the scroll depth exceed your configured thresholds. Domain filter rules (whitelist or blacklist) further control which pages are eligible. The default is blacklist mode with common sites such as Amazon, Google, and Facebook pre-excluded.

**Q29. How do I record a page manually?**

Click the extension icon to open the popup and click the "📝 Record Now" button. This works regardless of whether automatic recording conditions are met, and you can record the same page multiple times.

**Q30. How do I stop a specific site from being recorded (or ensure it is)?**

Use the "Domain Filter" tab in the dashboard. In blacklist mode, add the domains you want to exclude; in whitelist mode, add only the domains you want to record. The "Add Current Domain" button lets you add the current page's domain in one click. You can also import uBlock Origin format filter lists. See the [uBlock Filter Guide](USER-GUIDE-UBLOCK-IMPORT.md) for details.

**Q31. Where can I find pages that were skipped?**

In the Dashboard's History tab, select the "Skipped" filter to see all pages skipped by private page detection. You can manually save any of them from there using "Record Now". Skipped pages are automatically deleted after 24 hours.

**Q32. The same page keeps getting recorded repeatedly.**

Automatic recording fires each time the time and scroll thresholds are met. To prevent this, add the domain to your blacklist, or configure a retention policy to periodically remove older entries.

**Q33. What does "(6.0s / AI: 2.2s)" in the completion message mean?**

The first number (6.0s) is the total processing time from starting the recording to completion — covering content extraction, PII masking, AI summarization, and saving to Obsidian/local storage. The number after "AI: " (2.2s) is the time spent on a single summarization request to the AI provider. It only appears when a cloud AI mode is configured (Masked Cloud / Full Pipeline); it does not appear in Local Only mode, which uses no cloud AI.

---

### Troubleshooting

**Q33. The connection test shows a connection error.**

Check in order: (1) Is Obsidian running? (2) Is the Local REST API plugin enabled (Obsidian Settings → Community Plugins)? (3) Is the URL and port correct (default: `https://127.0.0.1:27124`)? (4) Is there a certificate error? (See Q11.) See the troubleshooting section of the [Obsidian Integration Guide](OBSIDIAN_SETUP_GUIDE.md) for details.

**Q34. AI summaries are not being returned.**

Check: (1) Is the API key entered correctly? (2) Is the model name valid for your provider? (3) Is the Base URL domain on Yasumaro's supported list? (See Q19.) Free-tier providers like Groq have rate limits that may be reached.

**Q35. Pages are recorded in Obsidian but with no AI summary.**

This happens when using "Record without AI" or when the AI provider is not configured. Set up an AI provider in the dashboard and confirm the connection with "Save & Test Connection".

**Q36. After switching to HTTP, the connection to Obsidian fails.**

When switching to HTTP, you must also change the port from `27124` to `27123`. Set Protocol to `http` and Port to `27123` in the Yasumaro dashboard. Also verify that the HTTP port in Obsidian's Local REST API plugin settings is set to `27123`.

**Q37. A yellow banner says "Running in simplified storage mode".**

OPFS (the SQLite storage backend) is unavailable in your environment, so the extension has fallen back to `chrome.storage.local`. Storage is limited to a few hundred entries. When Chrome is updated and OPFS becomes available, data will be migrated automatically. See [STORAGE_MODES.md](STORAGE_MODES.md) for details.

**Q38. Automatic recording never runs on any page.**

Check: (1) Is the domain on the blacklist? (2) Are the time and scroll thresholds being met (try staying on the page and scrolling for a few seconds)? (3) Is the page being skipped by private page detection (check the "Skipped" filter in the History tab)?

**Q39. My API keys were gone after importing settings.**

This is by design (see Q24). API keys are excluded from exports for security reasons; you need to re-enter them manually after importing.

**Q40. Skipped pages disappeared unexpectedly.**

Skipped (pending) pages are automatically deleted after 24 hours—this is intentional. Use "Record Now" to manually save important pages before they are skipped.

---

### Other Features

**Q41. How do I use the full-text search in history?**

In the Dashboard's History tab, type a keyword in the search box to search across URLs, titles, and AI summaries using SQLite FTS5. Japanese text is supported.

**Q42. What is FTS5?**

FTS5 is the full-text search engine built into SQLite. Unlike naively comparing text character by character (a LIKE-based search), it pre-builds an index of where words appear, so search speed stays fast even as your history grows. Yasumaro registers each record's URL, title, and AI summary in an FTS5-backed table, enabling fast keyword search — including Japanese text.

**Q43. What is the star feature for?**

Starring a page lets you find it quickly later. Starred entries are also exempt from automatic deletion by the retention policy.

**Q44. What happens when I set a retention policy?**

Entries older than the configured period (30–365 days) or beyond the maximum count (1,000–100,000) are physically deleted every 24 hours. Starred entries are never deleted automatically. The default is unlimited (no auto-deletion). See [PRIVACY.md](PRIVACY.md) for details.

**Q45. I heard I can import uBlock Origin filter lists—what is that for?**

It lets you bulk-register large numbers of domains into the blacklist. You can import existing uBlock Origin filter lists or Steven Black's hosts-format lists directly, making it easy to manage sites you don't want recorded. See the [uBlock Filter Guide](USER-GUIDE-UBLOCK-IMPORT.md) for details.

**Q46. Can I export to Markdown without Obsidian?**

Yes. Toggle "Export to Local Markdown" ON in the dashboard under "Initial Setup" → "Local Markdown Export". A daily file (`~/Downloads/Yasumaro/YYYY-MM-DD.md`) is written according to one of four timing modes: "Manual only", "Immediate", "Idle / every 30 min" (default), or "On date change". Manual export with a date range is also available at any time. See the [Local Markdown Export Guide](MARKDOWN_DOWNLOAD.md) for details.

**Q47. The download notification appears every time export fires—it's annoying.**

You can hide it in your browser settings. In Chrome, open `chrome://settings/downloads` and toggle off "Show downloads when they're done". In Edge, open `edge://settings/downloads` for a similar setting. Downloads will still work normally.
