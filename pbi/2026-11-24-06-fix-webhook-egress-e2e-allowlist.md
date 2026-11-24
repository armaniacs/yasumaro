# PBI: webhook egress の E2E を専用許可リストと保存時 pre-flight に追従させる

## ユーザーストーリー
webhook export を使う利用者として、送信先の許可・拒否が実際のブラウザでも設定画面の表示どおりに働くと確かめられていてほしい、なぜなら判定の方式が host_permissions の参照から専用許可リストへ変わったのに、実ブラウザの E2E が旧方式のままだと、正式版で「保存できたのに送れない」「拒否されるはずの宛先が通る」といった回帰に気づけないから。

## 優先度
- 順位: 05/12
- RICE スコア: 3.0(Reach 3 × Impact 1 × Confidence 1.0 ÷ Effort 1)
  - Reach 3: webhook export は既定 OFF のオプトイン機能で、サイドバーの「開発中」区分にある。使う利用者は限られる
  - Impact 1: 利用者の挙動は変わらない。回帰を実ブラウザで検出できるようになる(検出力の改善)
  - Confidence 1.0: 判定源(`judgeWebhookDestination`)と保存処理(`saveWebhookExportSettings`)はコードで確定しており、追従先が明確
  - Effort 1: 変更は E2E の spec 1 本が中心
- 根拠: 点は低いが、作業が小さく、監査 run-3(07)が「送信先の判定が実ブラウザでも固定されているか」を確認する前提になるため、監査の前に置く
- 依存: なし。後続の 2026-11-24-07(監査 run-3)はこの PBI の完了後に最終コードを監査する

## ビジネス価値
- 保存時 pre-flight と送信時ゲートが同じ判定源を使うことを、単体テストだけでなく実ブラウザの拡張ページでも固定できる
- E2E の説明文と実装の食い違い(「ゲートは manifest の host_permissions を読む」という旧記述)がなくなり、監査や後続の改修で誤った前提を持ち込まない
- 測定方法: `webhook-egress.spec.ts` の許可・非許可・祖父条項の各シナリオが、`OW_E2E_PROBE=1` でビルドした `dist/chromium-mv3` に対して緑になること

## BDD受け入れシナリオ

```gherkin
Scenario: 許可リスト内の https 宛先は保存でき、許可と表示される
  Given 利用者が設定画面の「Webhook Export」パネルを開いている
  And   保存済みの webhook 設定が無い
  When  利用者が URL 欄に "https://127.0.0.1:27123/hook" を入れて保存する
  Then  状態表示に「Saved. Destination https://127.0.0.1:27123 is permitted.」が出る
  And   chrome.storage.local の webhook_export_settings_v1 にその URL が保存される

Scenario: 許可リスト外の宛先は理由付きで拒否され、保存されない
  Given 利用者が「Webhook Export」パネルを開いている
  When  利用者が URL 欄に "https://example.com/hook?token=secret" を入れて保存する
  Then  状態表示に「not in the webhook destination allowlist」を含む拒否理由が出る
  And   状態表示には origin "https://example.com" だけが出て、パスと "secret" は出ない
  And   webhook_export_settings_v1 は保存前の値から変わらない

Scenario: 初期集合にある http loopback の既存宛先は祖父条項で維持される
  Given webhook_export_settings_v1 に "http://127.0.0.1:27123/hook" が保存済みである
  When  利用者が URL を変えずに保存する
  Then  保存は成功し、状態表示は「preserved, but the send gate rejects it」を含むエラー表示になる
  And   同じ http loopback でも別の URL に変えて保存すると、https 必須の理由で拒否される

Scenario: 許可リスト外の origin への送信は拡張ページの CSP でも遮断される
  Given 拡張ページ(dashboard)が開いている
  When  ページから "https://example.com/webhook-hook" へ POST する
  Then  securitypolicyviolation が connect-src(または default-src)で発火する
```

