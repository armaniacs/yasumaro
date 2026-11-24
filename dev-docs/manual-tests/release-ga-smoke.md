# 正式版スモークテスト チェックリスト

正式版の配布物(ストアに上げるのと同じビルド)で主要 10 フローを 3 ブラウザで確認する。自動テストで覆えない層だけを手動で見る。版固有の記録は末尾の実施ログにだけ書く。

## 準備

- 配布用ビルドを作る(`OW_E2E_PROBE` が 0 か未設定であることを先に確認する。`OW_E2E_PROBE=1` が残っていると probe 入りになる)
  - Chrome: `OW_E2E_PROBE=0 npx wxt zip -b chrome`
  - Firefox: `OW_E2E_PROBE=0 npx wxt zip -b firefox`
  - Edge: `OW_E2E_PROBE=0 npx wxt zip -b edge`
- 作った zip を展開し、ブラウザごとに新しいプロファイルで読み込む
  - Chrome は `chrome://extensions`、Edge は `edge://extensions` で「パッケージ化されていない拡張機能を読み込む」
  - Firefox は `about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む」で `manifest.json` を選ぶ(一時的なアドオンは再起動で消えるため、再起動をまたぐ項目は `dev-docs/TESTING_GUIDE.md` の Firefox 手順に従う)
- 外部環境を用意する: Obsidian + Local REST API、AI プロバイダーの API キー、Ollama か LM Studio、mkcert の OS 信頼 CA
- 実施ログやスクリーンショットに API キー、Obsidian の API キー、webhook の token を写さない
- 日本語 UI と英語 UI は少なくとも 1 ブラウザで両方確認する(ブラウザの UI 言語を変えたら拡張を再読み込みする)

## 必須 10 フロー

| # | 検証項目 | 手順 | 期待結果 | なぜ E2E で不可 |
|---|---|---|---|---|
| 1 | 初回起動 | 新しいプロファイルで拡張を開く。同意を確認し、3 択バナー(まず試す / Obsidian / AI)から選ぶ。閉じて再読み込みする | 同意とバナーが出て、閉じた後は再読み込み後も出ない | 新しいプロファイルの初回起動は Playwright の拡張コンテキストで再現しない |
| 2 | 自動記録 | 記録条件(滞在時間・スクロール)を満たすページと満たさないページをそれぞれ開く | 満たしたページだけ記録され、満たさないページは記録されない | 実ページの滞在とスクロールの実時間の挙動 |
| 3 | 手動記録 | ポップアップの記録ボタン、アドレスバー(キーワード `y`)、ショートカット(`Alt+Shift+Y`)、右クリックメニューの順に記録する | 4 経路とも記録される | omnibox とショートカットと右クリックは拡張コンテキスト外のブラウザ UI |
| 4 | Obsidian 保存と競合 | デイリーノートに追記されることを確認する。Obsidian 側で同じノートを編集した直後に保存する。利用中の Local REST API が ETag を返さない場合は「保留(ETag なし)」と記録し、通常の保存が成功することだけ確認する | 競合時は 1 回だけやり直され、内容が消えない。2 回目も競合なら保存失敗として通知される(2026-11-24-05 の通知) | 実 Obsidian の同時編集と 412 の再現。ETag 対応は外部要因 |
| 5 | AI 要約 | 外部プロバイダー 1 つ以上、ローカル(Ollama か LM Studio)1 つ、可能ならブラウザ内蔵 AI で要約する。要約なしでも記録だけ残ることを確認する | 各 AI で要約が付き、要約なしでも記録が残る | 実 API キーと実ローカルモデルと実ブラウザ内蔵 AI |
| 6 | ローカル Markdown | 書き出しを実行し、`downloads` のファイルを開く | ファイルが保存され、内容が記録と一致する | 実 downloads のファイルと内容の目視 |
| 7 | プライバシー確認 | プライベートページ(`Cache-Control: private` など。`dev-docs/manual-tests/whitelist-privacy-bypass.md` の `https://httpbin.org/response-headers?Cache-Control=private` を使う)を開く。保存と保存しないの両方を試す。PII マスクとドメイン別 AI 送信政策(送信を許可・要約なしで記録・マスク必須)を確認する | 確認が出て、両方の選択が効く。マスクと政策どおりになる | 実サイトのヘッダー応答と実通知からの撤回操作 |
| 8 | バックアップと復元 | 暗号化バックアップ(分割形式を含む)を書き出す。別の新しいプロファイルで復元し、件数と検索結果を比べる。誤ったパスフレーズでは復元されないことを確認する | 件数と検索結果が一致する。誤ったパスフレーズは拒否される | 別プロファイル間の復元と実パスフレーズ操作 |
| 9 | 全データ削除 | 確認ダイアログで削除し、履歴・検索・設定の表示を見る。キャンセルでは何も消えないことも確認する | 削除後は履歴・検索・設定が空になる。キャンセルは何も消さない | 実確認ダイアログの両分岐の目視 |
| 10 | webhook | `docs/MCP_BRIDGE_RECIPE.md` の手順で受け口を立てる(OS 信頼 CA の証明書必須)。許可リスト内の https loopback 宛先に送信が届くことを確認する。リスト外と http は保存時に理由付きで拒否されることを確認する。履歴と状態表示に URL 全文(token)が出ないことを確認する | 届く。拒否される。全文が出ない | 実 TLS の受け口と実送信の到達確認 |

