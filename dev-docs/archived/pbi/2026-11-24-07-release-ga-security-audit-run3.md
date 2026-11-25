# PBI: 正式版前のセキュリティ監査 run-3

## ユーザーストーリー
正式版を入れる利用者として、正式版のコードが外部送信と保存の経路について第三者の視点で監査されていてほしい、なぜなら閲覧履歴と要約という私的なデータを扱う拡張で、run-1 以降に外部送信面(webhook の送信先判定)と書き込み経路(Obsidian の再書き込み、設定の読み手)が変わったまま正式版になると、未検証の変更がそのまま「正式」として配られるから。

## 優先度
- 順位: 06/12
- RICE スコア: 4.8(Reach 10 × Impact 3 × Confidence 0.8 ÷ Effort 5)
  - Reach 10: 正式版の全利用者が監査対象のコードを使う
  - Impact 3: セキュリティ必須。外部送信面と保存経路の欠陥は、データ流出・記録の消失という実害に直結する
  - Confidence 0.8: 手順(security-audit スキル)と対象は決まっているが、発見事項の有無と修正量は実施するまで分からない
  - Effort 5: 差分が大きい(run-1 台帳コミット以降で src / entrypoints / public / wxt.config.ts に 570 ファイル)。脅威モデルの追記を含む
- 根拠: 点は 07(実機スモーク、5.3)より低いが、最終コードを監査するため、コード変更を含む PBI の後に置く
- 依存: 2026-11-24-05(Obsidian 412 競合の利用者通知)と 2026-11-24-06(webhook E2E の追従)の完了後に実施する。監査で修正が出た場合、その修正も 2026-11-24-08(実機スモーク)の前に入れる。2026-11-24-04(採番)は本 PBI と 08 の完了後に限る

## ビジネス価値
- 正式版の外部送信面(AI プロバイダー、Obsidian、Gist、webhook)の判定が、監査記録付きで説明できる
- webhook の脅威モデル(何を送るか、どこへ送れるか、token をどう扱うか)が文書化され、ストア審査や問い合わせに根拠を示せる
- 発見事項が PBI として追跡され、正式版の採番前に「未対応の重大な発見が無い」ことを確認できる
- 測定方法: run-3 の REPORT.md が作られ、confirmed の発見がすべて PBI 化(または修正済み)され、結果が run-3 台帳に記録されていること

## BDD受け入れシナリオ

```gherkin
Scenario: run-1 以降の差分を対象に監査が完走する
  Given run-1 の台帳に source ref と成果物の置き場が記録されている
  And   2026-11-24-05 と 2026-11-24-06 がマージ済みである
  When  監査担当が security-audit スキルで run-3 を実施する
  Then  ./security-audit-yasumaro-run-3/ に REPORT.md と findings.json ほかの成果物ができる
  And   その成果物は git に追跡されず、pbi/ の run-3 台帳だけが追跡される
  And   台帳に confirmed / needs_validation / rejected の件数と source ref が記録される

Scenario: 重点領域が監査範囲から漏れない
  Given 重点領域として webhook 送信先判定、Obsidian の If-Match/412 再書き込み、blob-tier reader が指定されている
  When  run-3 の coverage-ledger.json を確認する
  Then  3 領域の主要ファイルがすべて「調査済み」として記録されている

Scenario: confirmed の発見が正式版の前に処理される
  Given run-3 で confirmed の発見が 1 件以上ある
  When  台帳で次のアクションを決める
  Then  各発見に修正 PBI が起票されるか、受容の理由と承認者が台帳に記録される
  And   修正 PBI が完了するまで 2026-11-24-04 の採番は行わない

Scenario: 発見が 0 件でも脅威モデルは更新される
  Given run-3 の confirmed が 0 件である
  When  監査を締める
  Then  dev-docs/SECURITY_REVIEW_GUIDE.md に webhook の脅威モデルの節が追加されている
```

