# PBI: 自動ロック通知の fan-out に受け手が無く、成功判定が応答を見ないため IS_LOCKED フォールバックが鍵キャッシュ状態で覆われる問題の修正

## ユーザーストーリー

マスターパスワードを設定し、機密設定（Obsidian / AI の API キー）を暗号化して保存しているユーザーとして、**自動ロック（30分無操作）が発火した後、開きっぱなしのダッシュボードやポップアップが「解錠済み」のまま平文鍵を使え続けないこと**がほしい、なぜならロックの保証は「端末を席を立てた直後から平文鍵が失効する」ことにあるのに、いまの実装ではその保証が成立していないから。具体的には:

- `SessionAlarmService.lockSession()` が投げる `SESSION_LOCK_REQUEST` には、リポジトリ全体で**受け取る側のリスナが 1 つも存在しない**（唯一のハンドラは service worker 自身の `MessageRouter` で、SW は自分の `sendMessage` を受け取らない）。
- 3 回リトライループは「`sendMessage` が解決したら success」とし、**応答本文を捨てている**。したがって受信者がいる場合は 1 回目で success 扱いになってハンドラが一度も動かず、リトライは「受信者がゼロ」の場合にしか発火せず、その場合にも決して成功しない。**成功も失敗も観測できない「無音」のまま**になっている。
- 結果としてロックの実効は `getOrCreateEncryptionKey` 内の `IS_LOCKED` 検査に依存するが、その検査は `cachedEncryptionKey` が非 null のときしか走らない（`encryptionSession.ts:568`）。`unlockWithPassword`（`:706-707`）と `changeMasterPassword`（`:811-812`）は **`cachedMasterPassword` だけが残る状態**を遺すため、この状態では IS_LOCKED を読まずに `cachedMasterPassword` から鍵を再導出して返し、`isEncryptionLocked()`（`:606-609`、モジュール状態のみを参照）も `false` を返す。

 Reach=50（マスターパスワード利用者は少数だが、Reach の母数は拡張ページ利用者に置いた推定）。

## 優先度

- 順位: 20 / 25
- RICE: 400（Reach=50 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査20位。security-audit run-2 の `needs_validation` リード。VULN-017 の修正が入れた `SESSION_LOCK_REQUEST` 通知には、受け取る相手がいない。唯一のハンドラは service worker 自身の MessageRouter（`MessageRouter.ts:226`）で、SW は自分の send を受けない。offscreen は `target` フィールドの無いメッセージに反応せず（`offscreen.ts:67` で `return false`）、ダッシュボードのリスナは `AI_TEST_PROGRESS` に絞り込まれ（`aiTestProgressClient.ts:69-70`）、リポジトリ全体で送信者が producer のみ。リトライループは「解決した時点で success」とし応答値を捨てるため、受信者がいる場合は 1 回目で成功扱いになってハンドラが一度も動かず、リトライは「受信者がゼロ」の場合にしか発火せず、その場合でも決して成功しない。結果としてロックの実効は `getOrCreateEncryptionKey` 内の `IS_LOCKED` フラグ検査に依存するが、その検査は `cachedEncryptionKey` が非 null のときしか走らず、`unlockWithPassword`（`encryptionSession.ts:706-707`）と `changeMasterPassword`（`:811-812`）は `cachedMasterPassword` だけが残る状態を遺する（この状態でロック後もキャッシュ済みパスワードから鍵が導出され、`isEncryptionLocked` も `false` を返す）。マスターパスワード利用者は少数だが、**ロックという保証が成立していない**。
  - -cohort（該当プロファイル）: マスターパスワードを設定済みで、拡張ページ（ダッシュボード / ポップアップ）を開きっぱなしにしているプロファイル。かつ `unlockWithPassword` または `changeMasterPassword` 経由でセッションが `cachedMasterPassword` 保持・`cachedEncryptionKey` null の状態に入った後、30分以上操作がない状態で自動ロックが発火したケース。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中（fan-out の先に受信者が存在しないことと、鍵キャッシュの状態設計に及ぶ）
- 副作用: 🔴あり（**ロック挙動そのものが変わるため、ロック済み時の UI・データ保護の挙動を owner が確認する必要がある**。具体的には: ①選択肢 3（消費側の `IS_LOCKED` 検査を `cachedEncryptionKey` 非 null に限定しない）を採用すると、`cachedMasterPassword` だけが残る状態で次の暗号操作が `ENCRYPTION_LOCKED: Session is locked` を投げるようになるため、`settingsMigration.ts:538` / `obsidianClient.ts:148` / `RemoteAIService.ts:153,176` の `isEncryptionLockedError` 経路が Dashboard 上で「パスワード入力モーダル」を誘発するようになる（UI 変更を伴わない暗黙の挙動変化）。②選択肢 1（拡張ページにリスナを足す）を選ぶと、dashboard / popup / offscreen の起動ライフサイクルに `chrome.runtime.onMessage` リスナが追加され、`subscribeConsentChanges`（`privacyConsent.ts:325-332`）と同じ「ページが生きている間だけ購読」という前提が増える。③既存テスト `storage-security.test.ts:455-467`「`IS_LOCKED` が true でもマスターパスワード未設定ならキャッシュ鍵を返す」と `SessionAlarmService.test.ts:167-193`「3 回目で成功したら試行が 3 回で終わる」は**期待値の書き換えが不可避**。④「手動ロック（UI から `SESSION_LOCK_REQUEST` を送る経路）」は従来どおり全コンテキストに効くことが回帰ガードとして要求される。加えて MV3 のプラットフォーム挙動（下記ブロッカー）が未確定のため、**着手の順序は owner 確認 → Red テスト → 実装**の順から外せない**）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `session-auto-lock:fanout-no-receiver-response-discarded`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` / `NEEDS-VALIDATION.md` の「## 20. Auto-lock SESSION_LOCK_REQUEST fan-out has no receiver; success marked on any resolution leaves the IS_LOCKED fallback uncovered for cached-password session state」）。

判定は `needs_validation`。reachability の確認: `SESSION_LOCK_REQUEST` は `messageTypeRegistry.ts:39`（service-worker 宛て型）と `:74`（`NO_PAYLOAD_TYPES`）に載っているが、`src/` 全体で `chrome.runtime.onMessage.addListener` を呼んでいるのは 4 箇所だけで（`service-worker.ts:226` / `offscreen.ts:165` / `aiTestProgressClient.ts:75` / `privacyConsent.ts:331`）、**そのうち SESSION_LOCK_REQUEST を処理するのは service worker 自身（`MessageRouter.ts:226`）だけ**。送信者（producer）は `SessionAlarmService.ts:165` の 1 箇所のみ。よって fan-out は構造的に空回りしている。

**再現経路（trace）**

1. `src/background/alarmRegistry.ts` — 監査ref（`git show d49d70a3:`）`:153-157` の job entry `{ name: 'check_session_timeout', install, run }` の `run`（**:156**）が `deps.sessionAlarmService.checkTimeout()` を呼ぶ。**現在 HEAD（56f1d7c1）では同じ entry が `:176-180`、`run` は `:179`**（`yasumaro-recording-resume` / `yasumaro-recording-pause-tick` が 2 件追加されたため +23 行）。`sessionAlarmService` の deps 宣言は HEAD `:34`。
2. `src/background/SessionAlarmService.ts:115` — `checkTimeout()` が唯一の入口（`:110-114` のコメントどおり、ここに `onAlarm` を足すと 1 発火 2 実行になる）。`:125-127` で `MASTER_PASSWORD_ENABLED` が無ければ即 return、`:129-135` で `elapsed > SESSION_TIMEOUT_MS`（`:22` の 30 分）を判定し `:136` で `lockSession()`。
3. `src/background/SessionAlarmService.ts:153-192` — 私有 `lockSession()`。`:155` で `IS_LOCKED: true` を書き、`:157-159` に VULN-017 のコメント（通知の目的を「キャッシュ済み復号鍵を自動ロック後に使用可能に留めないこと」と明記）、`:160-175` が 3 回リトライループ（`:160` `retries = LOCK_NOTIFICATION_MAX_RETRIES`（`:27` の 3）、`:162` `while (retries > 0 && !success)`、`:164-167` `sendMessage({ type: 'SESSION_LOCK_REQUEST', protocolVersion })`、**`:168` `success = true`（解決した時点で成功。応答値は破棄）**、`:169-174` catch で `retries--` と `:172` の `stepDelay(100ms)`）。`:176-183` の失敗ログも「Session will be locked via IS_LOCKED flag check in getOrCreateEncryptionKey」と、最後の防御線がここであることを明示している。
4. ハンドラ側 — `src/background/handlers/systemHandlers.ts:219-230` の `createSessionLockRequestHandler` が `:227` で `deps.lockSession()`、`:228` で `sendResponse({ success: true })`。配線をたどると `MessageRouter.ts:226`（`SESSION_LOCK_REQUEST: createSessionLockRequestHandler({ lockSession: deps.lockSession })`）→ `MessageRouter.ts:140` の deps 型 → `compositionManifest.ts:267`（`lockSession: () => lockSession()`、`:42` で `encryptionSession.js` から import）→ `encryptionSession.ts:779-783`。エクスポートは `service-worker.ts:153`。**しかし送信元は SW なので `chrome.runtime.onMessage`（`service-worker.ts:226`）には届かない**。
5. 拡張ページ側の受信者は 3 箇所とも非対応 — `src/offscreen/offscreen.ts:62-69` は `!('target' in message)` で即 `return false`（送信側の envelope は `target` を持たない）、`src/dashboard/aiTestProgressClient.ts:66-73` は `sender.id` と `isAiTestProgressMessage(message) && runId` 一致で絞り込み、他に `src/content/extractor.ts:164`（content script 文脈）と `privacyConsent.ts:326-331`（`CONSENT_STATE_CHANGED` のみ）。
6. sink — `src/utils/storage/encryptionSession.ts:566-591` の `getOrCreateEncryptionKey`。`:567` に VULN-017 コメント、**`:568` `if (cachedEncryptionKey)` の中にだけ `:569` `await authGuardIsLocked()` が居る**。`:570-572` で両キャッシュを null にして `ENCRYPTION_LOCKED: Session is locked` を投げる。キャッシュが null だと `:578-588` に進んで `MASTER_PASSWORD_ENABLED` を見るだけで、**`IS_LOCKED` を一切読まずに** `:586` `deriveKeyFromMasterPassword(salt)` → `:158-174`（`:162-164` は `!cachedMasterPassword` のときだけ throw、`:173` で `cachedMasterPassword` から PBKDF2 導出）→ **ロック後も鍵が返る**。`:606-609` の `isEncryptionLocked()` も `!cachedMasterPassword` しか見ないので `false` を返す。
7. 当該状態を遺すのは `unlockWithPassword`（`:657-715`、`:706` `cachedMasterPassword = password` / `:707` `cachedEncryptionKey = null` / `:708` `IS_LOCKED: false`）と `changeMasterPassword`（`:795-815`、`:797` で旧パスワードを `unlockWithPassword` し `:811-812` で新パスワードでセッションを引き継いでキャッシュを null にする）。補足: ダッシュボードの認証モーダル本体は `verifyMasterPasswordWithRehash`（`:732-774`、dashboard 側は `src/dashboard/masterPassword.ts:310`）で、**こちらは `cachedMasterPassword` を触らない**（検証のみ）。したがって「キャッシュ済みパスワードだけが残る状態」は主にパスワード変更/内部 unlock 経路で生じる。

**既存テスト（現状 pin している挙動）**

- `src/background/__tests__/SessionAlarmService.test.ts:150-165` — sendMessage が reject し続けると 3 回試行・`stepDelay` 2 回（100ms ずつ）を pin。`:167-193` — 2 回失敗 3 回目成功で試行が 3 回で終わることを pin。**「解決したら 1 回で成功」が前提のテストは無いが、リトライの打ち切り条件が固定されている**。
- `src/background/pipeline/steps/__tests__/sessionAlarmsManager.test.ts:352-365` — `check_session_timeout` 発火で `IS_LOCKED: true` と `SESSION_LOCK_REQUEST` 送信を pin。`:404-418` — マスターパスワード未設定なら一切ロックしない（`SessionAlarmService.ts:125-127` の分岐）を pin。
- `src/background/handlers/__tests__/systemHandlers.test.ts:348-353` — `SESSION_LOCK_REQUEST` が `deps.lockSession()` を呼ぶことを pin。`src/background/handlers/__tests__/senderTrustCoverage.test.ts:45` — 信頼レベルが `extension-only` であることを pin。
- `src/background/__tests__/service-worker.test.ts:834,971,2905` ほか — SW の `SESSION_LOCK_REQUEST` ハンドラが応答することを pin（**これは「ハンドラが登録されている」ことの pin であり、「通知が届く」ことの pin ではない**）。
- `src/utils/__tests__/storage-security.test.ts:455-467` — 「マスターパスワード未設定なら `IS_LOCKED: true` でもキャッシュ鍵を返す」を pin（＝`authGuard.isLocked` の `MASTER_PASSWORD_ENABLED &&` ガードの根拠）。`src/utils/storage/__tests__/encryptionSession-branch.test.ts:137-156` — `isEncryptionLocked()` の期待値。
- `src/background/__tests__/SessionAlarmService.test.ts` の `stepDelay` 注入（`:91` 付近のコンストラクタ）は PBI 2026-10-07-09（`dev-docs/archived/pbi/2026-10-07-09-refactor-sessionalarm-injectable-sleep.md`）で入れたもので、実時間待ち禁止のルールに従った状態。

**監査側の blocker（着手前に潰すべき owner 確認）**

1. **MV3 service worker の `chrome.runtime.sendMessage` は、送信者自身の `onMessage` を起動しない。** したがって `service-worker.ts:226` のリスナは `SessionAlarmService.ts:164` の送信を決して受け取らない。これはプラットフォーム事実でありソースのみからは確定できない。`dev-docs` 内の `privacyConsent.ts:310-314` にも「chrome runtime メッセージは送信者自身のコンテキストへは配送されない（過去に onboarding が再表示されない退行を生んだ）」という**同じ事実の既に記録された記述**があり、これが本件 finding と整合する一次証拠でもある（実装時に同じ注釈を `SessionAlarmService` 側にも残すこと）。
2. **拡張ページのリスナが「存在するが応答しない」場合、`sendMessage` は reject するのか resolve するのか。** 「解決する（no receiver）」と「リスナはいるが無応答（resolve）」で挙動が分かれる。findings.json は「extension-page listeners exist but none responds → resolves (rather than rejects)」を blocker として挙げているが、これは**未観測**。owner が隔離プロファイルで確認すること（resolve の場合、現在のループは 1 回目で success になり、`:176-183` の失敗ログすら出ない）。
3. **手動ロック経路の現況。** 「手動ロックは従来どおり全コンテキストに効くこと」を回帰ガードとして BDD に入れるには、UI から `SESSION_LOCK_REQUEST` を送る producer が存在するのか（＝手動ロックは dashboard 内で `encryptionSession.lockSession()` を直接呼んでいるのか、それとも SW 経由で飛んでいるのか）を実ファイルで確定する必要がある。監査 trace は producer が 1 箇所（`SessionAlarmService.ts:165`）のみと報告しており、**UI からの手動ロックが存在しない場合、BDD シナリオ 2 は「将来この経路を再構築したときの不変条件」として位置づける**。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 自動ロック発火後、鍵キャッシュを持つダッシュボードのコンテキストがロック状態を認識する
  Given ユーザーがマスターパスワードを設定済みで、拡張ページを起動している
  And   そのコンテキストが「cachedMasterPassword あり・cachedEncryptionKey null」の残存状態（unlockWithPassword / changeMasterPassword 後に残る状態）にある
  When  30分以上の操作がない状態で check_session_timeout が発火し、自動ロックが走る
  Then  コンテキストのストレージに IS_LOCKED=true が書かれ、
  And   次の暗号操作（getOrCreateEncryptionKey 相当）で ENCRYPTION_LOCKED が返り、平文鍵は導出されない
  And   ロック前に解決してモジュール内に残っていた鍵が使われることはない
  And   isEncryptionLocked() 相当の状態判定が false を返さない（ロック済みであることを UI が認識できる）

Scenario: 2. 手動ロックは従来どおり全コンテキストに効く（回帰ガード）
  Given ユーザーがマスターパスワードを設定済みで、ロック解除可能な状態にある
  When  ユーザーが手動でロックする（既存のロック経路。前提: 送信者は producer として SESSION_LOCK_REQUEST を発行し、受信コンテキストが handler を実行する）
  Then  そのコンテキストは cachedMasterPassword / cachedEncryptionKey の両方を破棄し、
  And   次の暗号操作はパスワード入力を求める
  And   本修正で fan-out の宛先や成功判定を変えたことで、この経路の検証結果が変わらない

Scenario: 3. ロック通知が「誰にも受け取られなかった」ことを隠さない（可観測性）
  Given SESSION_LOCK_REQUEST を処理するリスナがどのコンテキストにも存在しない構成（現状の Extension パッケージ）
  When  自動ロックが走る
  Then  送信は 3 回の上限内で終わり、
  And   「受信者がゼロ」であることを示す観測可能なログ/エラーコードが残る（無音の success にならない）
  And   既存ログ（SessionAlarmService.ts:178「Session will be locked via IS_LOCKED flag check in getOrCreateEncryptionKey」）と矛盾しない内容である

Scenario: 4. マスターパスワード未設定のユーザーには影響しない（回帰ガード）
  Given ユーザーがマスターパスワードを一度も設定していない
  When  check_session_timeout が発火する
  Then  IS_LOCKED は書かれず、ロック通知も送られない（SessionAlarmService.ts:125-127 の既存ゲートを維持）
  And   暗号化キーの導出経路が従来どおり成功する（storage-security.test.ts:455-467 の期待値を維持）

Scenario: 5. 受信者が存在する構成では 1 回目でハンドラが動く
  Given 少なくとも 1 つのコンテキストに SESSION_LOCK_REQUEST を処理するリスナが存在する
  When  自動ロックが SESSION_LOCK_REQUEST を送信する
  Then  そのリスナが lockSession を実行し、応答本文が「受付済み」を示す
  And   送信側は応答本文を見て成功と判定する（解決しただけで success にしない）
```

## 受け入れ基準

- [ ] `getOrCreateEncryptionKey`（`encryptionSession.ts:566-591`）の `IS_LOCKED` 検査が、`cachedEncryptionKey` が非 null のときだけ走る構造を**廃する**。`cachedMasterPassword` だけが残る残存状態（`:706-707` / `:811-812`）でも検査が走り、検出時は両キャッシュを null 化して `ENCRYPTION_LOCKED: Session is locked` を投げる（`authGuard.isLocked` を `storage.local` を読む唯一の seam として維持する）
- [ ] `SessionAlarmService.lockSession`（`:160-175`）の成功判定が「`sendMessage` が解決した」だけで成立しなくなり、**応答本文で受付を確認する**（`src/messaging/types.ts:323` の `SESSION_LOCK_REQUEST` 応答は `{ success: true }` なので、本文を見て判定する）。判定不能な「無音」を残さないため、確認できない場合は明示的な観測結果（ログ/エラーコード）として残る
- [ ] `SESSION_LOCK_REQUEST` の fan-out 宛先が「**実際に handler を持つコンテキスト**」に修正される。採用した方式（拡張ページのリスナ追加 or SW 内の直接呼び出しへ差替え）をコメントで残し、リポジトリ全体で「送信者は producer のみ」だった状態を終わらせる
- [ ] 既存テストの期待値が本修正の挙動に合わせて**明示的に書き換えられ**、書き換えた理由が各テストにコメントで残る（`SessionAlarmService.test.ts:150-193` / `sessionAlarmsManager.test.ts:352-365` / `storage-security.test.ts:455-467` / `encryptionSession-branch.test.ts:137-156`）。特に「解決したら成功」の前提をしていたテストがあれば、それを「応答本文で判定する」期待値へ変更する
- [ ] ロック済み時の UI・データ保護の挙動が owner によって確認され、結果が記録に残る（隔離プロファイル + ダミーデータ。BDD シナリオ 1〜4 の E2E 相当）。`settingsMigration.ts:538` / `obsidianClient.ts:148` / `RemoteAIService.ts:153,176` の `isEncryptionLockedError` 経路が想定どおり（パスワード入力の誘発／想定外の例外）に振る舞うこと
- [ ] マスターパスワード未設定ユーザー（`SessionAlarmService.ts:125-127` のゲート、`authGuard.isLocked` の `MASTER_PASSWORD_ENABLED &&` ガード）の挙動が一切変わらない（`storage-security.test.ts:455-467` が引き続き緑）
- [ ] `src/utils/storage/encryptionSession.ts` / `src/background/SessionAlarmService.ts` の VULN-017 注釈が実挙動に更新される（現状 `:157-159` は「通知を 3 回リトライして暗号セッションにロックシグナルが届くことを保証する」前提だが、宛先と成功判定のどちらもそれを保証していない）。MV3 のプラットフォーム事実（送信者自身には届かない）を `privacyConsent.ts:310-314` と同じ形で注釈に残す

## テスト戦略

- **単体**: node-env vitest + 既存 chrome mock。unlock 状態（`cachedMasterPassword` あり・`cachedEncryptionKey` null）を再現し、`storage.local` に `IS_LOCKED=true` を立てて `getOrCreateEncryptionKey`（`encryptionSession.ts:566`）を呼ぶ。**現状は `IS_LOCKED` 検査が構造的にスキップされる（`:568` の `if (cachedEncryptionKey)` が false）こと**を Red として pin し、修正後は `ENCRYPTION_LOCKED` が投げられること、`isEncryptionLocked()`（`:606`）が true を返すことを確認する。加えて `SessionAlarmService` 側は `sendMessage` fake が `undefined`（解決）/`{ success: true }`/`{ success: false }` を返す 3 ケースで、成功判定が応答本文を見ることを pin（`SessionAlarmService.test.ts:167-193` の拡張）。実時間待ち禁止のルールに従い、リトライ待ちは既存の注入済み `stepDelay`（`SessionAlarmService.ts:41`）を使い、`setTimeout` の実待ちを増やさない
- **統合**: `MessageRouter` / `compositionManifest` の配線（送信先を追加する場合）。`systemHandlers.ts:219-230` の handler が `deps.lockSession()` を呼び `sendResponse({ success: true })` を返す契約を、送信側（`SessionAlarmService.ts:164`）が応答本文で受け取れる形で結ぶ。`MessageRouter.test.ts:23` の deps 差し替え流儀と `senderTrustCoverage.test.ts:45` の `extension-only` 信頼レベルを前提にする。受信者を拡張ページに足す場合は、そのページの `chrome.runtime.onMessage` リスナが `SESSION_LOCK_REQUEST` だけを受け、他の type は `undefined`（非同期なし）を返すことを pin
- **E2E**: owner 観測（隔離プロファイルで cached 状態を作り、`IS_LOCKED=true` を立て、SW fan-out が `SESSION_LOCK_REQUEST` を処理せずに解決し、コンテキストが「解錠済み」のままであることを一時ログで確認）。`findings.json` の `validation_plan.deployment` に従い、**ダミーデータのみ・破壊的操作なし**。一時ログは必ず PR で外す

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認済み。HEAD = 56f1d7c1）

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/background/alarmRegistry.ts` | **監査ref `:153-157`（`run` = `:156`）** | `check_session_timeout` の job entry。監査は `git show d49d70a3:src/background/alarmRegistry.ts` で grounding した。`run: async () => { await deps.sessionAlarmService.checkTimeout(); }` |
| `src/background/alarmRegistry.ts` | **HEAD `:176-180`（`run` = `:179`）** | 同じ entry の現在 HEAD の位置（`yasumaro-recording-resume` / `yasumaro-recording-pause-tick` の 2 件追加で +23 行）。`sessionAlarmService` の deps 宣言は `:34` |
| `src/background/SessionAlarmService.ts` | 22-27 | `SESSION_TIMEOUT_MS`（30分）/ `LOCK_NOTIFICATION_RETRY_DELAY_MS`（100）/ `LOCK_NOTIFICATION_MAX_RETRIES`（3） |
| `src/background/SessionAlarmService.ts` | 29-33 | `SendMessageFn` 型と `defaultSendMessage`（`:31` `chrome.runtime.sendMessage`）、`realStepDelay` |
| `src/background/SessionAlarmService.ts` | 36-42 | コンストラクタ。`:41` で `stepDelay` 注入（実時間待ち禁止のため必ず注入経路を使う） |
| `src/background/SessionAlarmService.ts` | 115 | `checkTimeout()` — 唯一の入口（`:110-114` に「onAlarm を足すと二重実行になる」注釈） |
| `src/background/SessionAlarmService.ts` | 125-127 / 129-135 / 136 | 未設定ユーザーの gate / 経過時間判定 / `lockSession()` 呼び出し |
| `src/background/SessionAlarmService.ts` | 153-192 | 私有 `lockSession()`。`:155` `IS_LOCKED: true` |
| `src/background/SessionAlarmService.ts` | **157-159** | VULN-017 注釈（通知の目的を明記。実挙動と食い違っている） |
| `src/background/SessionAlarmService.ts` | **160-175** | **リトライループ**。`:162` while 条件、`:164-167` 送信、**`:168` `success = true`（応答本文を捨てている）**、`:169-174` catch で `retries--` |
| `src/background/SessionAlarmService.ts` | 176-183 | 3 回失敗時のログ。最後の防御線が `IS_LOCKED` 検査であると明記 |
| `src/background/handlers/systemHandlers.ts` | 219-230 | `createSessionLockRequestHandler`。`:227` `await deps.lockSession()`、`:228` `sendResponse({ success: true })` |
| `src/background/handlers/systemHandlers.ts` | 51 | `SessionLockRequestHandlerDeps.lockSession` |
| `src/background/handlers/MessageRouter.ts` | 140 / **226** | deps 型 / `SESSION_LOCK_REQUEST: createSessionLockRequestHandler({ lockSession: deps.lockSession })`（**リポジトリ唯一の handler**） |
| `src/background/service-worker.ts` | 153 / 226 | `handleSessionLockRequest` のエクスポート / `chrome.runtime.onMessage.addListener(createMessageHandler())`（**送信元と同じ SW。`:310-314` の privacyConsent 注釈にある通り、自分宛ての send は届かない**） |
| `src/background/compositionManifest.ts` | 42 / 202 / **267** | `lockSession` の import / `factory: () => new SessionAlarmService()` / `lockSession: () => lockSession()` |
| `src/offscreen/offscreen.ts` | 62-69 / 165 | `handleOffscreenMessage`。**`:67` `!('target' in message)` で即 `return false`**（送信側 envelope に `target` が無いので常に false）/ リスナ登録 |
| `src/dashboard/aiTestProgressClient.ts` | 59-85 | `subscribeAiTestProgress`。`:69` `sender.id` チェック、`:70` `isAiTestProgressMessage(message) && runId` 一致で絞り込み。`SESSION_LOCK_REQUEST` はここを通らない |
| `src/utils/storage/encryptionSession.ts` | 68 / 75-76 | `authGuard.isLocked` の import / `cachedEncryptionKey`・`cachedMasterPassword` の module state |
| `src/utils/storage/encryptionSession.ts` | 158-174 | `deriveKeyFromMasterPassword`。`:162-164` `!cachedMasterPassword` で throw、`:173` `cachedMasterPassword` から PBKDF2 導出 |
| `src/utils/storage/encryptionSession.ts` | **566-591** | `getOrCreateEncryptionKey`。`:567` VULN-017 注釈、**`:568` `if (cachedEncryptionKey)` の中にだけ `:569` `authGuardIsLocked()` が居る**、`:570-572` クリア＋throw、`:578-588` は `IS_LOCKED` を読まない |
| `src/utils/storage/encryptionSession.ts` | **606-609** | `isEncryptionLocked()` — `!cachedMasterPassword` のみを見るので、`cachedMasterPassword` 残存状態では false |
| `src/utils/storage/encryptionSession.ts` | 619-650 | `setMasterPassword`。`:635` `cachedMasterPassword = null`、`:639` `cachedEncryptionKey = null`（ロック状態で開始する意図） |
| `src/utils/storage/encryptionSession.ts` | 657-715 | `unlockWithPassword`。**`:706` `cachedMasterPassword = password` / `:707` `cachedEncryptionKey = null`** / `:708` `IS_LOCKED: false`（← 残存状態の発生源） |
| `src/utils/storage/encryptionSession.ts` | 732-774 | `verifyMasterPasswordWithRehash`（ダッシュボード認証モーダル本体）。`cachedMasterPassword` を触らない（検証のみ） |
| `src/utils/storage/encryptionSession.ts` | 779-783 | `lockSession()` — 両キャッシュを null にして `IS_LOCKED: true` |
| `src/utils/storage/encryptionSession.ts` | 795-815 | `changeMasterPassword`。`:797` `unlockWithPassword(old)`、**`:811-812` `cachedMasterPassword = newPassword` / `cachedEncryptionKey = null`**（← もう 1 つの残存状態の発生源） |
| `src/utils/storage/authGuard.ts` | 10-18 | `isLocked()`。`:17` `MASTER_PASSWORD_ENABLED && IS_LOCKED`（**dead fan-out を生き延び唯一の cross-context 強制**） |
| `src/utils/storage/encryptionLockedError.ts` | 17 | `isEncryptionLockedError`（UI 側が拾う識別子） |
| `src/messaging/types.ts` | 323 / 376-381 | `SESSION_LOCK_REQUEST` の応答型 `{ success: true }` / `sendFromPopup` |
| `src/messaging/messageTypeRegistry.ts` | 39 / 74 | service-worker 宛て型 / `NO_PAYLOAD_TYPES` |
| `src/content/extractor.ts` | 164 | content script 側の onMessage（extension ページ文脈ではない。参考） |
| `src/utils/storage/privacyConsent.ts` | 310-314 / 319-341 | **「送信者自身には届かない」プラットフォーム事実の既存の記述**（`subscribeConsentChanges` が runtime メッセージと same-document イベントを併用する理由） |

### 最小変更の選択肢

1. **fan-out の宛先を「実際に handler を持つコンテキスト」に修正する** — 拡張ページ（dashboard / popup）に `SESSION_LOCK_REQUEST` 用の `chrome.runtime.onMessage` リスナを足す。受信側が `encryptionSession.lockSession()` を呼ぶので「宛先=all contexts」の意味が実際に成立する。あるいは SW 内の直接呼び出し（`SessionAlarmService.ts:164` の送信を `encryptionSession.lockSession()` の直接呼び出しに置き換え、`SESSION_LOCK_REQUEST` は「手動ロック用」に残す）へ置き換える。**ノイズ：受信者は「ページが開いている間だけ」しか存在しないので、開いていないコンテキストは依然として解錠状態で残る。保証できるのは「開いているコンテキスト」だけ。**
2. **リトライループの成功判定を「応答値を検証する」に改める**（`SessionAlarmService.ts:168`） — `src/messaging/types.ts:323` の応答型 `{ success: true }` を見て判定する。**これだけでは「受け手がゼロ」の場合は依然として無音**（findings の指摘どおり、リトライは受信者がゼロのときしか発火せず、そこで決して成功しない）。単独では**不十分**。
3. **消費側（`getOrCreateEncryptionKey`）の `IS_LOCKED` 検査を `cachedEncryptionKey` 非 null に限定しない**（`encryptionSession.ts:568`） — 検査を `getOrCreateEncryptionKey` の先頭（キャッシュの有無に依存しない位置）へ移動すれば、**どのコンテキストでも、どのキャッシュ状態でも、ロック済みの次の暗号操作は必ず `ENCRYPTION_LOCKED` で止まる**。fan-out が死んでいても「context の鍵が使える」状態は再現しなくなる。変更は 1 ファイル内の条件式移動 + テスト期待値の更新で済み、受信者のライフサイクル（ページの開閉）に依存しない。

**どれが「最小で確実か」**: **選択肢 3 を必須、選択肢 1 と 2 は推奨**。

- **選択肢 3 だけを実装する**のが最小で確実な修正。理由は 3 点: (a) 変更が単一ファイルに閉じており、fan-out の受信者が発見できない問題（プラットフォーム依存・ブロッカー 2 が未確定）に依存しない。(b) 保証が「状態」ではなく「sink の検査」に落ちるため、通知が届かなくても・届くべきコンテキストが閉じていても同じ結果になる。(c) fan-out の宛先を足すと `privacyConsent.ts:325-332` と同種の「ページが生きている間だけ購読」という前提が 1 つ増え、テストとライフサイクルの複雑度の増分が本件の価値（Reach=50、Impact=0.5）に見合わない。
- **選択肢 2 は選択肢 3 と併せて入れるのが妥当**（`:168` の 1 行変更＋応答型を見ないによる「無音」の解消）。単独で「緊急度を上げる」効果はない。
- **選択肢 1 は「開いているコンテキストを能動的にロックする」UX 要件として別 PBI 相当**。「ダッシュボードを開いたままロックしたら、そのタブのパスワード入力を求める」という UI 挙動（副作用 🔴）を伴うため、本 PBI の実装中に勝手に混ぜない。TODO として `pbi/00-INDEX.md` に残す。
- **選択肢 3 の実装上の注意点**: `authGuard.isLocked` を `getOrCreateEncryptionKey` の先頭で呼ぶと、`MASTER_PASSWORD_ENABLED` 未設定ユーザーにも 1 回 storage 読みが増える（`SessionAlarmService.ts:125-127` の注釈が参照している「未設定ユーザーの IS_LOCKED は無意味」という guard なので**挙動は変わらないが、`storage-security.test.ts:455-467` が「`IS_LOCKED: true` でも鍵を返す」ことを pin している以上、そのケースでは `MASTER_PASSWORD_ENABLED` が false なので依然 true を返す**）。また `rotateToNewMasterPassword`（`:629` / `:805` から `getOrCreateEncryptionKey` を `resolvePrevious` として呼ぶ経路）がロック中に走ると失敗しうるため、**「回転中は IS_LOCKED を無視する」ガードが既存コードにあるか**を実装前に確認すること（`withRotationLock` / `isMasterPasswordRotationInProgress` が該当する可能性がある）。

### ブロッカー（着手前に潰すべき owner 確認）

1. **MV3 service worker の `chrome.runtime.sendMessage` が自分自身の `onMessage` を起動しない**というプラットフォーム事実。`privacyConsent.ts:310-314` に同一事実の既存の記述があるため一次証拠はあるが、`findings.json.blockers[0]` は「source-only 実行ポリシーで bounded な観測が確立できていない」と明記している。**隔離プロファイルで観測すること**（監査の記載どおり、サンドボックスの拡張実行は不可）。
2. **resolve/reject の挙動**。「拡張ページにリスナが存在するが応答しない」場合、`sendMessage` は reject するのか resolve するのか。これで `SessionAlarmService.ts:168` の「解決 = 成功」が「無音で 1 回目成功」なのか「3 回全部 retry して失敗ログが出る」のかが変わる。**選択肢 2 の成否を左右する**ため、選択肢 3 と併せて実装する場合は選択肢 2 の判定ロジックをこの観測結果に合わせて決める。
3. **手動ロック経路の現況**（上記「監査側の blocker 3」）。UI から `SESSION_LOCK_REQUEST` を送る producer が存在しない場合、BDD シナリオ 2 は「将来この経路を再構築したときの不変条件」として pin する。**既存実装の挙動として pin してはいけない**（pin すると fan-out 修正のたびに壊れる）。
4. **「Rotation 中の IS_LOCKED 無視」ガードの存在確認**（上記選択肢 3 の注意点）。ここを放置すると `changeMasterPassword` の回転経路が、ロック中でも新しいパスワードをそのまま使って鍵を導出してしまう壊れ方をしうる。

### ロールバック手順

1. 本修正は `src/utils/storage/encryptionSession.ts` の `getOrCreateEncryptionKey` 条件式と、`src/background/SessionAlarmService.ts` の送信/成功判定という**限定的な差分**にする。UI/i18n の追加が要らない設計（選択肢 3 のみ）を推奨し、そうすれば `git revert <commit>` 1 コマンドで戻せる。
2. fan-out 宛先（選択肢 1）を追加した場合は、**追加した `chrome.runtime.onMessage` リスナは戻り値の cleanup を必ず持つ**こと（`subscribeAiTestProgress` と同じ unsubscribe 契約、`aiTestProgressClient.ts:81-84`）。revert しても Chrome には再読込まで古いリスナが残るため、**revert 後は拡張機能の再読込が必要**である旨を PR に書く。
3. ロック挙動が変わるため、**revert も同じくらい「危険側の変更」**である旨を PR に明記する（自動ロックが事実上働かなくなる構成に戻すことになる）。ロールバックの判断基準を PR に書くこと。
4. 検証済みの Red テスト（選択肢 3 の構造的スキップを pin したもの）は **revert 時も残さない**こと。戻すと将来の同種退行を再検出できなくなるため、テストだけ戻して実装だけ戻さない運用は禁止。

## 見積もり

**2.5 SP（人週 4 日）**（🟡中）。内訳: ブロッカー 1-4 の owner 確認（各 0.5-1 時間）→ 選択肢 3 の実装（1-2 時間。条件式の移動と `authGuard.isLocked` 呼び出し位置の設計を含む）→ 選択肢 2 の成功判定修正（0.5-1 時間。ブロッカー 2 の観測結果に依存）→ BDD シナリオ 1-5 の Red-first テスト（3-5 時間。`storage-security.test.ts` / `encryptionSession-branch.test.ts` / `SessionAlarmService.test.ts` の期待値書き換えを含む）→ `npm run validate` と owner による UI 確認（2 時間）。ブロッカー 1/2 の owner 観測に時間がかかり、かつ fan-out の実装修正（選択肢 1）が別 PBI に分岐するため、1 スプリントに収まる範囲に留まる。選択肢 1 を本 PBI に含める場合は +2 SP。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（シナリオ 1-4 は Red-first で、シナリオ 5 は受信者が存在する場合の契約として pin。シナリオ 3 は「無音の success がない」ことを観測可能な形で pin）
- [ ] `npm run validate` が緑（type-check + テスト）
- [ ] 監査 fingerprint を完了記録に残す（`session-auto-lock:fanout-no-receiver-response-discarded`）
- [ ] コードレビュー完了（owner の UI 確認結果をレビュー記録に添付）
- [ ] ドキュメント更新済み（`SessionAlarmService.ts` の VULN-017 注釈（`:157-159`）を実挙動に合わせる。MV3 のプラットフォーム事実（送信者自身には届かない）を `privacyConsent.ts:310-314` と同じ形で `SessionAlarmService` / `encryptionSession` 側にも注釈として残す）
- [ ] ブロッカー 1-4 の owner 確認結果が PR に記録されている（`findings.json` の `validation_plan` に従った隔離プロファイル観測。ダミーデータのみ）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現 + 仕様確定）
- 決め手: `unlockWithPassword()` 成功後（cachedMasterPassword あり・cachedEncryptionKey null）に `IS_LOCKED=true` を立てて `getOrCreateEncryptionKey()` を呼ぶと **鍵が導出され（`derivedKeyReturned:true`）、`ENCRYPTION_LOCKED` は不発、`isEncryptionLocked()` は false**。IS_LOCKED 検査が cachedEncryptionKey 非 null のときしか走らない構造を実証。加えて Chrome docs により「送信者自身のフレームには配送されない」「リスナあり無応答は null で resolve」が確定し、fan-out が成功と誤判定する機構も説明できた
- 影響: 選択肢 3（消費側の検査をキャッシュ非依存にする）が単一ファイルで確実な最小修正であることが裏付けられた

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/archived/pbi/2026-10-07-09-refactor-sessionalarm-injectable-sleep.md` — `stepDelay` 注入の経緯（本 PBI のリトライ変更の前提を持つ）
- `dev-docs/archived/pbi/2026-10-01-08-fix-alarm-double-dispatch.md` — `checkTimeout()` が唯一の入口である契約の由来
- ストレージ/鍵管理の領域として PBI 15（`2026-10-18-15-fix-hmac-kek-fail-open.md`、hmac kek fail-open）と併せて設計する。両者は同じ `encryptionSession.ts` の module state（`cachedEncryptionKey` / `cachedMasterPassword`）を触り、ロック状態の判定 (`IS_LOCKED`) を共有する。**PBI 15 と並行実装する場合は、順序と touch する行の競合を PR で明示すること**
- `src/utils/storage/authGuard.ts` — 本 PBI が「唯一の cross-context 強制」として依存する seam