## 受け入れ基準
- [ ] spec 冒頭の説明から、「送信ゲートは `chrome.runtime.getManifest()` の host_permissions を読む」という旧記述が消え、判定源が `WEBHOOK_EXPORT_DESTINATION_PATTERNS` / `judgeWebhookDestination` だと書かれている
- [ ] 許可・非許可(リスト外 / 非 https)・祖父条項・空 URL の各経路が E2E で確認されている
- [ ] 許可・非許可・祖父条項のうち少なくとも 1 経路ずつは、拡張ページの実 UI(`#webhookExportUrl` → `#webhookExportSaveBtn` → `#webhookExportStatus`)と `chrome.storage.local` を通して確認している(Playwright の Node プロセスで src を import して判定関数を呼ぶだけでは、ビルド済み拡張の挙動を確かめたことにならない)
- [ ] 拒否時の状態表示に URL 全文(パス・クエリ・token)が出ないことを確認している
- [ ] CSP による遮断の pin(example.com → 127.0.0.1:9)が残っている
- [ ] `chrome.permissions.contains` が example.com に true を返す事実の pin が残っている(付与済み集合では遮断できないことの根拠)
- [ ] 本番コードの判定ロジックは変更しない。古いコメントの修正のみ可(下記「落とし穴」参照)

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- `testDir/e2e/webhook-egress.spec.ts`(`@extension` タグ、`extension` プロジェクトで実行)
  - CSP: 許可リスト外 origin への fetch が connect-src で遮断される(既存の pin を維持)
  - 付与済み集合: `chrome.permissions.contains({ origins: ['https://example.com/*'] })` が true(既存の pin を維持)
  - 保存 UI: 許可(https loopback)、リスト外(example.com、token 付き)、非 https の新規、祖父条項(http loopback を事前に storage へ投入)、空 URL
- 英語ロケール(`test.use({ locale: 'en-US' })` か既存 fixture の既定)で文言を照合する。日本語の文言は `chrome.i18n` がブラウザの UI 言語に固定されるため E2E では切り替えられない(`docs/MANUAL_TEST_ARCHIVE.md` の Y1 と同じ制約)。日本語は手動スモーク(2026-11-24-08)で確認する

### 統合テスト
- 追加しない。保存と送信の同一判定源は `src/background/webhookExport/__tests__/webhookExportDestinations.test.ts` の「保存時判定と送信時判定が全 URL で一致する」で固定済み

### 単体テスト
- 追加しない。表駆動の判定は `webhookExportDestinations.test.ts`、祖父条項は `webhookExportSettings.test.ts` で固定済み

## 実装アプローチ
- **Outside-In**: 実 UI を通す保存シナリオを先に書き、ビルド済み拡張で緑になることを確認する。判定ロジックは既存で、実装の追加は想定しない
- **Red-Green-Refactor**: 旧方式の記述・旧方式の期待値を持つ箇所を、新方式の期待値に書き換えて赤を確認してから直す。Node 側 import だけで判定関数を呼ぶテストは、実 UI 経由の確認に置き換えるか、単体テストと重複するなら削る
- **リファクタリング**: 緑の後、spec 冒頭の説明を最新仕様のスナップショットだけにする(経緯は書かない)

## 見積もり
1 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 実 UI 経由のテストは、拡張ページの DOM と `chrome.storage.local` だけで観測できる。ネットワーク送信は発生しない(保存時 pre-flight は送信しない)
- 非機能要件: 状態表示は origin のみ(token 秘匿)。この性質を E2E でも固定する
- 二重の防御の関係: CSP の connect-src(`wxt.config.ts` の `extension_pages`)は必須 31 件 + 任意 32 件の計 63 origin を含み、webhook 許可リスト(31 件)より広い。CSP の pin は「リスト外かつ CSP 外」の origin(example.com)でしか成立しない。CSP 内だがリスト外の origin(例: `https://api-inference.huggingface.co`)は、送信ゲートだけが止める
- ロールバック手段: テストのみの変更なので、spec を戻せば元に戻る

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。着手前に必ず再実行すること。