## 受け入れ基準
- [ ] security-audit スキルで run-3 を実施し、成果物を `./security-audit-yasumaro-run-3/` に置いた(`.gitignore` の `security-audit-yasumaro-run-*/` で追跡外)
- [ ] run-3 の台帳 `pbi/2026-11-24-NN-backlog-security-audit-run3.md`(NN は起票時の空き番号)を作り、source ref・件数・成果物の置き場・次のアクションを記録した(run-1 台帳と同じ構成)
- [ ] 監査範囲は run-1 以降の差分を主とし、下記の重点 3 領域を必ず含めた
- [ ] 重点 3 領域それぞれについて、coverage-ledger に調査済みの記録がある
- [ ] confirmed の発見は修正 PBI を起票したか、受容理由を台帳に記録した。needs_validation は検証計画を台帳に書いた
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` の「Threat Model Overview」の表に webhook の行を足し、webhook の節(送信データ / 宛先 / token / 残余リスク)を追加した
- [ ] webhook の説明が古い方式(「host_permissions に宣言されていない origin を遮断」)のまま残っている文書を洗い出し、修正したか修正 PBI に回した(`PERMISSIONS.md` の Reviewer Notes を含む)
- [ ] 文書は Shift-JIS 範囲の文字のみ(`node scripts/check-docs-chars.mjs` が緑)

### 重点 3 領域
1. webhook 送信先許可リストと保存時 pre-flight(外部送信面)
2. Obsidian の If-Match / 412 再書き込み
3. ドメインポリシーの blob-tier reader

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 監査そのものはテストを書かない。confirmed の発見を修正する PBI では、発火デモ(修正前に赤、修正後に緑)を必須にする(run-1 の NV-1 で `consentToctou.probe.test.ts` を先に置いた前例に従う)
- 外部送信面の発見は、可能なら `@extension` の E2E(実ブラウザの CSP と fetch)で固定する。例: `testDir/e2e/webhook-egress.spec.ts`、`testDir/e2e/gist-egress.spec.ts`

### 統合テスト
- needs_validation は、run-1 の NEEDS-VALIDATION.md と同じく、ローカルで再現できる検証手順(ダミー mutex など)を書く

### 単体テスト
- 修正 PBI で、境界値(空・不正 URL・弱い ETag・blob と top-level の両方にある値など)を表駆動で固定する

## 実装アプローチ
- **Outside-In**: 外部から到達できる入力(利用者が入れる URL、外部サーバーの応答ヘッダー、storage の値)を列挙し、危険な出口(fetch、storage 書き込み、DOM 挿入、通知)まで追う
- **Red-Green-Refactor**: 監査では適用しない。発見を修正する PBI で適用する
- **成果物の分離**: 監査成果物は追跡外のディレクトリ、判断と次のアクションは追跡される台帳、と分ける(run-1 のオーナー決定)

## 見積もり
5 ストーリーポイント(要チームでの見積もり)。発見の修正は別 PBI で見積もる

## 技術的考慮事項
- 依存関係: 2026-11-24-05、2026-11-24-06 の完了。後続は 2026-11-24-08(実機スモーク)と 2026-11-24-04(採番)
- テスタビリティ: 重点領域はいずれも依存注入の seam があり、発火デモを単体テストで書ける(webhook は `sendWebhookExport` の deps、Obsidian は `obsidianConditionalWrite.ts` の純関数、blob-tier は `readBlobFirst` の純関数)
- 非機能要件: 監査成果物に API キー・token・PAT などの実値を含めない。含まれた場合は REDACTED に置き換えてから台帳に要約する
- ロールバック手段: 監査は読み取りのみ。文書の追記は通常の revert で戻せる

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。着手前に必ず再実行すること。

```bash
rtk proxy ls /Users/yaar/Playground/yasumaro/security-audit-yasumaro-run-1
rtk proxy grep -n -e "security-audit" /Users/yaar/Playground/yasumaro/.gitignore
rtk proxy grep -n -e "commit" /Users/yaar/Playground/yasumaro/security-audit-yasumaro-run-1/run-metadata.json
git -C /Users/yaar/Playground/yasumaro log --oneline --diff-filter=A -- pbi/2026-11-12-00-backlog-security-audit-run1.md
git -C /Users/yaar/Playground/yasumaro diff --shortstat a1e3ffb23 HEAD -- src entrypoints wxt.config.ts public
```

確認結果:
- run-1 台帳: `pbi/2026-11-12-00-backlog-security-audit-run1.md`(profile standard、フル 6 フェーズ、confirmed 0 / needs_validation 1 / rejected 0)
- run-1 成果物: `./security-audit-yasumaro-run-1/`(REPORT.md / FINDINGS-DETAIL.md / NEEDS-VALIDATION.md / findings.json / coverage-ledger.json / architecture.md / run-metadata.json)。`.gitignore` の 128-129 行に `security-audit-yasumaro-run-*/`
- run-1 の source ref: `run-metadata.json` の `source_ref.commit` は `4790f224...`。**このコミットは現リポジトリの履歴に無い**(`git diff 4790f224 HEAD` が unknown revision)。旧リポジトリ名の clone で採った可能性がある。差分の起点は要確認。見つからなければ、run-1 台帳を追加したコミット `a1e3ffb23`(2026-11-12)を代わりの起点にし、その旨を run-3 台帳に書く
- run-2 は旧リポジトリ名時代の監査(`pbi/2026-10-18-00-backlog-security-audit-run2.md`)。番号は run-1 より前の実施だが、次の番号は run-3 とする(GA 台帳 `pbi/2026-11-24-00-backlog-ga-release.md` の採番どおり)

重点 3 領域の主要ファイル(すべて存在を確認済み):

1. webhook 送信先許可リストと保存時 pre-flight(コミット b76c618d0 ほか)
   - `src/background/webhookExport/webhookExportDestinations.ts`(許可リスト 31 件、`isUrlCoveredByHostPattern`、`judgeWebhookDestination`)
   - `src/background/webhookExport/webhookExportSettings.ts`(`evaluateWebhookExportSave` の祖父条項、`WEBHOOK_EXPORT_SETTINGS_KEY = 'webhook_export_settings_v1'`、URL は 2000 文字で切る)
   - `src/background/webhookExport/webhookExportSender.ts`(`defaultIsWebhookHostPermitted`、`redirect: 'error'`、`Idempotency-Key`、タイムアウト)
   - `src/background/webhookExport/webhookExportPayload.ts`(送信本文の組み立て、`isWebhookUrlAllowed`)
   - `src/background/webhookExport/webhookExportHistory.ts`
   - `src/background/pipeline/steps/webhookExportStep.ts`(記録パイプラインからの送信)
   - `src/dashboard/webhookExportSettings.ts`(保存 UI と再送。再送は `isPrivate: false` 固定)
2. Obsidian の If-Match / 412 再書き込み(コミット 1265d3f72)
   - `src/utils/obsidianConditionalWrite.ts`(`detectStrongEtag`、`withIfMatch`、`MAX_CONFLICT_REWRITES = 1`)
   - `src/background/obsidianClient.ts`
   - `src/background/pipeline/steps/saveToObsidianStep.ts`
   - `dev-docs/API_ENDPOINTS.md` の If-Match 節
3. ドメインポリシーの blob-tier reader(コミット 64354e9b6)
   - `src/utils/storage/blobTierRead.ts`(`readBlobFirst`、`SETTINGS_BLOB_STORAGE_KEY = 'settings'`)
   - `src/content/domainPolicyPort.ts`、`src/content/cleansingOffscreenDelegate.ts`(content script 側の読み手)
   - `src/utils/storage/settingsMigration.ts`
   - `src/utils/storage/__tests__/raw-owned-keys-audit-pin.test.ts`

### 重点領域で必ず見る観点
- webhook
  - 判定の一致: 保存時と送信時が同じ `judgeWebhookDestination` を通るか。再送(`defaultResend`)と記録パイプライン(`webhookExportStep.ts`)の両方で
  - マッチャーの迂回: `isUrlCoveredByHostPattern` に対し、ユーザー情報付き URL(`https://api.github.com@evil.example/`)、末尾ドット、大文字、IDN、IPv6、明示ポート `:443`、`*.openai.com` のサブドメイン任意性(利用者の任意サブドメインへ送れること自体の妥当性)
  - 許可リストの中身の妥当性: AI プロバイダーの API ドメインや `api.github.com` を webhook の宛先として許すことが、第三者のエンドポイントへの送信路にならないか(例: `api.github.com` の任意パスへ POST できる)。受容するなら理由を脅威モデルに書く
  - 祖父条項: 「保存済みと同じ URL」の比較が正規化前後で一致するか。http loopback が送信ゲートで必ず止まるか
  - token: URL に token を含められる前提で、表示(状態表示・履歴)が origin のみか、ログ・通知・診断・エラーメッセージ・バックアップ/エクスポートに URL 全文が出ないか。`webhook_export_settings_v1` が平文で `chrome.storage.local` にあり、`chrome.storage.local.setAccessLevel` の呼び出しがリポジトリに無い(content script からも読める既定のまま)ことの評価
  - 送信データ: マスク済みタイトル・マスク済み要約・タグ・URL のみか。記録の URL 自体(クエリに個人情報を含みうる)を送ることの扱い。プライバシー判定の無い記録を送らない条件が、再送の `isPrivate: false` 固定で崩れないか
  - リダイレクト: `redirect: 'error'` が再送経路(dashboard 側の `fetch`)にも付いているか