## 結果記録表

| # | Chrome | Edge | Firefox | 備考 |
|---|---|---|---|---|
| 1 | 未 | 未 | 未 | |
| 2 | 未 | 未 | 未 | |
| 3 | 未 | 未 | 未 | |
| 4 | 未 | 未 | 未 | ETag なしの環境では「保留(ETag なし)」と書く |
| 5 | 未 | 未 | 未 | 使った AI を備考に書く |
| 6 | 未 | 未 | 未 | |
| 7 | 未 | 未 | 未 | |
| 8 | 未 | 未 | 未 | |
| 9 | 未 | 未 | 未 | |
| 10 | 未 | 未 | 未 | 受け口の URL を備考に書く(token なし) |

## 自動テストとの対応表

| # | E2E で覆っている部分 | spec |
|---|---|---|
| 1 | オンボーディングバナー、プライバシー同意 | `testDir/e2e/onboarding-banner.spec.ts`、`testDir/e2e/privacy-consent.spec.ts` |
| 2 | content script の記録判定 | `testDir/e2e/content-script-recording.spec.ts` |
| 3 | ポップアップの記録ボタン | 対応する popup 系 spec(詳細は TESTING_GUIDE) |
| 4 | 412 の 1 回再書き込みと通知・保留の分岐 | `src/background/pipeline/__tests__/RecordingPipeline.test.ts`、`recordingOutcome.test.ts`(単体) |
| 5 | プロバイダー別の要約分岐 | 対応する provider 系テスト(実 API 呼び出しは手動のみ) |
| 6 | Markdown 書き出しの内容 | 対応する step の単体テスト(実 downloads は手動のみ) |
| 7 | プライバシー判定とマスク | 対応する pipeline テスト(実通知の操作は手動のみ) |
| 8 | 暗号化バックアップの分割形式 | `testDir/e2e/encrypted-backup-split.spec.ts` |
| 9 | 全削除の確認ダイアログ分岐 | 対応する panel テスト(実表示の目視は手動のみ) |
| 10 | 保存 pre-flight と送信ゲートと CSP | `testDir/e2e/webhook-egress.spec.ts` |

## 実施ログ

- 実施日:
- 拡張の版:
- OS:
- Chrome の版 / 結果:
- Edge の版 / 結果:
- Firefox の版 / 結果:
- 日本語 UI / 英語 UI の確認(どちらで何を見たか):
- 不合格と修正 PBI へのリンク:
