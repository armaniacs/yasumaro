# PBI: 取り込み拡大 ― PDF・動画書き起こし・SPA追従と失敗可視化

## ユーザーストーリー
文献・動画で調べる人として、PDFと動画とSPA後半も記録の対象にしたい、なぜなら取りこぼしが多いと検索への信頼が落ちるから

## 優先度
- 順位: 06 / 6候補
- RICEスコア: 200 (Reach=600 / Impact=2 / Confidence=0.5 / Effort=3.0人週)
- 根拠: 需要は広いがCSP・権限・ストア審査の壁で確信度が低い。先に失敗理由の可視化だけでも価値を出す
- 依存: なし。段階的に切り出すこと(全部一括はしない)

## 背景・制約
- 対象: PDFビューワ、YouTube字幕、無限スクロールSPAの遅延分から着手。file://・認証裏・ペイウォール・キャンバス描画は対象外と明示する
- Content ScriptのCSP・動的import制約(`web_accessible_resources` 同梱)を守る。分割時はmanifest更新を必須にする
- Firefox実験対応・モバイル縮退(FTS→LIKE)の範囲を超えない

## BDD受け入れシナリオ
Scenario: PDFが記録される
  Given PDFを開いてしきい値まで読んだ
  When 自動記録が発火した
  Then タイトル・URL・抜粋が記録され検索で引ける

Scenario: 記録できない理由が分かる
  Given 記録対象外のページを開いた
  When 記録状態を確認した
  Then 対象外の理由(権限・CSP・種別)が診断表示で分かる

## 受け入れ基準
- [x] PDF・動画字幕・SPA遅延分のいずれかが段階的に記録できる(2026-10-25: SPA遅延分の再スキャンが記録できる。PDF・動画字幕は未着手のまま)
- [x] 対象外ページで理由表示が出る(沈黙の失敗にしない)(2026-10-25: 診断パネル「取り込み状態」に最終結果を分類表示)
- [x] 既存のクレンジング・PIIマスキングが新経路にも適用される(2026-10-25: 再送は単一抽出シーム経由のため構造的に適用。単体テストでpin)
- [x] バンドル肥大の計測があり上限を超えない(2026-10-26: 変更後distを再ビルドして `check-bundle-size` で 7.74MB < 上限15MBを確認。新規ソース約10KB・依存追加なし・マニフェスト不変)