- Obsidian If-Match / 412
  - サーバー応答の `ETag` をヘッダーへ反映する経路の検証(弱い ETag と空値は無条件書き込み)。不正な値で `Headers.set` が例外を投げたときに記録が失われないか
  - 再書き込みが 1 回で止まるか。2 回目の 412 が保存失敗として利用者に伝わるか(2026-11-24-05 の通知と整合するか)
  - 再書き込み時に、他端末で追加された内容を消さないか(GET から PUT までのやり直しで本文を組み直すか)。Authorization ヘッダーの再送が想定外の宛先に向かわないか
- blob-tier reader
  - content script から `settings` の blob 全体を読むことになった場合、blob に API キーなどの秘密が含まれるか、content script の到達範囲(isolated world)で十分か
  - blob 優先・top-level フォールバックの規約を迂回する raw reader が残っていないか(`raw-owned-keys-audit-pin.test.ts` の対象外のキー)
  - blob と top-level の値がずれた状態で、ドメインポリシー(AI 送信の許可・要約なし・マスク必須)が緩い側に倒れないか

### webhook 脅威モデルの追記先と書く内容
- 追記先: `dev-docs/SECURITY_REVIEW_GUIDE.md`。「Threat Model Overview」の表(22 行目付近)に行を足し、既存の「SSRF guard」節と同じ粒度で独立の節を作る
- 書く内容(最新仕様のスナップショットのみ。経緯や PBI 番号の羅列は書かない)
  - 送信データ: 何を送り、何を送らないか(本文を送らない、プライバシー判定の無い記録を送らない、PII マスクの適用箇所)
  - 宛先: https ∩ 専用許可リスト(31 件の固定コピー)。manifest の変更で自動的に広がらないこと。CSP の connect-src が二層目であること(connect-src は 63 origin で許可リストより広い)。`redirect: 'error'`
  - token: URL に含まれうる前提、表示は origin のみ、保存場所と保護レベル
  - 残余リスク: 監査で受容した点(例: 許可リスト内の第三者エンドポイントへの送信路、storage の平文保存)と受容の理由
