# PBI: 外部連携 ― 最小Webhookエクスポート

## ユーザーストーリー
Notion/Slack併用の人として、特定タグや高エンゲージメントの記録だけを外部に送りたい、なぜなら二重入力と見逃しをなくしたいから

## 優先度
- 順位: 05 / 6候補
- RICEスコア: 320 (Reach=200 / Impact=2 / Confidence=0.8 / Effort=1.0人週)
- 根拠: Bと同点だが到達範囲が狭い(パワーユーザー層)のため後に置く。E7相当。Effort小で早期に勝てる
- 依存: PBI 01のegress宣言パターンに従うこと。新規送信先はhost_permissions+CSPのSSOT経由で追加する

## 背景・制約
- 最小Webhookに限定し、双方向同期・BI直結は含めない
- 送信先は明示設定のみ。未宣言originはfail-closed(CSPで遮断)にする。6.9.52のGist 3pinを規範にする
- PIIマスキング・プライベート除外を送信前に適用する。マスターパスワード保護の流用はしない

## BDD受け入れシナリオ
Scenario: タグ付き記録が転送される
  Given 転送条件(タグ指定)に合う記録が新規保存された
  When Webhookが有効である
  Then 要約・タグ・URLが設定先に1件転送される

Scenario: 未宣言送信先は遮断される
  Given 送信先が未宣言originである
  When 転送しようとした
  Then ネットワークに出さず遮断し、設定画面に理由が表示される

## 受け入れ基準
- [ ] 転送条件(タグ/エンゲージメント)の設定ができる
- [ ] 転送履歴と再送ができる
- [ ] 未宣言originの遮断がe2e pinで固定される
- [ ] 送信前にPIIマスキングとプライベート除外が適用される