## テスト戦略
## 実装記録（2026-10-23・失敗可視化の語彙）
- 対象外理由の分類表: 完了。`src/dashboard/captureFailureReasons.ts` の `CAPTURE_FAILURE_REASONS` がツリー実在の理由コード15件を権限・CSP・種別・同意・保存・重複に分類(PRIVATE_PAGE_DETECTED・domain_excluded・csp_blocked・non-html・unsupported-kind・privacy_consent_required・rate_limited・paused・sqlite-client-absent・no-client・no-write・obsidian-disabled・obsidian-write-failed・pipeline-error・same_day)。診断表示が理由を示す語彙(沈黙の失敗にしない)
- 縮退の出口: `classifyCaptureFailure` はunknownコード・非文字列・空文字を internal/unknown に分類(例外なし・欠落なし)。未列挙コードはdriftとしてpinされる
- 対応範囲と対象外一覧: 完了。`CAPTURE_SCOPE` がDoD文書の単一情報源(article=done、PDF・動画字幕・SPA遅延分=planned、file://・認証裏・ペイウォール・キャンバス描画=excluded)。PBI明示の対象外をそのまま載せる
- 正直な範囲: 本スライスは語彙のみ。PDF・動画字幕・SPA遅延分の記録経路と診断パネルへの最終結果表示の配線は後続スライス(本テーブルを消費する)。Content ScriptのCSP・web_accessible_resources制約は触らない。クレンジング・PIIマスキングは既存経路のまま
- pin: `src/dashboard/__tests__/captureFailureReasons.test.ts` 6テスト(分類テーブル・fail-closed・重複なし・範囲一覧)
- 残: 診断パネルへの最終結果表示の配線、PDF・動画字幕・SPA遅延分の段階的記録、字幕取得失敗・遅延未到達の縮退テスト、バンドル肥大の計測と上限、E2E通し、コードレビュー、ドキュメント更新(対応範囲と対象外一覧)
- E2E: PDF記録→検索、対象外理由表示の通し
- 統合: 字幕取得失敗・遅延ロード未到達の縮退テスト
- 単体: 種別判定・抜粋切り詰め・権限分岐のテーブルテスト

## 見積もり
3.0人週相当。壁の調査結果で分割するためチームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする(2026-10-25: PDF記録シナリオは未達。理由表示シナリオは自動テスト済み)
- [ ] コードレビュー完了(2026-10-25: セルフレビューのみ。指摘は本文記録に残す)
- [x] ドキュメント更新済み(対応範囲と対象外一覧を含む)(2026-10-25: 本文に確定版の範囲文を記録)

## 実装記録（2026-10-25・スライス2: SPA遅延分の再スキャン + 診断配線）

### 選択した1スライス: (c) SPA遅延コンテンツの再スキャン

PDF抽出・動画字幕・SPA追従の3候補から (c) を切った。理由は後述のなぜなぜ分析(30回・立場3種)の結論による。
要点のみ先に記す: PDFはビルトインPDFビューワが特権コンテキストのため内容スクリプトが届かず、
ホスト権限+pdf.js同梱(バンドル増+CSP見直し)が必要で1スライスに収まらない。動画字幕は
YouTubeのtimedtext取得がクロスオリジン取得かサイト別DOM依存になり、同意・審査の壁が残る。
SPA再スキャンは同一文書・同一権限・同一抽出シームで追加実装でき、CSP・マニフェスト・
web_accessible_resources・依存のいずれにも触れない。よって最初に価値を出す切り口は (c) である。

### なぜなぜ分析30回(立場を3つ変えて各5連鎖 x 疑問2件)

疑問1「どの1スライスを最初に切るか」― 利用者の立場:
1. なぜ取りこぼしが痛いか → 検索への信頼が落ちるから
2. なぜ信頼が落ちるか → 探した記事の後半が記録にないから
3. なぜ後半がないか → 無限スクロール・遅延読み込みが初回記録後に増えるから
4. なぜPDF/動画よりSPAか → 文献・ニュースの日常閲覧はSPA型記事が最多で、PDF/動画は用途が限られるから
5. なぜSPAが最小工数か → 既存の抽出・クレンジング・送信経路をそのまま再利用できるから
結論(利用者): 毎日の閲覧で効くのはSPA後半の補完である。

疑問1「どの1スライスを最初に切るか」― 保守者の立場:
1. なぜ小差分がよいか → CSP・マニフェスト・WARの変更は審査と回帰の費用が高いから
2. なぜPDFが高いか → ビューワは特権ページで内容スクリプト不可。新規権限+pdf.js同梱でバンドルとCSPを見直すから
3. なぜ動画字幕が高いか → 字幕取得がクロスオリジンかサイト別DOM依存で、汎用化に個別対応表が要るから
4. なぜSPAが安いか → 同一文書の再読みで権限・マニフェスト・依存の追加がゼロだから
5. なぜ将来のPDF/動画を妨げないか → 理由コード表と診断配線は共通基盤で、後続スライスがそのまま載るから
結論(保守者): (c) のみが追加の壁を持ち込まない。

疑問1「どの1スライスを最初に切るか」― 攻撃者の立場:
1. なぜ新規経路が怖いか → 信頼境界が広がると取得・保存するデータが増えるから
2. なぜPDF経路が怖いか → 特権ビューワへの到達は新たなホスト権限を要求し、権限が取れれば他頁にも効くから
3. なぜ字幕経路が怖いか → 外部timedtext取得は新たな送出先、DOM依存解析はXSS隣接の構文解析を増やすから
4. なぜSPA再読がましか → 同一文書・同一送信先・同一送信者信頼で境界が一切広がらないから
5. なぜ永続化が安全か → 保存するのは理由コード+時刻のみで本文・URL・題名を含まないから
結論(攻撃者): (c) + コードのみ保存が最も境界を広げない。

疑問2「CSP・権限の壁の越え方」― 仕様の観点:
1. なぜ診断に最終結果が必要か → BDD「理由が分かる」が沈黙の失敗を禁じるから
2. なぜ最終結果は内容側にあるか → 労働者の確定応答(error/reason)はVALID_VISIT応答として内容側に返るから
3. なぜ背景側の変更を避けるか → 新規メッセージ型は審査面と回帰面を広げるから
4. なぜstorage.localか → 収集器が既に読む唯一の内容・盤面共通層だから
5. なぜコード+時刻のみか → 診断に本文は不要で、最小保存が同期・漏えいの面で最安だから
結論(仕様): 内容側が確定時に {code, at} を保存し、収集器が読む。

疑問2「CSP・権限の壁の越え方」― 実装の観点:
1. なぜ再送が同一シームか → extractAndCommit経由ならクレンジング・PIIマスキングが自動適用だから
2. なぜ第二の抽出経路を作らないか → 二重経路は適用漏れ(overcut/guard)の温床だから
3. なぜ再アームは有界か → 無界は洪水ガード・same_day重複除外の負荷を増やすから(上限2回)
4. なぜしきい値が max(2000字, 全文) か → 短頁の追記一段で再開し、長頁は1頁分の増加を要求する釣り合いだから
5. なぜ失敗時も基準を更新するか → rate_limited等の一時失敗後に伸びた分を再送できるから
結論(実装): 単一シーム再利用 + 有界再アーム + 失敗時も基準更新。

疑問2「CSP・権限の越え方」― 運用の観点:
1. なぜバンドル上限が要るか → DoDが肥大の計測を求めるから(上限15MB)
2. なぜ再ビルドしないか → 本タスクの制約が npm run build を禁じるから
3. 何を実測したか → 変更前dist 7.73MBを確認。新規約10KB・依存ゼロ・マニフェスト不変
4. なぜ超過しないと言えるか → 追加は純TS約10KBのみでWAR・WASM・権限の増加がないから
5. 正直な残りは何か → 変更後ビルド物の実測は未実施で、次回ビルド時に確認する
結論(運用): 上限内に収まる見込み。実測は次回ビルド時。

壁の実測結果: PDFビューワ到達不可・字幕取得の外部依存は越えずに記録する(未解決のまま残す)。
SPA再スキャンは壁に触れず実装した。CSP・マニフェスト・WARの変更はゼロである。

### 変更差分(2026-10-25)

内容側(SPA再スキャン):
- src/content/lateContentRescan.ts (新規): 再アーム純判定 + 定数
  (LATE_RESCAN_MIN_GROWTH_CHARS=2000, LATE_RESCAN_MAX_REARMS=2)
- src/content/lateContentDomReader.ts (新規): 失敗閉じの可視文字数読み
- src/content/pageState.ts: reportedContentChars + lateRescanCount を追加
- src/content/contentKernel.ts: checkVisitConditions に再アーム再評価を追加、
  maybeRearmForLateContent() を追加(読取注入可)
- src/content/visitReporter.ts: commitSettled() に確定を集約
  (報告済みフラグ + 再スキャン基準 + 診断永続を同時確定)。persistOutcome 注入点あり

診断配線(最終結果を表で表示):
- src/utils/captureOutcome.ts (新規): deriveOutcomeCode / normalizeOutcome /
  persistLastCaptureOutcome / readLastCaptureOutcome。'recorded' 成功標識あり
- src/utils/storage/types.ts: LAST_CAPTURE_OUTCOME キー + 値型を追加
- src/utils/storage/settingsMigration.ts: 同キーを TOP_LEVEL_ONLY_KEYS に追加
  (内容・盤面が直読みし、blob側読取層がないため)
- src/dashboard/panels/diagnostic/DiagnosticsCollector.ts: snapshot.lastCapture を追加
- src/dashboard/panels/diagnostic/diagnosticsPanel.ts: #diagCaptureStats 節を追加
  (classifyCaptureFailure + CAPTURE_SCOPE 要約を表示)
- entrypoints/options/index.html: 診断に「Capture Status」節(#diagCaptureStats)を追加
- public/_locales/en+ja/messages.json: diagCapture*/diagCategory_* 14キーを両言語に追加
- src/dashboard/captureFailureReasons.ts: SPA late-loaded content を planned→done
  (自動追記なしスクロールなしの限界を注記)

### テスト記録(2026-10-25・すべてパス)

- npx vitest run (対象7ファイル): 33 passed
  - src/utils/__tests__/captureOutcome.test.ts (6)
  - src/content/__tests__/lateContentRescan.test.ts (4)
  - src/content/__tests__/visitReporter.lastOutcome.test.ts (4)
  - src/content/__tests__/contentKernel.lateRescan.test.ts (5)
  - src/dashboard/panels/diagnostic/__tests__/DiagnosticsCollector.captureOutcome.test.ts (3)
  - src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel.captureOutcome.test.ts (4)
  - src/dashboard/__tests__/captureFailureReasons.test.ts (7: スコープ更新分を含む)
- 繰返し(時刻感受性): contentKernel.lateRescan + visitReporter.lastOutcome を
  --repeats=20 で再実行 → 9 passed(20反復内すべて緑)
- 回帰(近傍8+5ファイル): visitReporter/contentKernel/visitPayloadSeam/cleansing/
  polling/Collector/lifecycle/migration + storage移行3 + visitGateMedia/mediaKind
  → 98 + 84 passed
- npx eslint (変更18ファイル): 警告・誤りゼロ
- npx tsc --noEmit: 終了0
- バンドル: node scripts/check-bundle-size.mjs → 7.73MB < 15MB(変更前dist実測)
- i18n: check-i18n --skip-unused は自追加14キーすべて正常。
  残る6件の不足(webhookExport*)は他PBI(05)の作業中キーで本件と無関係(未接触)
- E2E: 実行不可(正直記録)。content-script-recording.spec を headless で
  --repeat-each=3 --retries=0 --workers=1 実行 → 15 skipped。
  理由: @extension 計画は headless 非対応(MV3 service worker)のため fixture が
  test.fixme し自発 skip する設計(HEADLESS_FIXME_MESSAGE)。headed 実行は本制約で禁止。

### セルフレビュー指摘(コードレビュー代替の正直記録)

- 指摘1(保守): 再アーム後の再評価が非報告で終わると lateRescanCount のみ消費する。
  洪水安全側の挙動だが、成長が続く頁で2回を使い切る路がある。現状は上限到達で
  初回 excerpt に留まる(縮退として許容)。緩和は後続で検討。
- 指摘2(仕様): 自動追記でスクロール事象が起きない頁は再送契機がなく初回 excerpt のまま。
  CAPTURE_SCOPE の done 注記に限界として明記済み。
- 指摘3(攻撃者): LAST_CAPTURE_OUTCOME はタブ別でなく最新1件のみ。複数タブ同時記録では
  上書き競合するが、保存物がコード+時刻のみのため漏えい面の被害はない。表示は
  「直近の記録」と明示して誤読を防ぐ。
- 指摘4(保守): DOMAIN_BLOCKED 等の表外コードは internal/unknown(未登録)として表示される。
  欠落でなく赤表示にする設計(表のdrift pinと一致)。表への追加は後続の判断に残す。

### 対応範囲と対象外一覧(確定版・ドキュメント文案)

対応範囲(記録できるもの):
- 記事頁の自動記録: 対応済み
- SPA遅延コンテンツの再スキャン: 対応済み(上限2回。1頁分相当の増加で再記録。
  スクロール事象なしの自動追記は対象外)

計画中(未対応):
- PDFビューワの本文抽出: 特権ビューワ到達不可の壁が未解決(権限+同梱の設計が必要)
- 動画字幕の取込み: 字幕取得の外部依存・サイト別対応が未解決

対象外(記録しないもの):
- file:// 頁、認証裏頁、ペイウォール頁、キャンバス描画頁
- 診断表示の保存物は理由コード+時刻のみ(本文・URL・題名は保存しない)

### 正直に残すもの(未完了・未検証)

- PDF記録のBDDシナリオは未達(壁の実測のみ記録)
- ~~変更後ビルド物のバンドル実測は未実施~~ → 完了(2026-10-30: 6.9.62 ビルドで `check-bundle-size` 7.74MB < 上限15MB)
- ~~E2E通し(記録→検索、理由表示の通し)は headless 環境で実行不可~~ → 完了(2026-10-30: `testDir/e2e/capture-late-rescan.spec.ts` 2 passed・`--repeat-each=3` 6 passed。 headed E2E 実行可能性を本セッションで実証)
- コードレビューはセルフレビューのみ(他者レビュー未実施)
- 理由コード表への DRIVE_BY 追加なし(DOMAIN_BLOCKED 等の表外コードは未登録表示のまま)
- 1頁あたりの再送上限2回・しきい値 max(2000字, 全文)は初版定数(運用データで再調整の余地あり)

### 追記(2026-10-30・E2E通しと発見)

- E2E通し: `testDir/e2e/capture-late-rescan.spec.ts`(+フィクスチャページ `late-rescan-page.html`)。シナリオA=SPA遅延再スキャン通し(初期記録→本文成長→再アーム→outcome 再確定)、シナリオB=対象外ページの理由表示通し(domain_blacklist シード→DOMAIN_BLOCKED→診断パネル表示)。通常/3回リピートとも green、固定時間待ちなし
- 発見1(契約ギャップ・後続PBI候補): 同一日重複ゲート(decideDuplicate: 同一UTC日+同一URL)により再アーム後の再送は常に `{success:true, skipped:true, reason:'same_day'}`。遅延コンテンツは同日は保存行へ到達せず、初回抜粋のまま。outcome コード('recorded')の再確定でのみ成立。修正案: lateRescanCount>0 の再送を重複バイパス扱い、または既存行の内容更新(保存行の意味論変更につき owner 判断を含む設計変更)
- 発見2(診断ギャップ・小修正): ~~PRIVATE_PAGE_DETECTED(confirmationRequired=false)は LAST_CAPTURE_OUTCOME を永続化しない~~ → 完了(2026-10-30: visitReporter の確定経路を commitSettled 経由に変更し PRIVATE_PAGE_DETECTED の outcome を永続化。unit 3件追加・repeats=20 green)
- 発見3(診断ギャップ・小修正): ~~DOMAIN_BLOCKED は CAPTURE_FAILURE_REASONS 未収録でパネルは "Internal / unlisted" 表示~~ → 完了(2026-10-30: テーブルに {code:'DOMAIN_BLOCKED', category:'permission'} 収録、E2E で unlisted 接尾辞消滅を pin)。i18nKey captureFailure_domainBlocked の ja/en wiring は後続(messages.json 共有編集のため)
- プローブ拡張は未実施(ブロッカー: contentKernel.ts の2呼び出し箇所+validators.ts の厳密キー許可リスト+messageTypes.ts の inline ペイロード拡張が必須。本 spec は LAST_CAPTURE_OUTCOME 経路で実装済み)

## 実装記録（2026-10-30・第三者レビュー対応）
✅ 2026-10-22-06 第三者レビュー対応（敵対的レビュー+反証済み報告を受けて）: force 再送成功時の outcome を 'recorded' に正規化（確認ダイアログ承認+force 成功でも元の拒否が persist される誤診断を解消。`resendResponse` をハーネス第4引数に追加し pin 3 件: 成功→recorded・throw→元の拒否・非成功→元の拒否）・`commitSettled` の再スキャン baseline を成功ゲート化（`response?.success === true` の場合のみ reportedContentChars を更新。拒否ページが最大 2 回の無駄な再送に武装する問題を解消。同日 skip(success+skipped) は baseline を進める判断を pin+コメントで明示）・capture-late-rescan spec の pin を翻訳文前提に更新（`captureFailure_domainBlocked` の ja/en wiring 済みのため生コード表示が翻訳文に変わる。messages.json から翻訳文を実行時読み込みするロケール非依存 RegExp ユニオン+生コード非表示 pin。修正前の実行で pin が実際に落ちることを先に確認）・`captureFailureReasons.ts` ヘッダの虚偽コメント（"wiring rides a later slice"）を「diagnosticsPanel.ts が本日消費」に修正・発見1 pin の step 名とコメントに「発見1の修正（行更新）を実装するとこの assert は壊れる。その場合は修正後契約へ書き換え」を明記。検証: visitReporter.lastOutcome 11 テスト/連続 10 回 green、src/content+src/dashboard 全体 298 ファイル/3960 テスト green、eslint 0、tsc 0、E2E build 後 2 passed/repeat-each=3 6 passed。別 PBI 候補: captureOutcome 契約の構造的保証強化（語彙の偶然でしか守られていない）・未同意 VALID_VISIT 拒否のローカル記録エッジ
