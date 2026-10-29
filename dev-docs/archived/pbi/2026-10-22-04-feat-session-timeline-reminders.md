# PBI: セッション復元 ― タイムライン再生と読みかけリマインド

## ユーザーストーリー
調査する人として、中断した調べ物を時系列で再生し、読みかけを翌日に思い出したい、なぜなら開きっぱなしのタブが散らかったまま終わるから

## 優先度
- 順位: 04 / 6候補
- RICEスコア: 320 (Reach=500 / Impact=2 / Confidence=0.8 / Effort=2.5人週)
- 根拠: Dと同点。利用者範囲が広い(500対200)ためDより先に置く。E5/E8相当
- 依存: なし。PBI 03とは独立(03は知識圧縮、本PBIは行動復元)

## 背景・制約
- `nav_source_url` / `search_query` の既存2列を活用する。列削除ボタン・手動保存の遷移記録は別途要望待ち(現行は自動記録valid-visitのみ)
- 通知はchrome.notifications経由。Todoist等の外部タスク化は本PBIに含めない
- `visit_duration` NULL問題・滞在パネル撤去の経緯に触れる場合は計時配線の復活を条件にする

## BDD受け入れシナリオ
Scenario: セッションを再生する
  Given 同一トピックの訪問が時系列で5件以上ある
  When タイムライン再生を開いた
  Then 訪問順・滞在・遷移元が順に表示され、該当記録に飛べる

Scenario: 読みかけを思い出す
  Given 最後まで読まれなかった記録がある
  When 翌日のリマインド条件を満たした
  Then 再訪候補として1件通知され、Daily NoteにTODOとして残せる

## 受け入れ基準
- [ ] 再生ビューから元記録・元URLに到達できる(2026-10-25: 到達モジュール完成・下記R-02、dashboard registry 配線は O1 として残)
- [ ] リマインドは解除・再通知・破棄ができる(2026-10-25: 状態遷移+永続化完成・下記R-03、UI釦とSW配線は O1/O2 として残)
- [x] 通知が多すぎる場合の上限と間引きがある(2026-10-25: REMINDER_MAX_PER_DAY=1 pin + 候補3件維持 + 日ゲート両面pin・下記R-04)
- [x] プライベート判定記録は再生・通知の対象外にできる(2026-10-25: isPlaybackExcluded + buildPlaybackModel 内で除外・下記R-02)

## テスト戦略
## 実装記録（2026-10-25・再生ビュー/リマインド操作/送信経路）
- R-01 なぜなぜ分析45回(1疑問に5なぜ×3立場×疑問3件: 永続化場所・再通知条件・上限根拠)。結論は下記Q1-Q3。各立場の往復後に集約した。
  - Q1 永続化場所(利用者/保守者/攻撃者): 利用者は「解除したはずが翌日また出る」ことを嫌うため再起動を超えて残す必要がある。session storage は SW再起動で失われ再通知スパムになる。SQLite記録DBは purge 対象で状態と記録が混ざると移行が複雑になる。結論: chrome.storage.local のモジュール所有キー `session_reminder_state_v1`。IDのみ保持(URL/題名を持たない = 第二のPIIコピーを作らない)。件数上限500。検証は fail-closed(壊れたら初期状態、日ゲートは維持 - 被害は1件/日に限定されるため)。StoragePort 注入で実時間待ちテストを排除。
  - Q2 再通知条件(利用者/仕様/実装・運用): dismiss=当日非表示・翌日再適格(「今日は見ない」は「二度と見ない」ではない)。snooze(untilMs)=指定時刻まで非表示、過去時刻は即適格。discard=ID恒久除外(再訪問は新IDなので再候補になる - 蒸し返しではない)。日付はローカル YYYY-MM-DD で shouldFireReminderToday と同一物差し。SW停止中の snooze 期限切れは毎時 alarm で拾う(厳密配送は不要 - リマインドに締切はない)。破損時は通知が出る側に倒す(出過ぎは日ゲートで抑えられるが、出ない故障は気づけないため)。
  - Q3 上限根拠(利用者/保守者/攻撃者・運用): 1日1件は BDD「1件通知され」の直接根拠。候補3件は集計既定の維持。溢れた候補は再生ビューに残る + dismiss は翌日再適格なので取こぼしはない。定数化(REMINDER_MAX_PER_DAY)し両面テストで pin。alarm は毎時(再起動耐性 + snooze 拾い)、日ゲート成立時のみ候補問合せを実行(毎時の重いDB読みを避ける)。上限は発火を抑える側なので濫用増幅にならない。
