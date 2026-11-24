# PBI: 必須 host_permissions の最小化(一部 AI プロバイダーを任意権限へ移す)

## ユーザーストーリー
Yasumaro を入れる利用者として、自分が使わない AI プロバイダーへの通信権限まで最初から与えずに済むようにしたい、なぜなら必須の host_permissions に使う予定のない事業者のドメインが並んでいると、拡張が何に通信するのか不安になり、最小権限の原則からも外れるから。

## 優先度
- 順位: 08/12
- RICE スコア: 1.6(Reach 8 × Impact 2 × Confidence 0.5 ÷ Effort 5)
  - Reach 8: 新規に入れる利用者全員が権限の一覧を見る。既存利用者のうち、移す対象のプロバイダーを使う人は再許可の影響を受ける
  - Impact 2: 権限の一覧が利用者の選んだものに絞られる。ストア審査で説明する必須権限が減る
  - Confidence 0.5: 効果と影響の両方に未確認の点がある。content script が `<all_urls>` に一致するため、Chrome の導入時警告は変わらない可能性が高い。権限を必須から任意へ移したときに、既存利用者の付与状態が更新後も残るかはブラウザごとに要確認
  - Effort 5: SSOT の行の変更は小さいが、既存利用者の再許可導線、webhook 許可リストの pin の付け替え、manifest の pin、文書(PERMISSIONS / README / PRIVACY / ADR)の更新、3 ブラウザでの更新試験を含む
- 根拠: セキュリティ上は望ましいが、効果が未確定で既存利用者への影響がある。GA 台帳の方針どおり正式版の必須条件にはせず、2026-11-24-02 の判定時に GA 直後の最初の改善として扱うかを決める
- 依存: なし。ただし webhook 初期許可集合の pin(`webhookExportDestinations.test.ts`)と結合している。`PERMISSIONS.md` は 2026-11-24-07(監査 run-3)でも触る可能性があるため、後からマージする方が合わせる。GA 前に入れる場合は、2026-11-24-08(実機スモーク)をこの PBI の後にやり直す

## ビジネス価値
- 必須の host_permissions が「ローカル + 主要 AI プロバイダー + Gist」に絞られ、その他のプロバイダーは利用者が選んだときだけ許可を求める
- `PERMISSIONS.md` の必須権限の正当化が、実際に全員が必要とするものだけになる
- webhook の既存宛先は、権限の移動の影響を受けずに送信できる(専用許可リストの固定コピーで維持)
- 測定方法: 配布用 manifest の `host_permissions` の件数が減り、移した origin が `optional_host_permissions` にあること。移したプロバイダーを選んだときだけ許可ダイアログが出ること。webhook の判定結果が移動の前後で全 URL について同じであること

## BDD受け入れシナリオ

```gherkin
Scenario: 移したプロバイダーを選ぶと、その時だけ許可を求められる
  Given 新しいプロファイルに、最小化後の拡張を入れた
  And   必須の host_permissions に "https://api.mistral.ai/*" が無い
  When  利用者が設定画面で AI プロバイダーに Mistral を選ぶ
  Then  "https://api.mistral.ai/*" の許可ダイアログが出る
  And   許可すると要約の生成が成功する
  And   拒否すると、要約なしで記録だけが残り、許可が無いことが設定画面に表示される

Scenario: 既存利用者は更新後に案内されて再許可できる
  Given 更新前の版で Mistral を選んで使っていた利用者がいる
  When  拡張が最小化後の版に更新される
  Then  更新時に新しい権限の警告は出ない
  And   "https://api.mistral.ai/*" の付与が失われている場合は、設定画面を開いたときに再許可の案内とボタンが出る
  And   ボタンを押して許可すると、次の記録から要約が生成される

Scenario: webhook の既存宛先は権限の移動で壊れない
  Given webhook の宛先に "https://api.mistral.ai/hook" を保存済みである
  When  "https://api.mistral.ai/*" が任意権限へ移った版に更新する
  Then  webhook の保存時判定と送信時判定は、どちらも許可のままである
  And   webhook の許可リストは 31 件の固定コピーのまま変わらない

Scenario: 新しく必須に足された origin は webhook の許可リストを広げない
  Given 別の機能のために必須 host_permissions へ新しい origin が足された
  When  単体テストを実行する
  Then  webhook 許可リストの pin が赤になり、許可リストの見直しを求める
```

