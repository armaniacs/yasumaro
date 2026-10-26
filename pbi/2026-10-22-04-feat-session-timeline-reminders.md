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
- 残 O1: dashboard registry 配線(パネル登録 + HTML + i18n 鍵)。最小片: 本モジュールの renderPlayback 呼出しと onOpenRecord→履歴 navigate の1経路。
- 残 O2: service-worker 配線(alarm listener→checkToday、通知 click→URL/記録を開く、釦→dismiss/snooze/discard)。最小片: alarm listener + click 開封のみ。
- 残 O3: 候補 provider(SQLite→集計→ReminderCandidate 写像の SW 側実装)。最小片: 日ゲート成立時だけ読む問合せ1本。
- 残 O4: Daily Note TODO 化(BDD 後段)。最小片: 通知 click からの1行追記。
- 残 O5: E2E通し(O1-O3 完了後、trail 付き seed は実 navigation + nav-trail consent 経路で)。
- 残 O6: 第三者レビュー(今回は自己レビューのみ)。
- テスト: 上記5ファイル計41件グリーン(内訳: 集計10・panel8・store9・notify9・alarms5)。`npx vitest run <5 files> --repeats=20` パス。`npx eslint` 対象9件クリーン。`npx tsc --noEmit` は自ファイル無エラー(他所の既存エラーは不触)。full validate / build / headed E2E / commit は制約どおり未実行。
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
- [ ] 全BDDシナリオが自動テストとして実装されパスする(2026-10-25: 単体41件グリーン、E2E通しは O5 として残)
- [x] コードレビュー完了(2026-10-25: code-review スキルで自己レビュー、所見3件を修正済み・下記R-06。第三者レビューは O6)
- [ ] ドキュメント更新済み(再生ビューの操作手順を含む)(2026-10-25: 草案を本PBI末尾 R-07 に記録。docs/ は制約により不触)
