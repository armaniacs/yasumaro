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

## 受け入れ基準の判定（2026-10-25・正直な残量つき）
- [ ] 転送条件(タグ/エンゲージメント)の設定ができる ― 論理+UIモジュール+seamテストは完了。残: options.htmlへのmount配線(staticPanels 1行+HTML断片。シェル所有のため最小defer片)
- [ ] 転送履歴と再送ができる ― 論理+UI+冪等再送は完了。残: SW発火配線(保存パイプラインからの呼出し。共有ハンドラ所有のため最小defer片)
- [ ] 未宣言originの遮断がe2e pinで固定される ― spec 2pin作成済み・lint済み。残: headedでの緑確認(本セッションはheadless+headed禁止のため未実行)
- [ ] 送信前にPIIマスキングとプライベート除外が適用される ― senderに実装し単体pin済み(マスク失敗のfail-closed含む)。残: 実 sanitizer・実privacy verdictの配線(上記SW配線と同一片)
- DoD: BDD自動テストは単体層で全緑・e2eは保留、レビューは自己実施のみ(独立裏取りなし)、ドキュメントは草案仮置きのため未完了
- E2E: 条件一致→転送→表示、未宣言origin遮断の2pin
- 統合: 再試行・重複抑止・順序のテスト
- 単体: 条件判定・ペイロード整形・マスク適用のテーブルテスト

## 見積もり
1.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(PERMISSIONSの送信先章・SECURITYのScope)
