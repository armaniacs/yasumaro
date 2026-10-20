# PBI: PII サニタイザのサイズゲート（65536 code units）超過時にロガー sink が原文を永続化する非対称を修正する

## ユーザーストーリー

拡張機能の開発者・保守担当者として、診断ログに入り込む「同一のメールアドレスが 65,536 文字以下ならマスクされ、超えると原文のまま保存される」という非対称を解消してほしい、なぜならこれは PII サニタイザが ReDoS 対策として持つサイズゲートの**意図せざる副作用**であり、`chrome.storage.local` に 3 日間・500 件保持される診断ログが「マスク保証の穴」になることで、ログを読む将来の保守者が `user@example.com` を平文で見る余地が有一天でも早く閉じるべきだから。

もう少し具体的に言えば、`https://attacker.example/?email=user@example.com&pad=<65000文字>` のような長い URL を 1 ページ記録しただけで、パイプラインの保存テイル（`savePhase.ts:94`）がその URL を `addLog` の details に載せるため、監査ログに個人の識別子が原文で残る。バグ報告ビルダーが現状エラーコード数しか送らないため流出面は限定的だが、これは「流入が起きていない」ためではない――**デバッグログを読む人間（開発者自身）が 3 日以内に storage を直接見る**だけで露見する経路が残っている。

## 優先度

- 順位: 11 / 25
- RICE: 1500（Reach=300 / Impact=1 / Confidence=100% / Effort=0.2）
- 根拠 / 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `pii-mask:logger-sinks-keep-original-above-size-gate`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` の `root[20]` および `NEEDS-VALIDATION.md` 18番）。

### 何が起きているか

`sanitizeRegex` のサイズゲートは、65,536 code units を超えた入力に対して**原文をそのまま**返し、`maskedItems` は空配列、`error` だけを立てて返している（`src/utils/piiSanitizer.ts:222-230`）。これは「マスキングを無効化する」のであって「マスキングを省略する」のではない。そしてロガー側の 3 つの sink は**すべて `maskedItems.length > 0` しか見ておらず、`result.error` を一度も読まない**ため、ゲートを超えた文字列は原文のまま `addLog` に渡され、`chrome.storage.local['sanitization_logs']` に永続化される。

到達可能な carrier は**長さ無制限の recording `payload.url`** である。`assertHttpUrl`（`src/messaging/validators.ts:59-75`）は非空・http(s)・parseable しか見ず、同一バリデータ内の `content`（`VALIDATOR_LIMITS.MAX_CONTENT_LENGTH`）や `title`（`VALIDATOR_LIMITS.MAX_TITLE_LENGTH`）に長さ制限があるにもかかわらず、`url` には何の制限もない。

### 非対称（本件の核心）

同じ `user@example.com` が**どこにあるかだけ**で結果が変わる:

| 位置 | `maskedItems` | `error` | sink の分岐 | 永続化される文字列 |
|---|---|---|---|---|
| URL 全体が 65,536 以下 | 1 件 | なし | `> 0` → true | `[MASKED:email]` |
| URL 全体が 65,537 以上 | 0 件 | あり | `> 0` → **false** | **原文 `user@example.com`** |

この非対称は「ゲートは不可避の性能上の制約」ではない。ゲートが要求しているのは「ReDoS を起こさないこと」だけであり、**マスクを捨てることではない**。

### なぜ流出面が限定的と判定されたか

`chrome.storage.local['sanitization_logs']`（`src/utils/logger/storageAdapter.ts:4-6`、3 日保持・500 件上限）の**唯一の production reader** は GitHub バグ報告ビルダーで、`summarizeErrorCodes`（`src/dashboard/panels/diagnostic/issueReportLink.ts:21-33`）は `log.errorCode` の名前と件数だけを集計し、本文 `:59` の `Recent error codes:` 行に填めるだけで、`message` も `details` も送らない。エクスポート・sync の経路も存在しない。つまり漏出を観測するには DevTools レベルの storage 直接閲覧、または将来の「ログ Surfacing reader」が必要になる――これは「流入が発生している」ことの軽減であって、排除ではない。

### 影響の輪郭

- 到達可能な chain: `recordingHandlers.ts:212`（ingress、insecure scheme 拒否パスで raw `payload.url` を `addLog` details に載せる）→ `savePhase.ts:94`（SQLite 保存成功時に `{ url: context.data.url, title }` を `addLog`）→ sibling step sinks（`checkPrivacyHeadersStep.ts` / `checkPermissionStep.ts` / `checkTrustDomainStep.ts` / `checkDuplicateStep.ts` / `saveToObsidianStep.ts` / `saveMetadataStep.ts` / `saveLocalMarkdownStep.ts` / `extractSentencesStep.ts` が同じ URL 文字列をログ）→ `core.ts:107-110` → `sanitize.ts:85-91` → `storageAdapter.ts:41-43`。
- 同じ引数を `addLog` に渡した影響を受けるのは storage 経路だけではない。OS 通知経路（`api.ts:173-175`、chrome.storage を経由しない別経路）も同じ `maskedItems.length > 0` 判定を持つため、**通知の本文にも原文が載る**。
- 一方 `LOG_FORWARD`（`systemHandlers.ts:309-312`）は転送メッセージをちょうど 65,536 char に slice するため message 経路はゲートに到達しない。ただし details プレビュー分岐（`:313-318`）は `MAX_LOG_FORWARD_SERIALIZED_CHARS` = 262,144 char まで運ぶため、ここは別論点として扱う（本 PBI のスコープ外）。

## BDD受け入れシナリオ

```gherkin
Scenario: サイズゲートを超えた URL のメールアドレスは永続化ログに原文で残らない
  Given 診断ログが in-memory wiring で接続された状態で、
        query に user@example.com を含む 70000 文字の URL
        （https://attacker.example/?email=user@example.com&pad=...）がある
  When  その URL を addLog の details に渡して記録し、flush して永続化されるまで待つ
  Then 永続化されたエントリの details に user@example.com が現れない
  And 代わりにマスク表現（[MASKED:email]）または切り詰めマーカー付き短縮文字列が入っている
  # 注意: 現行実装では RED になる。サイズゲートが原文を返し maskedItems が空のため
  # sink は else 分岐（sanitize.ts:90 / core.ts:108）に入り原文が保存される。
  # これが本 PBI の存在意義であり、GREEN へ変えることが受入基準。