- 同時に、古い記述を洗い出す。確認済みの箇所:
  - `PERMISSIONS.md` の Reviewer Notes 2(184 行目付近)「送信先 origin が host_permissions に宣言されていない場合はネットワークに出さず遮断」
  - `entrypoints/options/index.html` の `webhookExportDescription` の既定文「Undeclared destinations are blocked」と対応する messages.json(en/ja)
  - `src/dashboard/webhookExportSettings.ts` と `src/background/webhookExport/webhookExportPayload.ts` のコメント(`getManifest()` を読むという旧記述)。2026-11-24-06 で直っていればそれでよい

### 実施手順
1. 2026-11-24-05 と 2026-11-24-06 がマージ済みであることを確認する。handoff ファイルも読む
2. run-1 の `run-metadata.json` と REPORT.md を読み、profile・フェーズ・成果物の構成を合わせる
3. 差分の起点を決める(`4790f224` が見つからなければ `a1e3ffb23` を使い、台帳に書く)
4. security-audit スキルを起動し、成果物の出力先を `/Users/yaar/Playground/yasumaro/security-audit-yasumaro-run-3/` にする。重点 3 領域と上の観点を、スキルへの入力(範囲の指定)に含める
5. 完走後、`git -C /Users/yaar/Playground/yasumaro status --short` で成果物が追跡外になっていることを確認する
6. run-3 台帳を `pbi/` に作る(run-1 台帳と同じ節: 出所 / 結果 / 成果物の恒久置き場 / 発見ごとの要約 / 次のアクション)。`pbi/00-INDEX.md` にも登録する
7. confirmed の発見ごとに修正 PBI を起票する(pbi-create-bdd の書式、発火デモ必須)
8. `dev-docs/SECURITY_REVIEW_GUIDE.md` に webhook の脅威モデルを追記し、古い記述を直す。`PERMISSIONS.md` を直す場合、`public/PRIVACY.md` と `docs/PRIVACY.md` に同じ記述があれば両方を同じ内容にする
9. `node /Users/yaar/Playground/yasumaro/scripts/check-docs-chars.mjs` と `npm --prefix /Users/yaar/Playground/yasumaro run validate` を回す