## 受け入れ基準
- [ ] 移す対象を決め、理由を ADR に記録した(候補と判定基準は下記「実装者向け注記」)
- [ ] 移した origin は `host_permissions` から消え、`optional_host_permissions` に入った。CSP の connect-src の集合(必須 + 任意 = 63 origin)は変わらない
- [ ] 移したプロバイダーを選んだときに `chrome.permissions.request` で許可を求める(利用者の操作の中で呼ぶ)
- [ ] 既存利用者が付与を失った場合に、設定画面で再許可の案内とボタンを出す。案内は日英(`data-i18n`)
- [ ] OpenAI 互換プロバイダーの base URL に、移した origin(例: `https://api.deepseek.com`)を設定している利用者も、同じく案内される
- [ ] webhook 許可リスト `WEBHOOK_EXPORT_DESTINATION_PATTERNS` は 31 件のまま変えない。pin を「宣言 host_permissions と一致」から「31 件の固定リテラルと一致」に付け替え、「新しく必須に足された origin は許可リストに入らない」ことを別の pin で固定した
- [ ] webhook の保存時判定と送信時判定が、移動の前後で同じであることを表駆動で確認した
- [ ] `src/__tests__/manifest.test.ts` の件数と構成の pin を新しい構成に合わせた
- [ ] `PERMISSIONS.md` の host_permissions の節と Update History を更新した。webhook の Reviewer Notes の古い記述(「host_permissions に宣言されていない場合は遮断」)も直した
- [ ] README / PRIVACY(`docs/` と `public/` の 2 ファイルは同一)/ 設定画面の移行文言の「宣言 31 パターン」を、「初期集合 31 パターン」など宣言集合と切り離した表現に直した
- [ ] 既存利用者への影響(再許可の要否)を、Chrome / Edge / Firefox で更新試験して記録した
- [ ] 文書は Shift-JIS 範囲の文字のみ

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- `@extension` の E2E で、配布用 manifest(`dist/chromium-mv3`)の `host_permissions` に移した origin が無く、`optional_host_permissions` にあることを確認する
- 既存の `testDir/e2e/webhook-egress.spec.ts` の CSP と付与済み集合の pin が緑のままであること
- 許可ダイアログはブラウザの UI で、Playwright から操作できない。ダイアログの表示と再許可の導線は手動(2026-11-24-08 のチェックリストに追加)

### 統合テスト
- 設定画面の再許可の案内: 選択中のプロバイダーの origin が `chrome.permissions.contains` で false のときに案内を出し、true なら出さない(`chrome.permissions` をモック)
- webhook: 移した origin を宛先にした保存と送信が、移動前と同じ判定になる(`webhookExportDestinations.test.ts` の「保存時判定と送信時判定が全 URL で一致する」に、移した origin の URL を足す)

### 単体テスト
- `providerAllowlist.ts` の行の `permissionTier` 変更で、`deriveRequiredDomains` / `deriveOptionalDomains` の結果が期待どおりになる
- `manifest.test.ts`: 必須の件数と構成、任意の一覧、必須 + 任意の合計(63 のまま)
- `webhookExportDestinations.test.ts`: 31 件の固定リテラルとの一致、必須 host_permissions に新しい origin を足しても許可リストが変わらないこと