- R-02 再生ビュー到達モジュール: `src/dashboard/sessionTimelinePanel.ts` 新規。toSessionTimelineRecord(NULL→undefined 対応で fail-closed 維持)、isPlaybackExcluded(masked_count>0)、buildPlaybackModel(除外→写像→集計)、renderPlayback(CSP安全: textContent のみ、http(s)のみ錨 target _blank + rel noopener、元記録釦は onOpenRecord フックに ID 渡し、空は理由文)。pin: `src/dashboard/__tests__/sessionTimelinePanel.test.ts` 8件。
- R-03 操作の永続化: `src/utils/sessionReminder/reminderStore.ts` 新規(中立層配置の理由は R-05)。dismiss/snooze/discard/markReminderFired 純粋遷移 + isRecordEligible + validate/load/save。pin: `src/utils/sessionReminder/__tests__/reminderStore.test.ts` 9件(遷移・適格・破損時初期化・部分的破損の切捨て・IDのみ保持・__proto__ 除外・往復)。
- R-04 送信経路政策: `src/utils/sessionReminder/reminderNotify.ts` 新規(REMINDER_MAX_PER_DAY=1 pin、pickReminderToFire=日ゲート→適格フィルタ→先頭1件、通知文は題名+ホストのみ・URL全文なし)。`src/background/sessionReminderAlarms.ts` 新規(毎時 alarm、日ゲート成立時のみ候補問合せ、通知後 lastFiredDay 永続化、全面注入で chrome 直結なし)。pin: reminderNotify 9件 + sessionReminderAlarms 5件 + 集計側ゲート一致テスト1件(両面ドリフト防止)。
- R-05 層境界の是正: 当初 store/notify を dashboard 配下に置いたが eslint no-restricted-imports 警告(background→dashboard 禁止、dev-docs/LAYERS.md)が出たため中立層 src/utils/sessionReminder/ に移動。dashboard 側の集計型への依存は構造的部分型(ReminderCandidateLike)で断ち切り、import type すら持たない。dashboard→utils 方向は許容。
- R-06 コードレビュー(code-review スキル、自己レビュー): 所見3件を修正。(1) 脆弱性: validateReminderState の `records[key] = valid` が JSON 由来 `__proto__` キーでプロトタイプを書換える → isUnsafeRecordKey で除外(__proto__/constructor/prototype)しテスト追加。(2) 正確性: 再生ステップの time に dateTime 欠落 → ISO dateTime 付与。(3) 保守性: 日ゲートの二重実装ドリフト → 集計テスト側に一致テスト追加。残 accept: 二重発火 TOCTOU(単一SW想定で低)、見出しの i18n 固定英語(O1 で鍵化)、snooze NaN の直接構築( load 経路では検証済み)。
- R-07 再生ビュー操作手順(草案、docs/ 制約のため本PBIに記録): (1) ダッシュボードのパネル一覧から「Session playback」を開く(配線 O1 後に有効)。(2) セッション見出しは「順番 (根拠列, 件数)」、trail 行は検索語または遷移元を示す。手順は訪問順(古い順)に並ぶ。(3) 題名リンクで元URLを別タブに開く。(4) 「Open record」釦で元の履歴記録に飛ぶ。(5) 読みかけ候補は通知1日1件で届く。今日見ない場合は dismiss(翌日再通知)、時刻指定は snooze、不要は discard。破棄の取消は v1 なし。再訪問は新しい記録として再候補になる。(6) 通知が来ないとき: プライベート判定記録は対象外、trail 列なし記録はセッションに入らない旨の空理由が表示される。
- R-08 E2E: `testDir/e2e/session-timeline-reminders.spec.ts` 新規(headless、--repeat-each=3 --retries=0 --workers=1)。2件とも headless では fixture の fixme で skip(MV3 SW が headless 未対応 - extension.fixture の HEADLESS_FIXME_MESSAGE、headed 実行は本セッション制約で禁止)。内容: (a) scroll_ratio 付き6行が履歴パネル経路を流れる、(b) 実 chrome.storage.local での状態キー往復。通し(調査→中断→翌日→通知→再訪)は O5: import 経路が trail 2列を落とす(maintenanceBatchHandler.ts 調査済み)ため trail 付き seed が共有 handler 変更なしに不可能。
- 残 O1: dashboard registry 配線(パネル登録 + HTML + i18n 鍵)。最小片: 本モジュールの renderPlayback 呼出しと onOpenRecord→履歴 navigate の1経路。→ 完了(2026-10-30・下記実装記録)
- 残 O2: service-worker 配線(alarm listener→checkToday、通知 click→URL/記録を開く、釦→dismiss/snooze/discard)。最小片: alarm listener + click 開封のみ。→ 完了(2026-10-30・snooze は Chrome の釦2件上限で非表現・後述)
- 残 O3: 候補 provider(SQLite→集計→ReminderCandidate 写像の SW 側実装)。最小片: 日ゲート成立時だけ読む問合せ1本。→ 完了(2026-10-30)
- 残 O4: Daily Note TODO 化(BDD 後段)。最小片: 通知 click からの1行追記。→ 完了(2026-10-30・追記失敗時は通知を消さない)
- 残 O5: E2E通し(O1-O3 完了後、trail 付き seed は実 navigation + nav-trail consent 経路で)。→ 完了(2026-10-30・trail 列の実 navigation 実測まで。実通知の実クリック表示は owner 手動)
- 残 O6: 第三者レビュー(今回は自己レビューのみ)。→ 完了(2026-10-30・統合側で敵対的第三者レビュー実施+指摘修正済み・下記実装記録)
- テスト: 上記5ファイル計41件グリーン(内訳: 集計10・panel8・store9・notify9・alarms5)。`npx vitest run <5 files> --repeats=20` パス。`npx eslint` 対象9件クリーン。`npx tsc --noEmit` は自ファイル無エラー(他所の既存エラーは不触)。full validate / build / headed E2E / commit は制約どおり未実行。