Scenario: ゲート以下の同種 URL は従来どおりマスクされ、挙動が変わらない
  Given query に user@example.com を含む 65000 文字以下の URL がある
  When  その URL を addLog の details に渡して記録し、flush して永続化されるまで待つ
  Then 永続化されたエントリの details に user@example.com は現れず [MASKED:email] が入る
  And 長さ情報の表記（末尾マーカー等）は従来と同一である
  # 注意: このシナリオは現行実装で GREEN であり、修正による退行がないことの対照。

Scenario: ゲート境界の連続性が保たれる
  Given 同じメールアドレスを含む文字列が、長さ 65535 / 65536 / 65537 / 65538 の 4 種ある
  When  それぞれを addLog の details に渡して記録し、flush して永続化されるまで待つ
  Then 4 件すべてに user@example.com は現れない
  And 65537 以上の 2 件だけ「マスク or 切り詰め」を示す扱いになる
  And 65536 以下の 2 件は純粋なマスク結果（切り詰めマーカーなし）である

Scenario: OS 通知経路も同じ扱いになる
  Given 通知 sink（chrome.storage を経由しない）が差し込まれた状態で、
        user@example.com を含む 70000 文字の URL がある
  When  logCritical 相当の通知をその URL 付きで起こす
  Then 通知本文に user@example.com が現れない
  # 注意: 現行実装（api.ts:174）も maskedItems.length > 0 しか見ないため RED。

Scenario: 既存ピンの整合性（sanitizeRegex の戻り値契約が意図どおりであること）
  Given sanitizeRegex に 65537 文字のテキストを渡す
  Then error が設定されている
  And error が設定された倍以上では、結果が「原文そのまま」ではない
  # 注意: piiSanitizer-optimization.test.ts:170-178 は error 定義と maskedItems 0 件を
  # 固定しているが result.text の内容は固定していない。
  # sanitizeRegex 本体を触る選択肢 2 を採る場合は、この expectation の
  # 妥当性（maskedItems をゲート超過でも埋めるのか、error で表現するのか）を
  # 実装前に決めておくこと。expectation を「場当たりで緩める」ことは禁止。