```bash
rtk proxy grep -n -e "getManifest" -e "judgeWebhookDestination" -e "saveWebhookExportSettings" /Users/yaar/Playground/yasumaro/testDir/e2e/webhook-egress.spec.ts
rtk proxy grep -rn -e "getManifest" /Users/yaar/Playground/yasumaro/src/background/webhookExport /Users/yaar/Playground/yasumaro/src/dashboard/webhookExportSettings.ts
git -C /Users/yaar/Playground/yasumaro log --oneline -3 -- testDir/e2e/webhook-egress.spec.ts
```

確認結果:
- 判定源: `src/background/webhookExport/webhookExportDestinations.ts` の `WEBHOOK_EXPORT_DESTINATION_PATTERNS`(31 件の固定コピー)と `judgeWebhookDestination`(https ∩ 許可リスト)
- 送信ゲート: `src/background/webhookExport/webhookExportSender.ts` の `defaultIsWebhookHostPermitted` は `judgeWebhookDestination(url).permitted` を返すだけ。manifest は読まない
- 保存時 pre-flight: `src/background/webhookExport/webhookExportSettings.ts` の `evaluateWebhookExportSave` / `saveWebhookExportSettings`。拒否は `WebhookDestinationBlockedError` を投げ、storage に書かない。祖父条項は「保存済みと同じ URL かつ許可リスト内」のときだけ
- 保存 UI: `src/dashboard/webhookExportSettings.ts`。要素 ID は `webhookExportEnabled` / `webhookExportUrl` / `webhookExportSaveBtn` / `webhookExportStatus` ほか。状態表示は `textContent` で、成功は class `success`、拒否と祖父条項は class `error`
- パネルの開き方: `[data-panel="panel-webhook-export"]` をクリック(`entrypoints/options/index.html` の 324 行付近。サイドバーの「In Development」区分)。他 spec の例は `testDir/e2e/gist-egress.spec.ts` の `[data-panel="panel-export-import"]`
- storage キーと値の形: `webhook_export_settings_v1` に `JSON.stringify({ enabled, url, condition })` の文字列
- 英語の文言: `public/_locales/en/messages.json` の `webhookExportDestinationPermitted` / `webhookExportDestinationGrandfathered` / `webhookExportDestinationNonHttps` / `webhookExportDestinationNotInAllowlist`
- spec の現状(2026-11-24 時点の HEAD 545b6be50): 旧方式の記述は既に消え、3 本(CSP / 判定源 / 保存時 pre-flight)に書き換え済み。ただし 2 本目と 3 本目は `../../src/...` を Playwright の Node プロセスで import して判定関数を直接呼んでおり、拡張ページ内では実行していない。3 本目は `dashboardPage` も使っていない。受け入れ基準の「実 UI 経由」はまだ満たしていない。進捗は handoff ファイルを先に読むこと

### E2E の実行方法
- 設定: `testDir/playwright.config.ts`。`@extension` タグの spec は `extension` プロジェクト(`workers: 1`、`timeout: 60_000`、`channel: 'chromium'`)で走る
- 拡張の読み込み元: `testDir/e2e/fixtures/launchExtensionContext.ts` の `EXTENSION_PATH`(`dist/chromium-mv3`)。先にビルドが必要
- E2E probe: `OW_E2E_PROBE=1` を付けてビルドする(CI の `.github/workflows/tests.yml` の test ジョブと同じ。付けないと probe が除去され、probe 依存の spec が起動待ちで落ちる)
- ホスト名の付け替え: 同ファイルの `--host-resolver-rules` で `example.com:443 → 127.0.0.1:9`(死にポート)、`api.github.com:443 → 127.0.0.1:8444`、`api.openai.com:443 → 127.0.0.1:8443`
- TLS 証明書: `testDir/e2e/fixtures/dev-server-cert.pem` / `dev-server-key.pem` は gitignore 対象。無ければ CI と同じ `openssl req -x509 ...`(tests.yml の「Generate dev-server TLS certificate」)で作る
- headless では拡張の SW が起動せず `test.fixme` になる(`HEADLESS_FIXME_MESSAGE`)。macOS のローカル実行はそのままでよい。CI は `xvfb-run` で包む

