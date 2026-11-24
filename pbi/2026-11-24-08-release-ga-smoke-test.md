# PBI: 正式版前の実機スモークテスト(Chrome / Edge / Firefox)

## ユーザーストーリー
正式版を入れる利用者として、自分の使うブラウザで主要な流れが一通り動くことが、配布物そのもので確かめられていてほしい、なぜなら自動テストは Chromium の開発用ビルドが中心で、Firefox の拡張としての動作、Edge のストア版、実際の AI プロバイダーや Obsidian との接続は手でしか確かめられず、そこが壊れたまま正式版になると、最初の数日で記録が取れない・保存できないという実害が出るから。

## 優先度
- 順位: 07/12
- RICE スコア: 5.3(Reach 10 × Impact 2 × Confidence 0.8 ÷ Effort 3 ≒ 5.33)
  - Reach 10: 3 ストアの正式版利用者すべて
  - Impact 2: 主要フローの破損を配布前に止められる。自動テストで拾えない層(拡張としての Firefox、実 API、実 Obsidian)を覆う
  - Confidence 0.8: 手順は決められるが、実機で何が見つかるかは実施するまで分からない。Obsidian Local REST API の ETag 対応など、外部要因で確認できない項目が残りうる
  - Effort 3: 3 ブラウザ × 主要 10 フロー。チェックリストの作成を含む
- 根拠: 点は 03(リリース準備)より低いが、全コード変更の後の最終ゲートとして置く
- 依存: 2026-11-24-01 〜 2026-11-24-07 の完了後(監査 run-3 の修正を含む)。本 PBI の完了は 2026-11-24-04 の採番とリリース実行の前提。2026-11-24-09(host_permissions の最小化)は GA の必須条件にしない方針(GA 台帳)。09 を GA 前に入れると決めた場合は、09 の後に本スモークをやり直す

## ビジネス価値
- 配布物(ストアに上げるのと同じビルド)で、主要フローが 3 ブラウザで動くことを記録付きで示せる
- 自動テストで覆えない項目が「なぜ手動か」と一緒に一覧になり、次のリリースから同じ表を使い回せる
- 測定方法: チェックリストの全必須項目が 3 ブラウザで「合格」と記録され、不合格が 0 件(または修正 PBI 化済み)であること

## BDD受け入れシナリオ

```gherkin
Scenario: 配布物と同じビルドで 3 ブラウザの必須項目が合格する
  Given OW_E2E_PROBE=0 で作った Chrome / Edge / Firefox の配布用ビルドがある
  And   各ブラウザは拡張を入れたことのない新しいプロファイルである
  When  担当者がチェックリストの必須項目を順に実施する
  Then  全項目の結果が、ブラウザ・ブラウザの版・拡張の版・実施日と一緒に記録される
  And   必須項目に不合格が無い

Scenario: 不合格が見つかったら採番を止める
  Given スモークのどこかの必須項目が不合格である
  When  担当者が結果を記録する
  Then  不合格ごとに再現手順付きの修正 PBI が起票される
  And   修正が入るまで 2026-11-24-04 の採番は行わない
  And   修正後は、不合格だった項目と、その修正が触った領域の項目をやり直す

Scenario: 外部要因で確認できない項目は理由付きで保留にする
  Given 利用中の Obsidian Local REST API が ETag を返さない
  When  担当者が「Obsidian 保存と競合」の項目を実施する
  Then  競合検出の項目は「保留(ETag なし)」と理由付きで記録される
  And   ETag なしでも通常の保存が成功することは確認される
```

## 受け入れ基準
- [ ] チェックリストのファイルを `dev-docs/manual-tests/release-ga-smoke.md` に作った(置き場の根拠は下記「実装者向け注記」)
- [ ] チェックリストは「優先度別の表(番号 / 検証項目 / 手順 / 期待結果 / なぜ E2E で不可)」と「自動テストとの対応表」と「実施ログ」の 3 部構成(`docs/MANUAL_TEST_ARCHIVE.md` と同じ形)
- [ ] 下記 10 フローを必須項目として含む。各項目に Chrome / Edge / Firefox の列がある
- [ ] 実施は配布用ビルド(`OW_E2E_PROBE=0`)で行い、ビルドの作り方をチェックリストの冒頭に書いた
- [ ] 実施ログに、ブラウザの版、拡張の版、OS、実施日、合否、不合格時の PBI へのリンクを記録した
- [ ] 不合格は修正 PBI を起票し、修正後に再実施した
- [ ] 日本語 UI と英語 UI の文言を、少なくとも 1 ブラウザで両方確認した(`chrome.i18n` はブラウザの UI 言語に固定されるため E2E で切り替えられない)
- [ ] 文書は Shift-JIS 範囲の文字のみ(`node scripts/check-docs-chars.mjs` が緑)

### 必須 10 フロー
1. 初回起動: プライバシー同意と、3 択のオンボーディングバナー(まず試す / Obsidian / AI)。閉じたら再読み込み後も出ない
2. 自動記録: 記録条件(滞在時間・スクロール)を満たしたページが記録される。満たさないページは記録されない
3. 手動記録: ポップアップの記録ボタン、アドレスバー(キーワード `y`)、ショートカット(`Alt+Shift+Y`)、右クリックメニュー
4. Obsidian 保存と競合: デイリーノートへの追記。Obsidian 側で同じノートを編集した直後の保存で競合(412)が 1 回だけやり直され、内容が消えない。2 回目も競合なら保存失敗として通知される(2026-11-24-05 の通知)
5. AI 要約: 外部プロバイダー 1 つ以上、ローカル(Ollama か LM Studio)1 つ、可能ならブラウザ内蔵 AI。要約なしでも記録だけは残る
6. ローカル Markdown: 書き出しが `downloads` 経由で保存され、内容が記録と一致する
7. プライバシー確認: プライベートページ(`Cache-Control: private` など)の検出で確認が出る。保存・保存しないの両方。PII マスクが効く。ドメイン別 AI 送信政策(送信を許可・要約なしで記録・マスク必須)
8. バックアップと復元: 暗号化バックアップ(分割形式を含む)を書き出し、別の新しいプロファイルで復元し、件数と検索結果が一致する。誤ったパスフレーズでは復元されない
9. 全データ削除: 確認ダイアログ → 削除 → 履歴・検索・設定の表示が空になる。キャンセルでは何も消えない
10. webhook: 許可リスト内の https loopback 宛先への送信が届く。リスト外と http は保存時に理由付きで拒否される。履歴と状態表示に URL 全文(token)が出ない

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 新規には書かない。各項目の「自動テストとの対応表」で、既に E2E で覆っている部分を示し、手動では E2E で覆えない層だけを見る。対応する既存の spec(確認済み):
  - 初回起動: `testDir/e2e/onboarding-banner.spec.ts`、`testDir/e2e/privacy-consent.spec.ts`
  - 自動記録: `testDir/e2e/content-script-recording.spec.ts`
  - バックアップ: `testDir/e2e/encrypted-backup-split.spec.ts`
  - webhook: `testDir/e2e/webhook-egress.spec.ts`
- スモーク前に、CI と同じ E2E(`--grep @extension`)が緑であることを確認する

### 統合テスト
- 手動で実施する。実 API・実 Obsidian・実ブラウザの拡張読み込みが統合の対象

### 単体テスト
- 対象外。スモークで見つかった不合格は、修正 PBI で再現テストを先に書く

## 実装アプローチ
- **Outside-In**: 利用者が最初に触る画面(同意 → バナー)から、記録 → 保存 → 確認 → 退避 → 削除の順に、実際の利用の流れどおりに並べる
- **Red-Green-Refactor**: 不合格が出たら、修正 PBI で再現テスト(赤)→ 修正(緑)→ 該当項目の再実施
- **使い回し**: 表は正式版以降のリリースでも使う前提で書く。版固有の記述は実施ログにだけ書く

## 見積もり
3 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: 2026-11-24-01 〜 07 の完了。2026-11-24-02(開発中機能の判定)の結果で、webhook や他の開発中機能を正式版で隠す場合、その機能の項目は「隠れていること」の確認に置き換える
- テスタビリティ: Firefox は Playwright で拡張を読み込めない(`dev-docs/TESTING_GUIDE.md` の Testing Limitations)。Firefox の拡張としての動作は手動だけが確認手段
- 非機能要件: 実際の API キーと Obsidian の API キーを使う。実施ログやスクリーンショットにキーを写さない
- 環境: 新しいプロファイルで行う(既存の設定が残っていると初回起動と移行の挙動が見えない)。加えて、可能なら 1 ブラウザで「現行のストア版から正式版への更新」も確認する(権限の再許可の要否、設定の引き継ぎ)
- ロールバック手段: 手動テストのみで、配布物は変えない

## 実装者向け注記

### 現状の確認
確認済み(2026-11-24)。着手前に必ず再実行すること。

```bash
rtk proxy ls /Users/yaar/Playground/yasumaro/dev-docs/manual-tests /Users/yaar/Playground/yasumaro/dev-docs/testing
rtk proxy grep -n -e "manual-tests" -e "TESTING_GUIDE" /Users/yaar/Playground/yasumaro/dev-docs/README.md
rtk proxy grep -n -e "^#" /Users/yaar/Playground/yasumaro/docs/MANUAL_TEST_ARCHIVE.md /Users/yaar/Playground/yasumaro/dev-docs/TESTING_GUIDE.md
rtk proxy grep -n -e "wxt zip" -e "OW_E2E_PROBE" /Users/yaar/Playground/yasumaro/.github/workflows/release.yml
```

確認結果:
- `docs/manual-tests/` は存在しない。手動テスト手順の置き場は `dev-docs/manual-tests/`(`dev-docs/README.md` の 30 行目「`manual-tests/` 手動テスト手順」)。現在は `tag-cooccur-panel-visual.md` と `whitelist-privacy-bypass.md` の 2 本で、日本語・手順 / 期待結果の形
- `dev-docs/testing/` は手動テストの「結果」の置き場として使われている(`prompt-editor-improvements-manual-test-results.md` の 1 本)
- 優先度別の表と「なぜ E2E で不可」列と実施ログを持つ既存の形式は `docs/MANUAL_TEST_ARCHIVE.md`(アーカイブ機能の手動チェックリスト)。ただし `docs/` は利用者向け文書の置き場で、GitHub Pages(`docs/index.html`)からも辿られる
- `dev-docs/TESTING_GUIDE.md` は手動テストの要件・環境・制限の総論で、Firefox の手動スモーク手順(43 行目付近「Firefox manual smoke procedure」)がある
- 決定: チェックリストは開発者向けの手順なので `dev-docs/manual-tests/release-ga-smoke.md` に置き、形式は `docs/MANUAL_TEST_ARCHIVE.md` に合わせる。実施ログは同じファイルの末尾の節に版ごとに追記する(結果だけを別ファイルにする `dev-docs/testing/` 方式は、版ごとにファイルが増えるので採らない)。`dev-docs/TESTING_GUIDE.md` の「Manual Testing Required」からこのファイルへリンクする。Firefox の既存手順は重複させず、TESTING_GUIDE の節を参照する

配布用ビルドの作り方(release.yml と同じ。確認済み):
- Chrome: `OW_E2E_PROBE=0 npx wxt zip -b chrome`(`dist/yasumaro-<版>-chrome.zip`)
- Firefox: `OW_E2E_PROBE=0 npx wxt zip -b firefox`
- Edge: `OW_E2E_PROBE=0 npx wxt zip -b edge`
- 展開先のディレクトリ名(`dist/chrome-mv3` か `dist/chromium-mv3` か、Edge は `dist/edge-mv3` か)は要確認。ビルド後に `rtk proxy ls /Users/yaar/Playground/yasumaro/dist` で確かめ、チェックリストに書く
- 開発用の `npm run build` は対象ブラウザ名(`chromium`)と出力先が配布物(`wxt zip -b chrome`)と違い、ストア用 zip も作らない。E2E probe は既定で除去される(`wxt.config.ts` の `__OW_E2E_PROBE__`、`OW_E2E_PROBE=1` のときだけ残る)が、シェルに `OW_E2E_PROBE=1` が残っていると probe 入りになる。スモークは release.yml と同じコマンドで作ったものに限る
- 読み込み方: Chrome は `chrome://extensions`、Edge は `edge://extensions` で「パッケージ化されていない拡張機能を読み込む」。Firefox は `about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む」で `manifest.json` を選ぶ(一時的なアドオンは再起動で消えるため、再起動をまたぐ項目は TESTING_GUIDE の Firefox 手順に従う)

各フローの関連箇所(確認済み):
- オンボーディング: dashboard の `#onboardingBanner`(`data-onboarding-action` が `try-first` / `obsidian` / `ai` / `dismiss`)
- 記録条件: `docs/RECORDING_CONDITIONS.md`
- Obsidian: `docs/OBSIDIAN_SETUP_GUIDE.md`。競合処理は `src/utils/obsidianConditionalWrite.ts`(強い ETag があるときだけ If-Match を付ける。弱い ETag・ETag なしは無条件書き込み)と `src/background/pipeline/steps/saveToObsidianStep.ts`。利用中の Local REST API が強い ETag を返すかは要確認(返さなければ競合項目は保留)
- AI 要約: `docs/AI_SUMMARY_GUIDE.md`、`docs/BUILT_IN_AI_SETUP_GUIDE.md`、`dev-docs/LM_STUDIO_TESTING.md`
- ローカル Markdown: `docs/MARKDOWN_DOWNLOAD.md`、`src/background/pipeline/steps/saveLocalMarkdownStep.ts`
- プライバシー確認: `dev-docs/manual-tests/whitelist-privacy-bypass.md`(`https://httpbin.org/response-headers?Cache-Control=private` を使う既存手順)、`docs/PII_FEATURE_GUIDE.md`。通知からの撤回の手順は `dev-docs/TESTING_GUIDE.md` の Manual Testing Required の最後の項目
- バックアップと復元: `docs/ENCRYPTED_BACKUP_USER_GUIDE.md`
- 全データ削除: `src/dashboard/panels/staticForm/privacySettingsPanel.ts`(確認ダイアログ、結果は `#deleteAllDataStatus`)
- webhook: `docs/MCP_BRIDGE_RECIPE.md`(mkcert で OS 信頼のローカル CA を作り、`https://127.0.0.1:27124/records` などの許可リスト内の loopback に受け口を立てる手順)。宛先の判定は `src/background/webhookExport/webhookExportDestinations.ts`