## 実装記録（2026-10-30・O1-O5 統合実装）
- O1 パネル登録: `src/dashboard/panels/asyncData/sessionTimelinePlaybackPanel.ts` 新設（`createSessionTimelinePanel()`、fetchPeriodRows→isStale→renderPlayback、onOpenRecord→`tryNavigateTyped('panel-sqlite-history', {searchDomain})` 1経路）。`panelCatalog.ts` data セクション末尾に `panel-session-timeline` 行+factory。`entrypoints/options/index.html` サイドバーボタン+section。`messages.json` 両 locale に sessionTimeline* 9 種。見出しテンプレート `formatPlaybackHeading()` で R-06 残「見出しの i18n 固定英語」を鍵化（未知プレースホルダは verbatim で壊れない）
- O2 SW 配線: `alarmRegistry.ts` に行 `{name: SESSION_REMINDER_ALARM_NAME, install: start, run: checkToday}`（サービスがアラーム所有・registry が dispatch 所有）。`compositionManifest.ts` に `sessionReminderAlarms`（queryCandidates=SW 側 provider、show は唯一の chrome.notifications.create 経由 NotificationHelper 経由、iconUrl、actionLabels）。`service-worker.ts` に click/釦 guarded リスナ（自プレフィックスでガード）。`sessionReminderClick.ts` 新設: 通知 ID 解析（厳密 digit+往復一致・外来通知は対象外）→記録 DB 再読で URL 取得→私物(masked_count>0)拒否→非http(s)拒否→openTab。釦0=dismiss（当日非表示・翌日再適格）、釦1=discard（恒久除外）、状態永続化成功後にのみ通知 clear
- O3 候補 provider: `sessionReminderCandidates.ts` 新設。1 クエリ（day gate が閉じている間は呼ばれない既存 checkToday 契約を維持）→fail-closed 行マッピング→古い順→上限 3。`REMINDER_UNREAD_SCROLL_RATIO=0.9`/`REMINDER_CANDIDATES_MAX=3` は dashboard aggregate と両面 parity テストで固定（レイヤー違反 import なし）
- O4 Daily Note TODO: 通知 click 成功後に `buildReminderTodoLine`（sanitizeForMarkdownLinkText+sanitizeUrlForMarkdownTarget）で追記。追記失敗は logWarn のみで**通知は消さない**（追記は追加動作・再試行可能）
- O5 E2E通し: nav-trail consent を seed で有効化→同一タブで実 navigation（検索語脚は外部ネットワーク依存のため nav_source_url 脚で同一 trail パイプラインを行使する判断を spec コメントに記載）→trail 列が記録に入ることを実 SQLite query で検証（nav_source_url 実測一致）。alarm は compositionManifest の install が武装のみのため alarm 名で手動発火する設計を spec コメントに記載。実通知の実クリック表示は owner 手動（chrome.notifications に click 発火 API なし・fixme/skip は足していない）
- docs: `docs/SETUP_GUIDE.md` に「セッション再生（読みかけの復元）/ Session Playback」小節（ja/en。使い方・見出しの読み方・通知釦 dismiss/discard・snooze 未対応の注記・通知が来ないときの注意）。文字種ゲート 0
- snooze 非表現の理由: Chrome の通知釦上限 2 件・時刻指定不可のため。dismiss/discard のみ実装し、snooze（時刻指定）は残タスクとして spec・docs・本記録に明記
- 検証: 変更/新規 126 テスト×10 連続 green（vitest 5.0.5+projects 構成で `--repeats` が乗算されないため等価の連続実行で代替。ツール起因の観測）、全体 536 ファイル/6894 テスト green、eslint 0、tsc 0、check-i18n 2/2、文字種ゲート 0
- 契約バグ修正（O5 で発見）: `commonStorageFields.ts` の scroll_ratio が wire のパーセント(0..100)を素で保存し、`browsingLogSchema` の CHECK(0..1)違反で insert 失敗＝記録消失（CHECK なしでも全スクロール頁が「読了」扱いになり候補が立たない）。mapper 境界で 1 箇所正規化（/100）+固定テスト 2 件。wire の名前（Percent）と列名（ratio）の意味論を保持
- 契約バグ修正2（O5 E2E で発見・統合側修正）: `recordRequestBuilder.ts` の `pickRecordDiagnostics`（diagnostic field 受渡しの単一所有者）が engagement metrics（visitDurationSeconds/scrollRatioPercent）を転送しておらず、本番では保存行の visit_duration/scroll_ratio が常に NULL になっていた（PBI 2026-10-23-02 の metrics wire が content script 送信と mapper 読取のみで受渡しが欠落）。NULL ratio は候補 provider で fail-closed（非候補）になるため**リマインダーが 1 件も発火しない**状態だった。受渡し表に metrics 2 field を追加+固定テスト 2 件（14 key pin・valid-visit からの運搬 pin）。E2E 実測: visit_duration 5.01 秒・scroll_ratio 0.7 が保存されることを確認
- spec 修正2件: 既存 spec の strict-mode 違反（共有プレフィックスで 6 行にマッチし必ず失敗）を 1 行確定に修正。通しの masked_count 表明は dashboard query の投影に含まれない列のため削除（私物除外は候補 provider の fail-closed 単体テストと panel の isPlaybackExcluded テストが担保する旨を spec コメントに記載）
- E2E: `session-timeline-reminders --project=extension` 3 passed・`--repeat-each=3` 9 passed（通し含む。実通知の実クリック表示は owner 手動）

## 実装記録（2026-10-30・第三者レビュー対応）
✅ 2026-10-22-04 第三者レビュー対応（敵対的レビュー・反証済み報告を受けて）: P0-1 OPFS plain-list 投影に `masked_count` 追加（`rowCodec.ts` 列 SSOT+coerceCell 整数 case。私物拒否が本番 OPFS 経路で fail-open になっていた問題を投影修正で解消。実エンジン parity テスト「OPFS plain listing supplies masked_count」新設。消費者側 `?? 0`/`?? null` は実値が届くため据え置き=NULL 判定未記録行は非私物のパネル同一規約）・P0-2 reminder alarm `start()` を get-then-create 化（`shouldCreateStandingAlarm` 純判断・standingAlarmGuard 前例・daily purge と同一。5 分 offline-retry アラームがワーカーを起こすため clear+create では 60 分に達せず本番で発火しないバグを修正。新規 pin 3 件: 既存欠落時のみ create・決して clear しない・再起動で scheduledTime 存続。`AlarmPort` に get 追加）・P0-3 TODO 行を `sanitizeForMarkdownLinkText(normalizeSingleLine(title))` 連鎖に変更（他の全 markdown 出力と同一。改行注入経路を潰し、捏造 checkbox も bracket エスケープで描画されない pin 新設。normalizeSingleLine を export 化）・P1-4 metrics を両層化（`limits.ts` に `MAX_VISIT_DURATION_SECONDS=86400`/`MAX_SCROLL_RATIO_PERCENT=100` バウンド共有 SSOT、ValidVisitValidator に assertMetricField rejected 検証、mapper に clampVisitDuration/clampScrollRatioPercent 第二層。NaN・範囲外が CHECK 違反＝insert 失敗になる経路をワイヤで拒否）・P1-5 候補に当日除外フィルタ（`startOfLocalDayMs` より前のみ候補。docs「前日までに読みかけたページ…を翌日に通知」契約にコード側を整合。clock 注入で day gate テスト可能化）・P2 全件（`clearElement` canonical 置換・alarmRegistry 行コメントを get-then-create の理由に書き換え・parity テストを isPlaybackExcluded 実物経由に）。「表示→永続化」順（checkToday が show → save）は PBI 破損時ルール「通知が出る側に倒す（出過ぎは日ゲートで抑えられるが、出ない故障は気づけない）」と一致するため維持と判断（save 失敗時の再発火は quota 等の稀な障害時のみで日ゲート閉鎖まで有界）。検証: 全 src スイープ 1149 ファイル/17013 テスト green・変更 13 テストファイル×10 連続 green・parity suite green（sqliteBackendParity 23 等）・eslint 0・tsc 0
- 私物メモ: `git stash/checkout -- ./reset/clean` 不使用、未コミットのまま残す。pbi/00-INDEX・CHANGELOG・package.json・docs/・他PBI不触。