```

## 受け入れ基準

- [x] `src/utils/logger/sanitize.ts:86-91`（および配列枝 `:135-140`）が `maskedItems.length > 0` のみで分岐せず、`result.error` を判定材料に含んでいる。サイズゲート超過時は**マスクせず切り詰めた値**（既存の `truncateForLog` を流用）を保存する
- [x] `src/utils/logger/core.ts:107-109` の message 経路が同様に `sanitizedMessage.error` を判定材料に含み、ゲート超過時に原文を保存しない
- [x] `src/utils/logger/api.ts:173-175` の OS 通知経路も同じ扱いとなり、通知本文にゲート超過の原文が載らない（storage 経路と通知経路が乖離しない）
- [x] 上記 BDD Scenario 1〜4 が自動テストとして実装されパスしている。Scenario 2（ゲート以下・従来挙動の不変）が対照として必ず同居している
- [x] 切り詰めが発生した場合はログ上でそれが分かる（既存 `LOG_TRUNCATION_MARKER` 相当のマーカー、または `error` 由来のフィールド）―「黙って短くなった」状態にしない。`src/utils/logTruncate.ts:15` のマーカー規約を再利用すること
- [x] `MAX_INPUT_SIZE = 65536`（`src/utils/piiSanitizer.ts:15` ← `src/utils/limits.ts:81`）自体を変更していない。gate の値を変える場合は `src/utils/__tests__/limits-drift.test.ts` と併せてレビューする
- [x] 既存テスト `src/utils/__tests__/piiSanitizer-optimization.test.ts:170-178`（`error` 定義・`maskedItems` 0 件を固定）と矛盾しない。矛盾する場合は expectation を緩めるのではなく**意図を明記したうえで**書き換える
- [x] 「ログを詳細に残したい（診断価値）」という運用上の意図と「PII を残さない」をどちらを優先したかが、コード中コメントと本 PBI の完了記録に明記されている（下記「どちらを優先するか」の節を参照）。`npm run validate` が緑

## テスト戦略

### 単体

in-memory ロガー配線（`src/utils/logger/core.ts:49-51` の `initLogger(next: LoggerWiring)` + `resetLoggerWiring()`。`storage: LogStorageAdapter` / `scheduler: LogFlushScheduler` を注入する既存パターン）に `addLog('INFO', msg, { url })` を渡し、`flushLogs(true)` 後に `getLogs()` で **永続化されるエントリ**（disc 相当の storage adapter の中身）を assert する。**buffer を peek しただけでは検証にならない** ― sink のバグは「保存された値」であって「渡した値」ではないため。

- 主検証: `{ url: 'https://e.test/?email=user@example.com&pad=' + 'a'.repeat(70000) }` を渡す → `logs[0].details.url` に `user@example.com` が含まれないこと（現状は含まれるため RED）
- 対照（同テストファイル内に置く）: 同じ URL を 65,000 文字に詰めたもの → `[MASKED:email]` が入り、それ以外の挙動が従来と同一であること
- 境界: 65,535 / 65,536 / 65,537 / 65,538 の 4 種。`validateInputSize` は `text.length > MAX_INPUT_SIZE`（`piiSanitizer.ts:169`）なので 65,536 は通過・65,537 で拒否という境界であることに注意
- 配列要素にも同じゲートが効く（`sanitize.ts:135-140`）ため、`details: { urls: [longUrl] }` でも 1 件 GREEN 化すること
- 通知経路: `api.ts` の `sink.raise` をモックして引数を capture し、`notificationMessage` に原文が含まれないことを assert

### 統合

`logger/sanitize.ts` → `logger/storageAdapter.ts` の永続化経路を通し、`chrome.storage.local` を契約忠実なモックに差し替えたうえで `sanitization_logs` の**キー値そのもの**に `user@example.com` が含まれないことを確認する。3 日保持・500 件上限（`storageAdapter.ts:4-6`）の prune 処理（`:41-42`）は本 PBI の変更対象外だが、同じテストファイル内で回帰しないことを確認する。

### E2E

owner 観測（テストプロファイル・ライブターゲットへの probe ではない）: 隔離 Chromium プロファイルに unpacked 拡張を読み込み、クエリにメールアドレスを含む 65,536 文字超の http(s) URL を含むページを 1 回記録 → DevTools の `chrome.storage.local['sanitization_logs']` を確認し、メールアドレスが平文で残っていないことを観測する。65,536 文字以下の同種 URL を対照として再実行する。**この観測は blockers の解決そのものであり、修正前後のどちらだったかを必ず記録すること**（下記の「着手前に潰すべき owner 確認」と対）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/utils/piiSanitizer.ts` | 15 | `MAX_INPUT_SIZE = MAX_PII_INPUT_SIZE`（`src/utils/limits.ts:81` = `64 * 1024` = 65,536） |
| `src/utils/piiSanitizer.ts` | 164-177 | `validateInputSize` ― `:169` で `text.length > MAX_INPUT_SIZE` を判定し `error` を立てる |
| `src/utils/piiSanitizer.ts` | 222-230 | **サイズゲート本体**。`{ text（原文）, maskedItems: [], error }` を返す |
| `src/utils/piiSanitizer.ts` | 18, 233-238 | `MAX_SKIP_SIZE = 512 * 1024`。`skipSizeLimit: true` でも 512KB 超は同じく原文＋error |
| `src/utils/logger/sanitize.ts` | 85 | `const result = await sanitizeRegex(value)` |
| `src/utils/logger/sanitize.ts` | 86-91 | **sink #1**。`:86` が `maskedItems.length > 0` のみで分岐。`:90` の else が `neutralizeLogText(value)` = **原文**。`result.error` は読まれない |
| `src/utils/logger/sanitize.ts` | 135-140 | sink #1 の配列枝。`:136` と同じ判定、`:139` が原文 |
| `src/utils/logger/core.ts` | 99 | `const sanitizedMessage = await sanitizeRegex(message)` |
| `src/utils/logger/core.ts` | 107-109 | **sink #2**。`sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message` → ゲート超過時は `message`（原文） |
| `src/utils/logger/core.ts` | 110 | `details: await sanitizeLogDetails(restDetails)` ― sink #1 へ渡す |
| `src/utils/logger/api.ts` | 173-175 | **sink #3**（OS 通知）。`:174` も同じ `maskedItems.length > 0` 判定。`details` は生で `sink.raise` に渡される（`:175`） |
| `src/utils/logger/storageAdapter.ts` | 4-6 | `LOG_STORAGE_KEY = 'sanitization_logs'` / `RETENTION_DAYS = 3` / `MAX_LOGS = 500` |
| `src/utils/logger/storageAdapter.ts` | 41-43 | prune（3 日）・500 件上限・`chrome.storage.local.set` |
| `src/messaging/validators.ts` | 59-75 | `assertHttpUrl` ― 非空・http(s)・parseable のみ。**URL の長さ制限なし** |
| `src/messaging/validators.ts` | 78-81 | 同じバリデータ内の `content` 長さ制限（`VALIDATOR_LIMITS.MAX_CONTENT_LENGTH`）― URL と非対称的 |
| `src/messaging/validators.ts` | 594-595, 636-637 | `title` の長さ制限（`VALIDATOR_LIMITS.MAX_TITLE_LENGTH`）― URL と非対称的 |
| `src/dashboard/panels/diagnostic/issueReportLink.ts` | 21-33 | `summarizeErrorCodes` ― `errorCode` の名前と件数のみ。本文は送らない |
| `src/dashboard/panels/diagnostic/issueReportLink.ts` | 59 | バグ報告ボディの `Recent error codes:` 行 |
| `src/dashboard/panels/diagnostic/issueReportLink.ts` | 183 | 唯一の production reader（`getLogs()`） |
| `src/background/handlers/systemHandlers.ts` | 309-312 | `LOG_FORWARD` の message を `MAX_LOG_FORWARD_MESSAGE_CHARS`（= 65,536、`limits.ts:73`）へ slice ― message 経路はゲートに到達しない |
| `src/background/handlers/systemHandlers.ts` | 313-318 | details プレビューは `MAX_LOG_FORWARD_SERIALIZED_CHARS`（= 262,144、`limits.ts:75`）まで運ぶ（本 PBI のスコープ外） |
| `src/background/pipeline/savePhase.ts` | 94 | `addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title, traceId })` ― 実際の carrier |
| `src/background/handlers/recordingHandlers.ts` | 211-213 | insecure scheme 拒否パスで raw `payload.url` を `addLog` details に載せる |
| `src/utils/logTruncate.ts` | 12, 15, 17-21 | **再利用候補**。`MAX_LOG_BODY_CHARS = 500` / `LOG_TRUNCATION_MARKER = '…(truncated)'` / `truncateForLog(body, maxChars)` |
| `src/utils/__tests__/piiSanitizer-optimization.test.ts` | 159-168 | 既存ピン。ちょうど 65,536 文字はマスクされる（`toContain('[MASKED:email]')`） |
| `src/utils/__tests__/piiSanitizer-optimization.test.ts` | 170-178 | 既存ピン。65,537 で `error` 定義 + `maskedItems` 0 件。**`result.text` の内容は固定していない** |
| `src/utils/logger/core.ts` | 32-35, 49-59 | `LoggerWiring` 型・`initLogger()`・`resetLoggerWiring()`（in-memory 配線の注入点） |
| `src/utils/__tests__/limits-drift.test.ts` | 21-22 | forward 系リミットのパターンを固定。LIMIT 値を変更する場合はこのテストの更新対象 |

### 最小変更の選択肢

**選択肢 1（推奨・fail-safe 側）: 3 つの sink が `result.error` を読む**

`sanitize.ts:86` と `core.ts:107`・`api.ts:174` の三項条件に `error` を掛け、`maskedItems.length > 0 || !result.error` のときだけマスク結果を使い、そうでなければ `truncateForLog(result.text)` を使う。あるいは分岐を 3 段（masked / error→truncate / それ以外）に明示的にする。

-  Pros: sink 側の契約変更だけで済み、`sanitizeRegex` の戻り値契約（`SanitizeResult`）を変えない。**既存の `piiSanitizer-optimization.test.ts:170-178` がそのまま通る**。ReDoS 防御（gate そのもの）にも触らないため性能特性が不変。
-  Cons: 「gate 超過を sink だけが知っている」なので、`sanitizeRegex` の別の呼び出し元（logger 以外の PII 経路）が同じ罠を踏む可能性が残る。**他の呼び出し元を洗い出して同じ扱いになっているか確認すること**（`grep -rn "sanitizeRegex" src/`）。

**選択肢 2: `sanitizeRegex` の size gate 超過時に「切り詰めた上でマスクする」外套を追加**

`piiSanitizer.ts:222-230` の return を `text: truncateForLog(text, MAX_INPUT_SIZE)` のような形に書き換え、gate 超過でも末尾付近までマスクを走らせる（あるいは切り詰め結果にマスクを適用）。

