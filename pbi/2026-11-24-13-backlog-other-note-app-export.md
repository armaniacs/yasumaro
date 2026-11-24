# PBI: Obsidian 以外のノートアプリへの直接出力

## ユーザーストーリー
Logseq や Notion をノートの置き場にしている利用者として、Yasumaro の要約付きの閲覧記録をそのアプリへ直接送りたい、なぜなら現状の直接出力先は Obsidian だけで、他のアプリを使う利用者は Markdown のダウンロードや webhook の中継を自分で組む必要があるから。

## 優先度
- 順位: 12/12
- RICE スコア: 0.2(Reach 3 × Impact 1 × Confidence 0.5 ÷ Effort 8 ≒ 0.19)
  - Reach 3: Obsidian を使わず、かつ他のノートアプリへ自動で送りたい利用者に限られる
  - Impact 1: ローカル Markdown 出力と webhook export で、多くの用途は既に代替できる
  - Confidence 0.5: どのアプリの需要が大きいか、各アプリの API の制約(認証方式・レート制限)が未調査
  - Effort 8: 出力先 1 つにつき、認証・書式変換・失敗時の再送・接続テストが要る
- 根拠: 既存の 2 つの出力で代替できる範囲が広く、出力先ごとに保守の費用が増える。需要が具体的に見えるまで着手しない

## 再検討トリガー
以下のすべてを満たしたら着手を検討する。
- 正式版のリリース後であること
- 特定のノートアプリ(Logseq、Notion など)への出力の要望が継続して届いている
- 下記の「既存の出力で代替できる範囲」では足りない理由が、要望から具体的に分かっている

## 既存の出力で代替できる範囲
着手前の整理。新しい出力先を作る前に、まずこの範囲で足りないかを確かめる。

| 出力 | 送る内容 | 代替できる用途 | 代替できない点 |
|------|---------|---------------|---------------|
| ローカル Markdown 出力 | 日ごとの Markdown(テンプレートで書式を変えられる) | Logseq など、ローカルの Markdown フォルダを読むアプリ。保存先のフォルダを合わせれば取り込める | ダウンロード経由のため、アプリのページへの追記ではなくファイルの追加になる |
| webhook export | マスク済みのタイトル・マスク済みの要約・タグ・URL | 自動化サービスを中継した Notion などへの追加 | 送信先は https の許可リスト内の origin のみ。本文は送らない。アプリ固有の形式(Notion のブロック等)への変換は中継側の仕事になる |

## ビジネス価値
- Obsidian 以外のノートアプリの利用者にも、記録が自動で届く
- 測定方法: 選んだ出力先に、記録 1 件につき 1 件のノート(またはブロック)が作られ、失敗時は理由が履歴に残ること

## BDD受け入れシナリオ

```gherkin
Scenario: 記録が選んだノートアプリへ届く
  Given 利用者が出力先として対応済みのノートアプリを設定し、接続テストに成功している
  When  ページの記録が保存される
  Then  そのノートアプリに、タイトル・要約・URL・タグを含むノートが作られる

Scenario: 送信できなかった記録は理由を残して再送の対象になる
  Given 出力先のノートアプリが応答しない
  When  ページの記録が保存される
  Then  ローカルの記録は保存される
  And   出力の失敗理由が履歴に表示される
  And   その記録は再送の対象として残る
```

## 受け入れ基準
- [ ] 「既存の出力で代替できる範囲」の表を要望と突き合わせ、新しい出力先が必要な理由を記録している
- [ ] 出力先に送る内容は webhook export と同じ方針(マスク済みのタイトルと要約、本文は送らない)に従う
- [ ] 出力先の認証情報は既存の API キーと同じく暗号化して保存する
- [ ] 出力の失敗がローカルの記録の保存を妨げない
- [ ] 追加の host permission が必要なら最小の範囲で宣言し、`public/PRIVACY.md` と `docs/PRIVACY.md` に送信先と送信内容を追記して両ファイルを同一に保つ

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 出力先のスタブサーバーに対して記録を保存し、ノート作成のリクエストが届くこと

### 統合テスト
- 送信本文に PII がマスクされたタイトルと要約だけが入り、ページ本文が入らないこと
- 出力先の失敗時もローカルの SQLite に記録が保存されること

### 単体テスト
- 記録からアプリ固有の形式への変換
- 応答コードから失敗理由への対応付け

## 実装アプローチ
- **Outside-In**: 「本文を送らない」統合テストを先に書き、webhook export と同じ送信方針から外れないことを固める
- **Red-Green-Refactor**: 最初の出力先は 1 つに絞る。2 つ目が出るまで出力先の共通の抽象は作らない

## 見積もり
8 ストーリーポイント(要チームでの見積もり。出力先 1 つ分)

## 技術的考慮事項
- 依存関係: 出力先の API。OAuth が必要なアプリは、拡張機能での認証の導線(`chrome.identity` 等)の追加が要る
- テスタビリティ: 送信は依存注入で差し替え、本文を検査する
- 非機能要件: 出力先のレート制限を守る。出力先の追加は manifest の権限変更を伴うため、ストアの審査とプライバシーポリシーの改訂を見込む

## 実装者向け注記

### 最初にやるスパイク
1. 「既存の出力で代替できる範囲」を、届いた要望ごとに当てはめる。ローカル Markdown 出力のテンプレートで Logseq の書式(箇条書きのブロック)を出せるか確かめる
2. 出力先の候補ごとに、API の有無・認証方式・ローカル API の有無(Obsidian の Local REST API に相当するもの)を調べる
3. 出力先を `SyncTarget` に載せるか、webhook export の送信処理を拡張するかを決める。`SyncTarget.ts` のコメントにある通り、Obsidian の出力経路とは形が合わないことに注意する

### 既存の関連コード
- `src/background/localMarkdownExportCore.ts`: 日ごとの Markdown をダウンロードとして書き出す
- `src/background/pipeline/steps/saveLocalMarkdownStep.ts`: 日ごとの Markdown の組み立て(`buildDailyMarkdown`)
- `src/utils/markdownTemplateUtils.ts`: Markdown 出力のテンプレート
- `src/background/webhookExport/webhookExportPayload.ts`: webhook の送信本文(マスク済みのタイトル・要約・タグ・URL)
- `src/background/webhookExport/webhookExportSender.ts`、`src/background/webhookExport/webhookExportDestinations.ts`: 送信と送信先の許可リスト
- `src/background/syncTargets/SyncTarget.ts`: 同期先のインターフェース(実験的)
- `src/background/obsidianClient.ts`: Obsidian への出力
- `src/utils/markdownFormatter.ts`: 記録 1 件の Markdown(`buildEntryMarkdown`)

### 範囲
- 含める: 出力先 1 つへの一方向の出力
- 含めない: ノートアプリからの読み込み、双方向同期、複数の出力先の同時対応

## Definition of Done
- [ ] 全 BDD シナリオが自動テストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` を更新し、両ファイルが同一
- [ ] ドキュメント更新済み(出力先の設定手順、送る内容)

## 引き継ぎ
状態: 将来候補(未着手)