## 実装アプローチ
- **Outside-In**: まず manifest の pin と webhook の pin を新しい期待値に書き換えて赤を確認し、SSOT の行を変えて緑にする。次に再許可の案内を統合テストから書く
- **Red-Green-Refactor**: pin の付け替えは、「宣言集合に一致」の検証を消す前に「固定リテラルに一致」の検証を足し、両方が緑の状態を一度作ってから古い方を消す
- **リファクタリング**: 再許可の案内は、既存の `requestAIProviderPermission`(`src/dashboard/settings/aiProvider.ts`)と `CspSettingsController.hasPermission` / `requestProviderPermission`(`src/dashboard/cspSettings.ts`)を使い、新しい権限判定の経路を増やさない

## 見積もり
5 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: webhook 初期許可集合の pin。`PERMISSIONS.md` を触る 2026-11-24-07
- テスタビリティ: SSOT(`providerAllowlist.ts`)の行から manifest と CSP が派生するため、行の変更は単体テストで検証できる。ブラウザの許可ダイアログと更新時の付与状態は手動
- 非機能要件(セキュリティ): 最小権限。任意権限の要求は対象 origin だけに限り、`<all_urls>` を任意権限に入れない(`wxt.config.ts` の既存方針)
- 効果の限界: 配布用 manifest の `content_scripts` は `matches: ["<all_urls>"]` で、Chrome は導入時に「すべてのサイトのデータの読み取りと変更」の警告を出す。必須 host_permissions を減らしてもこの警告は残る可能性が高い。また Chrome では content script の一致によって全 origin が付与済み扱いになる(`webhook-egress.spec.ts` の pin で `chrome.permissions.contains` が example.com に true)。この場合、移した origin への通信も Chrome では実質的に止まらず、効果は権限の宣言と説明の整理にとどまる。効果の大きさは Firefox での扱いに左右される(要確認)
- 既存利用者への影響(必ず確認する)
  - 必須から任意へ移すのは権限の削減なので、更新時に新しい警告や再承認は出ないはず(要確認)
  - 更新前に必須として付与されていた origin が、更新後に任意権限として付与済みのまま残るか、失われるかはブラウザの実装次第(要確認)。失われる場合、そのプロバイダーを使っていた利用者は、案内に従って再許可するまで要約が生成されない(記録は要約なしで残る)
  - Chrome では content script の `<all_urls>` の付与で通信自体は通る可能性がある。それでも `permissions.contains` に頼る UI 表示が「許可なし」と出ないかは確認する
  - Firefox では、MV3 の host_permissions と content script の一致の扱いが Chrome と違う可能性がある(導入時に付与されるか、利用者が後から外せるか)。要確認
  - 再許可が必要な場合は、CHANGELOG とストアの更新説明に「Mistral などを使っている場合は設定画面で許可し直す」旨を書く
- webhook との結合
  - 送信先の判定は manifest を読まず、`WEBHOOK_EXPORT_DESTINATION_PATTERNS`(31 件の固定コピー)と `judgeWebhookDestination` で決まる。権限を移しても判定は変わらない
  - ただし実際の送信(fetch)には、CSP の connect-src とブラウザの host 権限が効く。CSP は必須 + 任意の両方を含むので変わらない。host 権限は、Chrome では content script の `<all_urls>` で付与済みと見込まれるが、Firefox で移した origin への送信が CORS などで失敗しないかは要確認。失敗する場合、webhook の既存宛先のうち移した origin のものは、判定は許可なのに送信で失敗する(「保存できたのに送れない」の再発)。その場合は、移した origin を webhook の宛先として使っている利用者に、許可の要求を出すか、該当宛先を許可リストから外すかを決める
- ロールバック手段: `providerAllowlist.ts` の該当行の `permissionTier` を `'required'` に戻せば manifest と CSP は元に戻る。ただし任意から必須へ戻すのは権限の追加なので、戻した版の更新時に警告や再承認が出る可能性がある(要確認)

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。着手前に必ず再実行すること。