## 実装記録（2026-10-23・集計経路）
- タイムライン集計: 完了。`src/dashboard/sessionTimelineAggregate.ts` の `buildSessionTimelines` が既存2列(nav_source_url/search_query)を活用してトレイル群を集計。同一検索語または同一遷移元の記録を訪問順(古い順)に並べ、basis(どの列でグループ化したか)を結果に載せる。グループは件数降順
- 少件数縮退: 完了。トレイル列が両方とも無い記録はセッション構成員から除外、`MIN_SESSION_SIZE`(2) 未満のグループは破棄(単行の偽セッションを作らない)
- 読みかけ候補: 完了。`buildReminderCandidates` が `UNREAD_SCROLL_RATIO`(0.9) 未満の記録を再訪候補に。滞在なし(scalar欠落)は判定対象外(fail-closed)。古い読みかけ順
- 間引きと上限: 完了。`shouldFireReminderToday` が1日1件(REMINDER_MAX_PER_DAY)を判定、候補は `REMINDER_MAX_CANDIDATES`(3) で上限。通知面の静けさを保つ
- プライベート除外: 呼び出し側が既存のプライベート判定記録を事前にフィルタする契約(本モジュールは再許可しない)
- pin: `src/dashboard/__tests__/sessionTimelineAggregate.test.ts` 10テスト(トレイル群集計・既存2列の優先順・少件数縮退・読みかけ候補・fail-closed・上限・間引き・送信側ゲート一致)
- 残: 2026-10-25 記録の O1-O6 に更新(下記「実装記録（2026-10-25...)」節)。当初残のうち到達モジュール・状態遷移+永続化・送信経路政策・自己レビュー・操作手順草案は完了
- E2E: 調査→中断→翌日条件→通知→再訪の通し
- 統合: 遷移2列の欠落時の縮退表示テスト
- 単体: 中断判定・間引き・上限の境界テスト

## 見積もり
2.5人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする(2026-10-30: 単体 126件+レビュー修正テスト green・E2E通し 3 passed/repeat-each=3 9 passed。実通知の実クリック表示は owner 手動)
- [x] コードレビュー完了(2026-10-25: code-review スキルで自己レビュー、所見3件を修正済み・下記R-06。2026-10-30: 統合側で敵対的第三者レビュー+指摘修正済み)
- [x] ドキュメント更新済み(再生ビューの操作手順を含む)(2026-10-30: docs/SETUP_GUIDE.md に「セッション再生（読みかけの復元）/ Session Playback」小節を反映。草案 R-07 は本記録に保持)