-  Pros: 呼び出し元が全部自動的に安全になる。1 箇所の変更で 3 sink が同時に直る。
-  Cons: **`sanitizeRegex` の戻り値契約が変わる**ため、`error` を「失敗の印」として読んでいる既存コード（今回は logger 3 箇所の可能性が高いが、他にもあるかも）を洗い出す作業が発生する。また gate 超過を「成功」と見なす緊密な結合は、ReDoS 防御（gate 本体）のセマンティクスを弱める。**また `piiSanitizer-optimization.test.ts:170-178` の `maskedItems` 0 件 expectation と矛盾しうる**ため、expectation を緩めるのではなく「gate 超過は成功ではなく切り詰め成功」という新しい契約を明示的に定義する必要がある。

**選択肢 3: `assertHttpUrl` に URL 長上限（他フィールドと同様の扱い）を設けて、到達可能な carrier を断つ**

`validators.ts:59-75` に `MAX_URL_LENGTH` 等の上限を足し、`assertContentLength`（`:78-81`）と同じ形で `ValidationError` を投げる。

-  Pros: 不正入力を入口で止めるため、ログ・保存・AI 送信のいずれにも原文が届かない。**他の 3 経路（storage / 通知 / 既存ログ）に対する影響がゼロ**で、影響範囲が小さい修正。
-  Cons: 単に carrier を 1 つ塞ぐだけで、**同じ size gate の罠は他の無制限長文字列（ details の他フィールド、array 要素）に残る**。また URL 長さ制限はユーザー可視の挙動変化（長い URL の記録が失敗する）になるため UX レビューが要る。**単独で本 PBI を完了扱いにしないこと**（ Vuln 修正ではなく攻撃面の縮減）。

**推奨**: 選択肢 1 を本 PBI の実装範囲とし、選択肢 3 を併せて検討する（入口側の防御として）。選択肢 2 は契約変更が大きいため、必要なら別 PBI とする。

### 「ログを残したい」と「PII を残さない」のどちらを優先するか（必須の明記事項）

本件は技術的に閉じていても**運用上の価値判断**が未決である。決定をコード中コメントと PBI の完了記録の両方に残すこと。

- **PII を残さない を優先する場合（推奨）**: ゲート超過は切り詰め（`truncateForLog`）で短縮して保存する。**診断上の損失は「長大すぎる文字列の末尾」が見えないことだけ**であり、URL の冒頭・ホスト名・エラーコード・タイムスタンプは残る。メールアドレス・クレジットカード番号のような**高価値 PII は冒頭に集中しがち**であり、これは切り詰めでも大半が除去できる。→ **診断実害は限定的**であり、PII を残さない選択のコストは小さい。
- **ログを完全に残したい場合**: 上限を上げて gate 自体を緩める（例: `MAX_INPUT_SIZE` を 1 MB へ）。ただしこれは ReDoS 防御の本体に触れ、`piiSanitizer-redos.test.ts` の性能 pin、`limits-drift.test.ts`、および **gate の存在理由そのもの**を再議論することになるため、本 PBI の範囲を超える。**この方向を選ぶなら別 PBI を起こすこと。**
- **中間案**: ゲート超過時だけ「切り詰めた値」＋「元は size-limit 超過であった」ことを示すフラグを保存する。 診断側はフラグから「何かが巨大だった」ことを知りつつ、PII は原文で残さない。**本 PBI はこの中間案を含意している**（受け入れ基準の「切り詰めが発生した場合はログ上でそれが分かる」）。

### 着手前に潰すべき owner 確認（ブロッカー）

本件は needs_validation 判定であり、ソースのみでは 2 点が未決である。**実装に入る前に潰すこと**:

1. **実 Chrome で 65,536 文字超の `sender.tab.url` が成立するか（primary blocker）**: Chrome のタブ URL およびメッセージパスの制限が、実際のブラウザバージョンで 65,536 code units を超える `payload.url` を許すかどうか。監査 run は source-only ポリシー（ターゲット制御の実行に対する OS sandbox 利用不可）のため観測できていない。**ソース側の chain は「長さ 65,536 超の `payload.url` が受け入れられた場合にのみ」決定的**であり、到達可能性はブラウザ挙動に依存する。
   - 観測手順: 隔離 Chromium プロファイルで、ローカルテストサーバまたは data URL 的に長い URL（65,536 文字超、query にメールアドレス含む）を開き、`sender.tab.url` の実長を DevTools で確認する。64KB 級の URL がブラウザで受理されない場合、**選択肢 3（`assertHttpUrl` に上限）が唯一の有効な carrier 遮断**となり、選択肢 1/2 の実害は「内部防御の一貫性」に留まる。
   - 観測結果次第で本 PBI の優先度（影響評価）は変わるが、**選択肢 1 の実装自体は「到達不能だから不要」とはしない**（将来 URL 制限が緩められたとき、または他の無制限長文字列が carrier になったときに再度顕在化するため）。
2. **`assertHttpUrl` に URL 長上限を追加することの UX 妥当性**: 追加する場合、記録が「失敗する URL」の出現頻度は現実的か（`SELECT * FROM` のような巨大 URL は稀か）。判断は owner（プロダクト側）が出す。**本 PBI の実装判断（選択肢 1）と UX 判断（選択肢 3）を分離し、前者を block させないこと。**

### ロールバック手順

- 変更は sink 側（`sanitize.ts` / `core.ts` / `api.ts`）の **3 箇所のみ**に切り出す。`piiSanitizer.ts` の gate 定数・`limits.ts` は触らない（選択肢 2 を採る場合を除く）。1 コミットにまとめ、他ファイルが混ざっていないことをコミット前に確認する。
- `git revert <commit>` で戻せる。戻すとコードは「原文が保存されるがテストも緑」な元に戻り、**リスクは「その logs が 3 日間だけ残る」**（データ損失ではない）ため緊急度は低い。
- Rollback 時に logger 側の既存 expectation（`sanitizeLogDetails` の戻り値、通知本文）が落ちる可能性がある。revert 後は必ず `npm run validate` を通し、**緑のまま revert できることを確認する**（revert でテストが壊れるなら、それは変更の scope が sink 3 処所以外にも及んでいる証拠）。
- Rollback 後の実運用上の注意: **既に永続化された非マスク済みエントリは残り続ける**（3 日保持・500 件上限が自然消去させる）。ロールバック時に `chrome.storage.local['sanitization_logs']` を明示的に clear する必要があるかは owner 判断（データ損失なので自動では行わない）。

## 見積もり

1pt 🟢（sink 3 箇所の条件式変更と、その回帰テスト。Effort=0.2 相当。選択肢 3 を併せると +0.5pt 程度）

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス（Scenario 1〜4。Scenario 2 の対照が同居していること）
- [x] `npm run validate` が緑
- [x] 監査 fingerprint `pii-mask:logger-sinks-keep-original-above-size-gate` を完了記録に残す
- [x] コードレビュー完了
- [x] ドキュメント更新済み（デバッグログの取り扱い方針を `SECURITY.md` / `dev-docs/SECURITY_REVIEW_GUIDE.md` に追記）
- [x] ブロッカー観測（65,536 超 `sender.tab.url` の成立可否）の結果が記録に残されている
- [x] 「PII を残さない」優先か否かの価値判断がコードコメントと完了記録に明記されている

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: 70000 文字 URL（query にメールアドレス）を `addLog` → flush 後、`chrome.storage.local['sanitization_logs']` の `details.url` に**原文メールが残存**し、`url_maskedTypes` も付かない。65000 文字では `[MASKED:email]` にマスクされる（対照成立）
- 影響: サイズゲート境界の非対称を実測で確定。3 sink のみの修正で低リスクに解消できる

## 関連

- pbi/00-INDEX.md
- 既存の切り詰めヘルパー: `src/utils/logTruncate.ts`（`MAX_LOG_BODY_CHARS = 500` / `LOG_TRUNCATION_MARKER` / `truncateForLog`）
- サイズ系リミットの SSOT: `src/utils/limits.ts:73-75, 81-82`（`MAX_LOG_FORWARD_*` / `MAX_PII_INPUT_SIZE` / `MAX_PII_OUTPUT_SIZE`）― ドリフト pin は `src/utils/__tests__/limits-drift.test.ts`
- 既存 Sink（参考・本件の変更対象外）: `src/background/handlers/systemHandlers.ts:309-318`（`LOG_FORWARD` の境界処理。message は 65,536、details preview は 262,144 まで運ぶ）
- 監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` `root[20]`, `NEEDS-VALIDATION.md` 18番）

## 完了記録（2026-10-20）

- 実装方針: 選択肢 1（3 sink が `result.error` を判定材料に含める）。`sanitizeRegex` の戻り値契約（`SanitizeResult`）・ゲート定数（`MAX_INPUT_SIZE = 65536`）・`limits.ts` は不変。
- 変更ファイル:
  - `src/utils/logger/sanitize.ts`: 3 sink 共通判定 `persistableLogText` を新設（文字列枝・配列枝から利用）。判定は「maskedItems あり → マスク結果 / error あり（マスク 0 件）→ 切り詰め＋再マスク / それ以外 → 原文」の 3 段。
  - `src/utils/logger/core.ts`: message 経路を同じ 3 段判定に統一。
  - `src/utils/logger/api.ts`: OS 通知経路を同じ 3 段判定に統一（保存経路と通知経路の乖離を解消）。
- 受入基準「マスクせず切り詰めた値」の取扱い: BDD Scenario 1/3 の Then（永続化エントリに `user@example.com` が現れない）とテスト戦略の主検証（`details.url` にメールが含まれないこと）を満たすには切り詰めだけでは不十分である。メールは URL 先頭付近（`https://attacker.example/?email=` の直後）に位置し、500 文字の切り詰めに残るため。**シナリオを優先**し、ゲート超過時は `truncateForLog` で 500 文字＋`LOG_TRUNCATION_MARKER` に境界を切った上で、境界内の残部を再マスクして保存する。
- 価値判断: **「PII を残さない」を優先した**。診断上の損失は「長大すぎる文字列の末尾」が見えないことのみで、冒頭・ホスト名・エラーコード・タイムスタンプは残る。切り詰めは `LOG_TRUNCATION_MARKER`（`src/utils/logTruncate.ts` の規約を再利用）付きで可視化し、「黙って短くなった」状態にしない。同旨をコード中コメント（`persistableLogText` の JSDoc、`core.ts`・`api.ts` の呼び出し箇所）にも明記。
- テスト: `src/utils/logger/__tests__/piiSizeGate.test.ts` を新設（6 件）。BDD Scenario 1〜4 に加え、配列枝・message 経路の固定と対照（Scenario 2: ゲート以下は従来どおり `[MASKED:email]` ＋ `url_maskedTypes`、マーカーなし）を同居。検証は storage adapter の中身（永続化後のエントリ）で行い、buffer peek は使わない。
- 監査 fingerprint: `pii-mask:logger-sinks-keep-original-above-size-gate` … 解消。
- ブロッカー観測（65,536 超 `sender.tab.url` の成立可否）: 「調査結果（2026-10-18）」に記録済み（CONFIRMED、局所再現）。70000 文字 URL が `addLog` → storage まで到達することが実測済み。実ブラウザのタブ URL 長上限の追加観測は owner タスクとして残置（PBI 記載のとおり、選択肢 1 の実装判断には影響しない）。
- 他の `sanitizeRegex` 呼び出し元（選択肢 1 の Cons の確認）: logger 外では `src/background/navTrail/navTrailTracker.ts:152`、`src/background/manualContentFetcher.ts:92`、`src/dashboard/settings/privacySettings.ts:158` が該当。いずれも診断ログの sink ではないため本 PBI のスコープ外（別 PBI 候補）。
- ドキュメント: デバッグログの取り扱い方針を `dev-docs/SECURITY_REVIEW_GUIDE.md`（Privacy Features 配下に「Diagnostic log PII handling」節）と `SECURITY.md`（Scope）に追記。
- 検証結果（2026-10-20）: 対象テスト 13 ファイル・247 件 GREEN（logger パイプライン / 3 sink / logCritical / criticalAlertSink / logTruncate / logger-seam を含む）＋ piiSanitizer 系 5 ファイル・130 件 GREEN（`piiSanitizer-optimization.test.ts:170-178` の既存ピンを含む契約不変を確認）。`npm run type-check` 成功。`npx eslint` 変更 4 ファイルで指摘 0 件。`node scripts/check-docs-chars.mjs` 成功。
- 5 Whys（連鎖の要約）: 1) なぜ原文が残るか → サイズゲート超過で `sanitizeRegex` が原文＋error を返すため。2) なぜそれが保存されるか → 3 sink が `maskedItems.length > 0` しか見ず `error` を読まないため。3) なぜ sink は error を読まないか → ゲートの戻り値契約が sink 側で fail-open に扱われてきたため。4) なぜ fail-open か → ゲートは「性能制約」であって「マスク省略」を意味しないという契約が明記されていなかったため。5) なぜ明記されていなかったか → ゲート追加時に呼び出し元のマスク保証の見直しが漏れたため。最終解: 3 sink が `error` を判定に含め、ゲート超過時は切り詰め（可視マーカー付き）＋再マスクで保存する。