```bash
rtk proxy jq -c "{h: .host_permissions | length, o: .optional_host_permissions | length, cs: .content_scripts}" /Users/yaar/Playground/yasumaro/dist/chromium-mv3/manifest.json
rtk proxy grep -n -e "permissionTier" /Users/yaar/Playground/yasumaro/src/utils/storage/providerAllowlist.ts
rtk proxy grep -n -e "host_permissions" -e "optional_host_permissions" /Users/yaar/Playground/yasumaro/wxt.config.ts
rtk proxy grep -n -e "toHaveLength(31)" -e "toEqual(declared)" /Users/yaar/Playground/yasumaro/src/background/webhookExport/__tests__/webhookExportDestinations.test.ts
rtk proxy grep -rn -e "宣言 31" -e "31 declared" /Users/yaar/Playground/yasumaro/README.md /Users/yaar/Playground/yasumaro/docs/PRIVACY.md /Users/yaar/Playground/yasumaro/entrypoints/options/index.html /Users/yaar/Playground/yasumaro/public/_locales/en/messages.json /Users/yaar/Playground/yasumaro/public/_locales/ja/messages.json
```

確認結果:
- 配布用 manifest(`dist/chromium-mv3/manifest.json`、6.9.76): `host_permissions` 31 件、`optional_host_permissions` 32 件、`content_scripts` は `matches: ["<all_urls>"]`
- 必須 31 件の内訳: ローカル 16(http/https × 127.0.0.1/localhost × 27123/27124/11434/1234)、AI 14(generativelanguage.googleapis.com、api.openai.com、*.openai.com、api.anthropic.com、api.groq.com、mistral.ai、api.mistral.ai、deepseek.com、api.deepseek.com、voyageai.com、volcengine.com、z.ai、wandb.ai、api.ai.sakura.ad.jp)、Gist 1(api.github.com)
- 生成元: `wxt.config.ts` の manifest の `host_permissions`(`buildLocalHostPermissions()` + `AI_PROVIDER_HOST_PERMISSIONS` + `GIST_EGRESS_HOST_PERMISSIONS`)と `optional_host_permissions`(`OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`)。定数は `src/utils/cspDomains.ts`、AI の必須/任意は `src/utils/storage/providerAllowlist.ts` の `PROVIDER_ALLOWLIST_ROWS` の `permissionTier` から `deriveRequiredDomains` / `deriveOptionalDomains` で派生。`*.openai.com` は `cspDomains.ts` の `withOpenaiWildcard` で `api.openai.com` の直後に差し込まれる
- CSP の connect-src: `buildConnectSrcDomains()` が必須 + 任意 + Gist を含むので、必須から任意へ移しても CSP は変わらない
- 任意権限の要求: `src/dashboard/settings/aiProvider.ts` の `requestAIProviderPermission`(プロバイダーの選択を変えたときだけ。`openai-compatible` は対象外)、`src/dashboard/cspSettings.ts` の `CspSettingsController.requestProviderPermission` / `hasPermission`、`src/utils/permissionManager.ts`
- ADR: `dev-docs/ADR/2026-03-20-manifest-host-permissions-minimization.md`。当時の任意権限には voyageai.com / volcengine.com / z.ai(ADR では `z-ai` と誤記)/ wandb.ai が入っていたが、現在は必須。必須へ戻した経緯と理由は要確認(`git -C /Users/yaar/Playground/yasumaro log --oneline -S "domain: 'wandb.ai', permissionTier: 'required'" -- src/utils/storage/providerAllowlist.ts` は 0192192c2「プロバイダドメイン知識の5重リストを中立行から派生」を返す。この時点で既に必須だった可能性があり、さらに前の履歴を追う)
- 結合しているテスト(確認済み):
  - `src/background/webhookExport/__tests__/webhookExportDestinations.test.ts`: `初期集合が宣言 host_permissions 集合（31 パターン）と一致する`(`declared` の 31 件と `toEqual`)、構成の pin(AI 14)、README / PRIVACY の「初期集合」文言
  - `src/__tests__/manifest.test.ts`: SSOT 構成との一致、`keeps host_permissions under the 40-entry cap (16 local + 14 AI provider + 1 Gist egress today)`、`keeps the total host permissions under 100 (63 today)`、`keeps the opt-in AI provider domains out of host_permissions`
  - `src/__tests__/providerTrianglePin.test.ts`、`src/utils/storage/__tests__/provider-domain-ssot.golden.test.ts`、`src/utils/__tests__/cspDomains.test.ts`、`src/utils/__tests__/cspValidator.test.ts`、`src/dashboard/__tests__/cspSettings-permission-request.test.ts`
- 文書の「宣言 31 パターン」: `README.md`(日英)、`docs/PRIVACY.md` と `public/PRIVACY.md`(日英、同一)、`entrypoints/options/index.html` の `webhookExportLegacyOrigins` の既定文、`public/_locales/en|ja/messages.json` の `webhookExportLegacyOrigins`
- `PERMISSIONS.md`: 「13. host_permissions」節は Gist の説明しか無い。Reviewer Notes 2 の webhook の記述が旧方式のまま

### 移す対象の候補と判定基準
- 候補(指示どおり): mistral.ai / api.mistral.ai、deepseek.com / api.deepseek.com、voyageai.com、volcengine.com、z.ai、wandb.ai
- 判定基準を ADR に書いて決める
  - 初回起動の 3 択バナーと AI 設定の既定の選択肢に出るプロバイダーは必須に残す(初回体験で許可ダイアログを挟まない)。該当するプロバイダーは要確認(`src/dashboard` のオンボーディングと AI 設定の既定値を確認する)
  - 埋め込み専用(voyageai.com など)や、apex ドメイン(mistral.ai、deepseek.com)で実際の API 呼び出しが `api.*` だけなら、そもそも権限が不要か確認する。不要なら任意へ移すのではなく削除も検討する。ただし webhook 許可リストには残る(固定コピー)
  - `conditionalCsp: true` の行(volcengine、z-ai、wandb、sakura)は cspValidator の条件付き CSP の表にも載っている。移したときに `src/utils/cspValidator.ts` の判定が変わらないか確認する
- 範囲外: ローカル 16 件(Obsidian / Ollama / LM Studio のポート)、Gist の api.github.com、主要プロバイダー(Gemini / OpenAI / Anthropic)。ローカルの https 11434 / 1234 などの見直しは別 PBI にする

### webhook の固定コピーの扱い
- `WEBHOOK_EXPORT_DESTINATION_PATTERNS` は変更しない(31 件、順序もそのまま)。モジュール冒頭の説明は「宣言集合の 2026-10-31 時点のスナップショット」であることを明記したまま、宣言集合との一致を前提にした文を直す
- pin の付け替え(`webhookExportDestinations.test.ts`)
  - 「初期集合が宣言 host_permissions 集合と一致する」を、「31 件の固定リテラル(テスト内に直書き)と一致する」に置き換える。リテラルはテストに直書きし、本番の定数から作らない(作ると自己一致になり pin にならない)
  - 「必須 host_permissions の各 origin のうち、許可リストに無いものは無い、または明示した例外だけ」を別の pin にする。新しく必須に足された origin は、この pin を赤にして許可リストの見直しを求める(宣言の追加で許可リストが自動で広がらない設計を保つ)
  - 「移した origin は任意権限にあり、許可リストにもある」ことを固定する(webhook の既存宛先が残る根拠)
- 送信の実際: Firefox で、移した origin への webhook 送信が付与なしで失敗するかを更新試験で確認する(上の技術的考慮事項)

### 実装手順
1. 上の確認コマンドを再実行し、件数と構成が変わっていないことを確かめる
2. 移す対象を判定基準で決め、新しい ADR を `dev-docs/ADR/` に書く(既存の 2026-03-20 の ADR を参照し、今回の判断と既存利用者への影響を記録する)
3. webhook の pin を付け替える(固定リテラルとの一致、宣言追加の検出、移した origin の扱い)。この時点では緑のまま
4. `manifest.test.ts` ほか SSOT 系の pin を新しい期待値に書き換えて赤を確認する
5. `providerAllowlist.ts` の該当行の `permissionTier` を `'optional'` にする。任意の一覧の順序が行の順序で決まるため、`optional_host_permissions` の並びが変わる。golden テストの期待値も合わせる
6. 再許可の案内を作る。設定画面の表示時に、選択中のプロバイダー(と OpenAI 互換の base URL)の origin が任意権限で未付与なら、案内とボタンを出す。ボタンのクリックで `chrome.permissions.request` を呼ぶ(利用者の操作の外では呼べない)。文言は en/ja の messages.json に追加し、`data-i18n` で表示する
7. `npm --prefix /Users/yaar/Playground/yasumaro run build` の後、`dist/chromium-mv3/manifest.json` の件数を確認する。Edge と Firefox も配布用ビルドで確認する
8. 更新試験: 現行版を入れて Mistral などを選んだプロファイルに、新しい版を上書きする。Chrome は `chrome://extensions` での再読み込みではなく、可能ならパッケージ更新に近い手順で行う(再読み込みと実際の更新で付与の扱いが違う可能性がある。手順は要確認)。付与の残存、警告の有無、要約の成否、webhook の送信を 3 ブラウザで記録する
9. 文書を更新する: `PERMISSIONS.md`(host_permissions の節を必須の内訳と理由で書き直し、Update History に 1 行足す、Reviewer Notes の webhook を直す)、README / PRIVACY(2 ファイル同一)/ 設定画面の移行文言、CHANGELOG(既存利用者向けの再許可の案内)
10. `npm --prefix /Users/yaar/Playground/yasumaro run validate` と `node /Users/yaar/Playground/yasumaro/scripts/check-docs-chars.mjs`

### 落とし穴
- webhook 許可リストを宣言集合から派生させる形に戻さない。派生にすると、他の機能の宣言追加で webhook の宛先が勝手に広がる
- pin のリテラルを本番の定数から組み立てない(自己一致で何も守らない)
- `chrome.permissions.request` は利用者の操作(クリック)の中でしか呼べない。設定画面の表示時や SW から呼ぶと失敗する
- 必須から任意へ移すのは削減だが、ロールバック(任意から必須へ戻す)は追加になり、更新時に警告が出る可能性がある。戻し方を ADR に書いておく
- `docs/PRIVACY.md` と `public/PRIVACY.md` は同一でなければならない(テストで固定済み)
- i18n の文言変更は en/ja の両方。`webhookExportLegacyOrigins` の文言を変えても、キーは変えない(テストがキーの存在を見ている)
- `PERMISSIONS.md` は 2026-11-24-07(監査 run-3)でも触る。競合したら後からマージする方が合わせる
- Chrome で効果が見えない(導入時の警告が変わらない)ことが分かった場合は、そこで止めて、続けるかを判断する。続けない場合も、確認した事実(警告の文言、付与の扱い)は ADR に残す

## Definition of Done
- [ ] 全 BDD シナリオが自動テスト(許可ダイアログと更新試験は手動の記録)で検証されている
- [ ] `npm run validate` が緑(文字種の検査を含む)
- [ ] コードレビュー完了(GitHub PR での approve を必須とする。権限変更のため、セキュリティ観点と既存利用者への影響を PR 説明に明記)
- [ ] 3 ブラウザの更新試験の結果が ADR か PR に記録されている
- [ ] ロールバック手段を ADR に記載した
- [ ] ドキュメント更新済み(PERMISSIONS.md、README、PRIVACY 2 ファイル、ADR、CHANGELOG)

## 引き継ぎ
状態: 未着手。進捗と引き継ぎ情報は [handoff/2026-11-24-09-fix-host-permissions-minimization.md](handoff/2026-11-24-09-fix-host-permissions-minimization.md) に記録する(ファイルが無ければ未着手)