### 実装手順
1. 依存 PBI(01 〜 07)の完了と、handoff ファイルを確認する
2. `dev-docs/manual-tests/release-ga-smoke.md` を作る。冒頭に準備(配布用ビルドの作り方、新しいプロファイル、必要な外部環境: Obsidian + Local REST API、AI の API キー、Ollama か LM Studio、mkcert)を書く
3. 必須 10 フローを表にする。各行に Chrome / Edge / Firefox の結果欄、「なぜ E2E で不可」を書く。E2E で覆っている部分は「自動テストとの対応表」に移す
4. `dev-docs/TESTING_GUIDE.md` の Manual Testing Required からリンクする
5. 配布用ビルドを 3 つ作り、ブラウザごとに新しいプロファイルで実施する
6. 実施ログに記録する。不合格は修正 PBI を起票し、修正後に再実施する
7. 可能なら 1 ブラウザで、現行のストア版を入れたプロファイルに正式版を上書きして、権限の再許可の要否と設定の引き継ぎを確認する
8. `node /Users/yaar/Playground/yasumaro/scripts/check-docs-chars.mjs` を回す

### 落とし穴
- 開発用ビルドでスモークしない。配布物と同じものを確かめたことにならない。ビルド前に `OW_E2E_PROBE` が 0 か未設定であることを確認する
- 既存のプロファイルで初回起動を確認しない。同意済み・バナー非表示の状態が残っている
- Firefox の一時的なアドオンは再起動で消える。再起動後の永続化は TESTING_GUIDE の手順(再起動後に記録が残る・同意が再要求されない)に従う
- ブラウザの UI 言語を変えたら、拡張を再読み込みしないと `chrome.i18n` の言語が変わらない
- webhook の送信確認は、OS 信頼の CA で発行した証明書でないと TLS で失敗する(自己署名のままでは届かない)。失敗をそのまま不合格にしない
- 実施ログやスクリーンショットに API キー、Obsidian の API キー、webhook の token を写さない
- `docs/MANUAL_TEST_ARCHIVE.md` は表の見出しに絵文字を使っているが、新しいファイルでは使わない(文字種の規約で許可された絵文字以外は不可。使わないのが安全)

## Definition of Done
- [ ] 全 BDD シナリオを満たしたことが実施ログで確認できる
- [ ] 必須 10 フローが 3 ブラウザで合格、または不合格が修正済みで再実施済み
- [ ] `dev-docs/manual-tests/release-ga-smoke.md` があり、`dev-docs/TESTING_GUIDE.md` から辿れる
- [ ] `npm run validate` が緑(文字種の検査を含む)
- [ ] コードレビュー完了(チェックリストと実施ログの PR)
- [ ] ドキュメント更新済み

## 引き継ぎ
状態: チェックリスト作成済み。Chrome E2E 全量は実施済み(製品の赤なし)。実機は未着手(owner が実施する)。進捗と引き継ぎ情報は [handoff/2026-11-24-08-release-ga-smoke-test.md](handoff/2026-11-24-08-release-ga-smoke-test.md) に記録した。