### 落とし穴
- 成果物を `git add` しない。台帳だけを個別に add する(`git add -A` は使わない)
- 監査成果物は workspace 内にしか無い。端末を移すときは別途持ち出す(run-1 台帳の注記)
- 監査中にコードを直さない。修正は発見ごとの PBI で行い、監査対象のコードを固定する
- 2026-11-24-02(開発中機能の判定)で webhook や Gist 同期を正式版から外す判定になった場合でも、コードが配布物に残るなら監査対象から外さない
- 監査結果で `PERMISSIONS.md` を変えると、2026-11-24-09(host_permissions の最小化)と同じ節を触る。先にマージした方に合わせて後の方を直す

## Definition of Done
- [ ] 全 BDD シナリオを満たしたことが、run-3 台帳と成果物で確認できる
- [ ] confirmed の発見がすべて PBI 化または受容記録済み
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` に webhook の脅威モデルがある
- [ ] `npm run validate` が緑(文字種の検査を含む)
- [ ] コードレビュー完了(台帳と文書の PR。セキュリティ観点の確認を PR 説明に明記)
- [ ] ドキュメント更新済み(SECURITY_REVIEW_GUIDE、必要なら PERMISSIONS / PRIVACY)

## 引き継ぎ
状態: 監査完走。修正 PBI 15〜17 を起票済み。owner の製品判断 3 件が残っている。進捗と引き継ぎ情報は [handoff/2026-11-24-07-release-ga-security-audit-run3.md](handoff/2026-11-24-07-release-ga-security-audit-run3.md) に記録した。成果物は `./security-audit-yasumaro-run-3/`(追跡外)。