```bash
OW_E2E_PROBE=1 npm --prefix /Users/yaar/Playground/yasumaro run build
npx --prefix /Users/yaar/Playground/yasumaro playwright test --config /Users/yaar/Playground/yasumaro/testDir/playwright.config.ts --project=extension /Users/yaar/Playground/yasumaro/testDir/e2e/webhook-egress.spec.ts --reporter=line
```

(環境変数付きの 1 行がシェル設定で拒否される場合は、スクラッチパッドにスクリプトを書いて単独で実行する)

### 実装手順
1. 上の確認コマンドと handoff ファイルで現状を把握する
2. 保存 UI のシナリオを spec に追加する。パネルを開き、`#webhookExportUrl` に値を入れ、`#webhookExportSaveBtn` を押し、`#webhookExportStatus` の文言と class、`chrome.storage.local.get('webhook_export_settings_v1')` を確認する
3. 祖父条項は、先に `page.evaluate` で `chrome.storage.local.set({ webhook_export_settings_v1: JSON.stringify({ enabled: true, url: 'http://127.0.0.1:27123/hook', condition: {} }) })` を投入し、パネルを開き直して(フォームに読み込まれたことを確認してから)保存する
4. token 付き URL の拒否で、状態表示に `secret` もパスも含まれないことを確認する
5. Node 側 import だけで判定関数を呼ぶテストを、実 UI 経由の確認と重複する範囲で整理する(残すなら「単体テストの写し」であることが分かる名前にするか、削る)
6. spec 冒頭の説明を最新仕様に合わせる
7. 上の実行方法でビルドと E2E を回し、緑を確認する。続けて `npm --prefix /Users/yaar/Playground/yasumaro run validate`

### 落とし穴
- ビルドし直さずに E2E を回すと、古い `dist/chromium-mv3` を検査してしまう。src を変えたら必ずビルドする
- 状態表示は非同期に更新される。固定の sleep で待たず、`expect(locator).toHaveText(...)` の自動待機を使う(`dev-docs/TEST_RULE.md` の実時間待ちの禁止)
- パネルの `load()` は表示時に storage からフォームへ値を入れる。祖父条項の検証で、投入前にパネルを開いていると古い値で保存してしまう
- webhook のパネルは「開発中」区分にある。区分の扱いが 2026-11-24-02(開発中機能の判定)で変わり、パネルが隠される・既定で無効になる場合は、開き方を追従させる
- 古いコメントが本番コードに 3 か所残っている(判定ロジックは正しい)。直すならこの PBI の範囲で、コメントのみ変える
  - `src/dashboard/webhookExportSettings.ts` の `defaultResend` 内(80-84 行付近)「`defaultIsWebhookHostPermitted → chrome.runtime.getManifest()`」
  - `src/background/webhookExport/webhookExportPayload.ts` の 85 行付近の同趣旨の記述
  - `entrypoints/options/index.html` の `webhookExportDescription` の既定文「Undeclared destinations are blocked」と、対応する `messages.json` の文言(i18n の文言変更は en/ja 両方。範囲外にするなら監査 run-3 の確認項目に回す)
- oxlint は testDir を対象外にしているため、spec の静的検査は型検査(`npm run type-check`)頼みになる

## Definition of Done
- [ ] 全 BDD シナリオが E2E として実装され、ビルド済み拡張に対してパスする
- [ ] `npm run validate` が緑
- [ ] CI の test ジョブ(`--grep @extension`)が緑
- [ ] コードレビュー完了
- [ ] spec 冒頭の説明が最新仕様のスナップショットになっている
- [ ] ドキュメント更新済み(コメント修正を範囲に入れた場合はその箇所)

## 引き継ぎ
状態: 完了。進捗と引き継ぎ情報は [handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md](handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md) に記録した。`1124a` の `a24be47be` に取り込み済み。残りの見送り文言は監査 run-3 の確認項目に回す。