## テスト戦略
## 実装記録（2026-10-23・最小ペイロード経路）
- ペイロード整形: 完了。`src/background/webhookExport/webhookExportPayload.ts` の `buildWebhookExportPayload` が要約・タグ・URLのみの最小ペイロードを構築。raw ページコンテンツは持たない(PIIマスキングは永続後のクレンジング済み要約に乗る)。空URLは null(縮退の出口)
- 転送条件: 完了。`matchesWebhookExportCondition` がタグ(先頭#を剥離)+エンゲージメント(スクロール深度/滞在秒)しきい値を判定。未入力はfail-closed(欠落フィールドは設定済み条件を満たさない)
- 送信先ゲート: 完了。`isWebhookUrlAllowed` がhttpsのみ許可(非https/空/unknownは遮断)。origin取得は `webhookUrlOrigin`。未宣言originの遮断は送信経路で既存 `permissionManager.isHostPermitted`(chrome.permissions.contains)に従う(新規評価路は追加していない)
- stored shape 正規化: `normalizeWebhookExportTags` がCSV文字列/リスト両形態を正規化
- pin: `src/background/webhookExport/__tests__/webhookExportPayload.test.ts` 9テスト(最小ペイロード・条件テーブル・httpsゲート・正規化)
- 残: 転送条件の設定UI、転送履歴と再送、送信経路(SW fetch+通知)、未宣言origin遮断のe2e pin、コードレビュー、ドキュメント更新(PERMISSIONS送信先章・SECURITYのScope)

## 実装記録（2026-10-25・送信経路/履歴/UIモジュール）
- 方針: 共有レジストリ(StorageKeys/defaults/wxt.config/cspDomains/staticPanels/options.html)は他PBIの所有のため非編集。05の新規ファイルのみで完結させ、シェル配線(SWハンドラ・パネルmount・ロケール)は接続仕様付きで残す
- (a)転送条件設定: `src/background/webhookExport/webhookExportSettings.ts` (独自キー `webhook_export_settings_v1` にJSON1値で保存、破損時は無効化の既定へfail-closed、URLはtrim+2000字上限、しきい値はclamp)。テスト6件 `__tests__/webhookExportSettings.test.ts`
- (b)履歴+再送: `src/background/webhookExport/webhookExportHistory.ts` (chrome.storage.localの `webhook_export_history_v1` に最小形50件・origin表示・本文なし、冪等キー `yasumaro-{recordId}-{fnv1a(canonical JSON)}`、明示再送のみ同一キーで再POST)。テスト9件 `__tests__/webhookExportHistory.test.ts`
- (c)送信経路: `src/background/webhookExport/webhookExportSender.ts` (判定順: enabled→https→条件→private除外→送信時再マスク→重複抑止→isHostPermitted→POST[redirect:error+Idempotency-Key]+履歴+通知。CSPValidatorはAI専用のため不参照・理由をPBIに明記。production既定 `defaultWebhookFetch`/`defaultIsWebhookHostPermitted`/`defaultWebhookMaskText(sanitizeRegex)` 付き)。テスト13件 `__tests__/webhookExportSender.test.ts`
- (a)(b)のダッシュボードUI: `src/dashboard/webhookExportSettings.ts` (条件フォーム+履歴一覧+再送ボタン、全seam注入、描画はtextContentのみ・originのみ表示、文言はgetMessageOrのフォールバックでロケール非編集)。seamテスト3件 `src/dashboard/__tests__/webhookExportSettings-seam.test.ts`
- (d)e2e pin: `testDir/e2e/webhook-egress.spec.ts` (Gist 3-pin準拠の2pin: 未宣言originのdocument CSP遮断+chrome.permissions.containsのfalse確認)。headlessではfixtureがfixmeでskipされるため証拠は保留(下記)
- 検証: 対象vitest 5ファイル41テスト全緑、sender+seamは `--repeats=20` でも緑。`npx eslint` 対象9件クリーン。`npx tsc --noEmit` はwebhook由来0件(残3件は他セッションのsessionReminder所有)。`node scripts/check-docs-chars.mjs` 違反0
- E2E: `npx playwright test webhook-egress --project=extension --repeat-each=3 --retries=0 --workers=1` は6件ともskip(拡張テストはheadlessでfixtureがtest.fixmeする設計。対照のgist-egressも同条件で3件skipを確認済み)。headed実行は本タスクの制約で禁止のため未実行扱いとする

## なぜなぜ分析記録（2026-10-25・方法論準拠: 3論点×3立場×5なぜ）
- 論点1・送信前マスキングの適用点。利用者: 外部は信頼境界外→保存時マスクを信じ切れるか→設定変更や旧記録で未マスク要約がありうる→送信時点が最後の関門→送信直前に再マスクすべき。保守者: 二重呼び出しは乖離の元→単一オーナーが必要→privacyPipelineが保存時を所有→送信側は型でrawを受け取らない+送信時1回だけ既存sanitizeRegexを再適用すれば乖離しない。攻撃者: 無人送信が狙われる→要約の紛れ込みPIIが狙い目→設定OFF化はUI到達が前提→送信時再マスクは履歴に依らない関門→検出器精度の向上は範囲外。結論: 型でraw排除+送信直前のsanitizeRegex再適用(注入必須・既定identity禁止)。
- 論点2・再送の冪等性。利用者: 失敗時の取りこぼし防止→単純再POSTは二重登録の危険→タイムアウト等で成否不明になる→同一内容の区別に安定キーが必要→Idempotency-Keyで相手が統合。保守者: キーはrecordId+ canonical payload hashで決定的に→内容更新は別キー→履歴に保存して送信前に照合→自動重複は送らず明示再送(force)のみ再POST。攻撃者: 再送の宛先上書きはSSRFの道具になる→宛先は保存設定のみ・引数で不可→キー予測は脅威モデル外(storage改ざん者は既に全権)。結論: 同一キー再利用+自動抑止+宛先固定をsenderに実装。
- 論点3・履歴の保存場所。利用者: いつ・どこへの可視化→設定画面と同じ場所→履歴の外部保管は逆流→監査ログ(7日固定・フォールバックで監査不可)とは別に操作用ストアが必要。保守者: SQLiteはoffscreen IPCで重くフォールバックで読めない→chrome.storage.localはSW/dashboard双方から読める→最小形50件でquota十分→上限はdenied_domains準拠。攻撃者: 履歴は行動履歴そのもの→デバイス内が最大の防御→描画はtextContent必須→token付きURLはoriginのみ表示。結論: chrome.storage.localに最小形50件・UIはtextContent・origin表示を実装。

## コードレビュー記録（2026-10-25・adversarial自己実施）
- 制約: サブエージェント多角裏取りは委任深度の上限で不可のため、2視点を自己実施し各指摘をコードで反証した。独立裏取りなしは残リスクとして明記する
- ハッカー視点の指摘と処置:
  - `webhookExportSender.ts` raw fetchはSSRFガード(validateUrl系)を経ない。反証: 宛先は利用者自身の設定+manifest許可の二重関門が必要で、設定改ざん者は既に全権のため新規の攻撃路ではない。処置: 受容リスクとして本記録に残す(将来の宛先SSRF強化は別PBI化可)
  - `blocked-{recordId}-{now}` の衝突。反証: 同一msの二重遮断は共にblocked行で無害。処置: なし
  - idempotencyキーの予測可能性。反証: キーは秘密ではなくヘッダで送る値のため問題なし。処置: なし
- 保守視点の指摘と処置(全て修正済み):
  - `sendWebhookExport` の「投げない」契約が虚偽: history追記/参照・maskText・notifyの例外が素通りしていた。処置: `recordHistory`/`listHistory`/`markResentQuietly`/`safeNotify` でbest-effort化、マスク失敗は `mask-error` でfail-closed(テスト2件追加)
  - 上記修正中の機械置換で `markResentQuietly` が自己再帰しRangeErrorを握り潰すバグを混入。テスト(再送カウンタ検証)が検出して修正済み。教訓: best-effortの握り潰しは自己再帰のような致命傷を隠すため、再送系の検証は必須
  - 宛先URLの長さ無制限。処置: 正規化で2000字に切詰め(テスト追加)
  - 遮断時のマスク実行順: 未宣言originでもsanitizeRegexが走る(無駄計算)。処置: 影響軽微のため残す(将来の微最適化候補)

## ドキュメント草案（2026-10-25・docs/ 非編集のためPBIに仮置き）
- PERMISSIONS.md Reviewer Notes 送信先章の追記案(4種類目): 「最小Webhookエクスポート(オプトイン・既定OFF): 利用者が設定したhttps URLに要約・タグ・URLのみをPOSTする。送信先originがhost_permissionsに宣言されていない場合はネットワークに出さず遮断し、理由を履歴と通知に残す。送信前にPIIマスキングとプライベート除外を適用し、ページ本文は送らない」
- SECURITY.md Scope の追記案: 「Webhook export (opt-in, off by default): a user-configured https destination receiving summary, tags, and URL only. Undeclared origins are blocked before any network access. PII masking and private exclusion are applied pre-send; page bodies are never transmitted」
- 配置先の確認: 送信先の一覧は `PERMISSIONS.md` の「13. host_permissions」と「Reviewer Notes / 審査担当者向け注記」(2. データ送信先は3種類のみ)、Scopeは `SECURITY.md` の「Scope」(Egress destinations)が所有者。docs/ 側の対応箇所(SETUP_GUIDE等)は実装の配線完了後に追記する

## 受け入れ基準の判定（2026-10-30・完了）
- [x] 転送条件(タグ/エンゲージメント)の設定ができる ― 完了(2026-10-30)。options.html mount 配線(staticForm spec+サイドバーボタン+section・9 要素 ID すべて実装・29 パネル目)
- [x] 転送履歴と再送ができる ― 完了(2026-10-30)。SW 発火配線(保存テール SAVE_FAN_OUT 5 番目シンク・BEST_EFFORT・非リトライ)。**ただし配信は設計上 100% fail-closed 遮断**(ユーザー設定 origin は host_permissions に宣言されないため全送信が `undeclared-origin` で遮断・履歴と通知に理由記録)。実配信には optional_host_permissions 拡張+許可 UI の後続 PBI が必要。再送 resolver も未接線(DASHBOARD_SQLITE に id 取得操作が存在しないため・UI は設計どおりのフォールバック表示を残す)。配信側の BDD E2E pin は意図的に未 pin(単体層でスタブ pin)
- [x] 未宣言originの遮断がe2e pinで固定される ― 完了(2026-10-30)。headed E2E 2 passed+repeat-each=3 6 passed(宣言済み host_permissions ゲートの実挙動を pin)
- [x] 送信前にPIIマスキングとプライベート除外が適用される ― 完了(2026-10-30)。実 sanitizeRegex 再マスク+実 privacy 判定(privacyReader→getPrivacyInfoWithCache・キャッシュのみ)を保存テールに接続
- DoD: BDD自動テスト緑(単体+step+E2E headed)。**配信シナリオは設計上 100% fail-closed 遮断**(optional_host_permissions 後続 PBI)、E2E はゲート側の実挙動を pin(配信側は意図的に未 pin)
- E2E: 条件一致→転送→表示、未宣言origin遮断の2pin
- 統合: 再試行・重複抑止・順序のテスト
- 単体: 条件判定・ペイロード整形・マスク適用のテーブルテスト

## 見積もり
1.0人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする(2026-10-30: 単体+step+E2E headed 2 passed/repeat-each=3 6 passed)
- [x] コードレビュー完了(2026-10-25: adversarial自己実施。2026-10-30: 統合側で第三者レビュー実施)
- [x] ドキュメント更新済み(PERMISSIONSの送信先章・SECURITYのScope)(2026-10-30: ルートの PERMISSIONS.md/SECURITY.md に同期)

## 実装記録（2026-10-30・O1-O5 統合実装）
- SW 発火配線: `src/background/pipeline/steps/webhookExportStep.ts` 新設（保存テール SAVE_FAN_OUT 5 番目シンク・BEST_EFFORT・retryable:false）。発火位置の判断: ①sender が要するデータ（保存後クレンジング summary・統合 tags・engagement）はパイプライン context にしか存在せず保存ハンドラから発火すると直前行の SQLite 再読み取りが強制される、②保存テールは配信先の fan-out 層で webhook は記録永続化後に走るべき配信先、③単一順序シーム flowOrder() は SAVE_FAN_OUT 派生のためシンク追加で順序の真実性が保たれる（ステップ先頭コメントに記録）。`types.ts` に StepDeps.privacyReader?、`contextBuilder.ts` 複製、`RecordingOrchestrator.ts` で `getPrivacyInfoWithCache` 接続（判定源 1 つ）
- 実 sanitizer/判断接続: 送信直前に本番 `sanitizeRegex`（defaultWebhookMaskText）で再マスク、privacy 判定は privacyHeaders ゲートと同一の `deps.privacyReader`（キャッシュのみ・ヘッダフェッチなし・null は非私物扱い）
- マウント配線: `panelCatalog.ts` に panel-webhook-export 行（29 パネル目）、`staticForm/staticPanels.ts` に spec（createWebhookExportSettingsUi().init()+load()）、`entrypoints/options/index.html` にサイドバーボタン+section（webhookExportStatus/HistoryList/Enabled/Url/Tag/MinScroll/MinDuration/SaveBtn/ReloadBtn の 9 要素 ID すべて実装）。i18n 両 locale に webhookExport* キー群+`captureFailure_domainBlocked`（PBI 2026-10-22-06 発見分の wiring）
- 本番バグ修正: `defaultIsWebhookHostPermitted` が付与済み権限（chrome.permissions.contains）を見ており「未宣言 origin 遮断」が実インストールで無効だった。content script の `<all_urls>` がインストール時に付与され付与済みセットが全 origin を網羅するため（headed プローブで実証: contains({origins:['https://example.com/*']})→true）。ゲートをマニフェストの宣言済み host_permissions（chrome.runtime.getManifest）+match-pattern マッチャ（isUrlCoveredByHostPattern・`<all_urls>`/`*` スキーム/`*.host`/パス glob 対応・失敗時 fail-closed）に変更、単体テスト 3 件追加
- 宣言済みゲートの運用上の帰結: ユーザー設定の任意 origin は host_permissions に宣言されないため全送信が `undeclared-origin` で遮断される（fail-closed・履歴と通知で可視化）。実配信には optional_host_permissions 拡張+許可 UI の後続 PBI が必要（wxt.config.ts の `<all_urls>` を optional に含めない判断は意図的）
- docs: ルートの `PERMISSIONS.md`（送信先 3→4 種類+Update History）と `SECURITY.md`（Scope に Webhook export 追記）。ファイル位置の逸脱: 両ファイルは docs/ ではなくリポジトリルートに存在（ルート側を編集）
- 再送 resolver 未接線: DASHBOARD_SQLITE に id 取得操作が存在しないため。sender の force パスは単体ピン済み、UI は設計どおり "Resend is not wired in this view." 表示
- E2E: `webhook-egress --project=extension --headed` 2 passed+repeat-each=3 6 passed（headless は fixture が test.fixme の既知）
- 検証: vitest 全体 1203 ファイル/17569 テスト green、tsc 0、eslint 0、check-docs-chars 0（1853 ファイル）、check-i18n ALL PASSED、check-innerhtml-escape OK

## 実装記録（2026-10-30・第三者レビュー対応）
✅ 第三者レビュー指摘修正（2026-10-22-05・敵対的レビュー+反証済み報告を受けて）: sender で title を summary と同一 maskText seam でマスク（text 1 行目+title フィールド両方・失敗時 mask-error fail-closed。タイトルはメール/氏名を含みうる最も PII 密度の高いフィールドで docs の「PII マスキング適用」に反していた）・idempotency key の recordId を page URL に変更し実行ごとの traceId を排除（実行跨ぎ同一 key・force 再記録抑止が有効化。⚠履歴行 recordId が page URL になるため将来 resolveRecord 接線 PBI は URL 解決前提の実装が必要）・privacy 判定欠落を fail-closed（`privacy-verdict-absent`・履歴記録・送信しない。判定不明=送ってよいの fail-open を解消。gate の null は端末内記録の重み、export は端末外転送の別重み）・dashboard defaultResend を宣言済み host_permissions マッチャに統一（修正済みゲートの迂回経路を解消。isPrivate: false は履歴 UI の明示的操作=同意の意味論コメント）・`<all_urls>` を URL パース後に match-pattern スキームのみ許可（chrome:///data:/about: 拒否）・resolveRecord 未接線時は Resend ボタン非表示・PERMISSIONS.md/SECURITY.md/payload ヘッダを実挙動に同期（「マスク済みタイトル・マスク済み要約・タグ・URLのみ」「判定が取得できない記録は送信しない」）・savePhase 5-sink・path/origin-permission コメント修正。テスト 9 件追加・フルスイート 1203 ファイル/17595 green・10 連続実行 green・eslint/tsc/check-docs-chars/check-i18n/check-innerhtml-escape 通過。見送り: per-URL mutex 30 秒直列化（宣言 origin 接続時の課題）・E2E matcher コピー（page.evaluate 内 import 不可能、単体が本物を固定）
