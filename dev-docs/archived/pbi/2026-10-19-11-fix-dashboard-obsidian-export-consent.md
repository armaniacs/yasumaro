# PBI: ダッシュボードの「Obsidian へ追記」（append_to_obsidian）が同意ゲートを通らない問題の修正

## ユーザーストーリー

同意を撤回したユーザーとして、ダッシュボードで過去の記録を選んで Obsidian へ追記しても、撤回済みの閲覧履歴が Obsidian REST API へ出てほしくない。なぜならこの操作は `RecordingAdmission` の外側にあり、記録時の同意を引き継ぐ説明が成り立たない（記録した時点と追記する時点でユーザーの意思が変わっている）から。撤回後は、追記を実行した瞬間に同意を確認してほしい。

## 優先度

- 順位: 2026-10-19 節の 11 / 11（同日 2026-10-19 の 11 件中 11 番目。RICE 400 は 04 / 05 と同帯）
- RICE: 400（Reach=200 / Impact=3 / Confidence=100% / Effort=1.5）
  - Reach: ダッシュボードの選択追記を使う層は同意機能の母数（400）より狭いと推定し 200。到達条件は「過去に同意して記録がある」かつ「ダッシュボードで行を選んで追記する」かつ「その前に撤回した」の積
  - Impact: 3。撤回後に**保存済みの行（title / url / summary / tags）が外部（Obsidian）へ出る**。オフライン再送と同じクラスで、同意の実効性に関わる
  - Confidence: 100%。`dashboardSqlite` 配下の全ファイルと UI 経路（`sqliteHistoryModel.ts` → `dashboardSqliteService.ts`）を grep し、同意の読み出しが 1 つも無いことを確認済み
  - Effort: 1.5 SP。handler への同意 seam 追加と配線＝ 0.6 / 拒否時の応答とテスト＝ 0.6 / 監査ガイドの表の更新＝ 0.2 / confirm token の扱いの判断＝ 0.1
- 種別: 非機能追加（fix）
- 難易度: 低
- 副作用: あり（撤回中は追記が拒否される。`RecordingAdmission` の外側に 2 つ目の同意読み出し点ができるため、`dev-docs/SECURITY_REVIEW_GUIDE.md` の「ゲート読み出しは 1 点」という記述を実態に合わせて更新する必要がある）
- 根拠: `dev-docs/SECURITY_REVIEW_GUIDE.md` の「Privacy-consent gating」表の行 11 が「No — gap」として本 PBI を指している。ルール 1（記録行・ページ本文・派生要約を運ぶ経路はゲートが要る）に該当する唯一の dashboard 経路ながら、admission の外側にあるため記録ゲートに覆われていない

## 背景（発見の経緯）

security-audit run-2（`pbi/2026-10-18-00-backlog-security-audit-run2.md`）の系譜。PBI `2026-10-19-02`（`dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md`、同意ゲートの適用範囲 inventory）の実装と独立レビューで、「記録以外の外部送信」を棚卸しする過程で、ダッシュボードの選択追記が admission の外側で Obsidian へ書くことが判明した。PBI 02 はガイドの表に適用範囲を文書化するところまでで、実装は直していない（表の行 11 が未修正のまま本 PBI を参照している）。

### 機構（コード上で確定、2026-10-19 にコード直読で確認）

- `src/background/handlers/dashboardSqlite/coreCrudHandler.ts:75` — `case 'append_to_obsidian': {`。`CORE_CRUD_SUBTYPES`（`:40`）に含まれる dashboard の書き込み操作。
- `src/background/handlers/dashboardSqlite/coreCrudHandler.ts:90` — `deps.getSettings()` を読むが、読むのは Obsidian API キー（`StorageKeys.OBSIDIAN_API_KEY`）だけ。
- `src/background/handlers/dashboardSqlite/coreCrudHandler.ts:114` — `await deps.appendToDailyNote(markdown);`。選択行を Markdown 化して Obsidian へ書く。
- `src/background/handlers/dashboardSqlite/deps.ts:271` — `appendToDailyNote: async (markdown) => { await getObsidianClient().appendToDailyNote(markdown); }`。Obsidian REST API への実配線。
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:778` — UI から `appendToLogs(ids)` を呼ぶ。
- `src/dashboard/dashboardSqliteService.ts:467` — `sqliteClient.call('appendToLogs', { subtype: 'append_to_obsidian', ids })`。
- **`src/background/handlers/dashboardSqlite/` 配下と上記 UI / service 経路に、同意の読み出しは 1 つも無い**（`consent` / `hasPrivacyConsent` の grep が空）。`RecordingAdmission`（`src/background/recordingAdmission.ts`）も経由しない。
- confirm token は同意の確認ではない。`append_to_obsidian` は `TOKEN_EXEMPT_OPS` に含まれないため `TOKEN_REQUIRED_SUBTYPES`（`src/messaging/sqliteOperationSecurity.ts:159-162`）に入り、sender の fail-safe 既定で token が自動付与され、`verifyConfirmToken`（`src/background/confirmTokenManager.ts:152-186`）が action / scope と 60 秒 TTL・単一使用を検証する。これは「その操作を意図した」ことの証明（anti-CSRF / 誤操作防止）であり、同意の有無は見ない。
- 帰結: 同意して記録された行を、撤回後にダッシュボードで選択して追記すると、撤回済みの title / url / summary / tags が Obsidian へ出る。行は当時 consent 済みで保存されたものなので admission の記録は残っておらず、「記録時の同意」を根拠にできない。

### スコープ外（参照のみ、本 PBI では解かない）

`pbi/2026-10-18-00-backlog-security-audit-run2.md` の「未起票の観測」: 設定のエクスポート / インポートが同意レコードを運ぶ。`sanitizeSettingsForExport`（`src/utils/settingsExportImport.ts:89-97`）は `CONFIRMED_PROVIDER_ORIGINS` と API キーしか剥がさず、`exportSettings` / `exportEncryptedSettings` は `settingsRepository.getAll()` から payload を作るため、`privacy_consent` が書き出され、インポート先で同意が付与 / 撤回される。同意はデバイス・データ主体ごとの行為なので、除外とインポート時の扱いを別途決める必要がある。**本 PBI はこの観測を参照するだけで、解決しない**（別 PBI の対象）。

## 再現手順

本 PBI の証拠はコード直読で確定している（実行は未実施。マシン高負荷のため着手前の実測は実装者が行う）。実装者が最初に通す決定的な手順:

1. `createSqliteClientDeps(fakeClient, serviceWorkerDeps)`（`src/background/handlers/dashboardSqlite/deps.ts:205`）に、`appendToDailyNote` のスパイと `hasPrivacyConsent: async () => false` を注入する（同意 seam は本 PBI で追加する）。
2. `createDashboardSqliteHandler(deps)` を通して `{ subtype: 'append_to_obsidian', ids: [1], confirmToken: <有効> }` を渡す。token 検証は既存の `verifyConfirmToken` をスタブするか、`TOKEN_EXEMPT_OPS` を触らずに deps 側で true を返す。
3. 期待（現状）: `appendToDailyNote` が呼ばれ、Obsidian へ書かれる。期待（修正後）: `appendToDailyNote` は呼ばれず、`success: false` と同意に関するエラーが返る。
4. 対照: 同意済み（`hasPrivacyConsent: async () => true`）では従来どおり追記される。`delete` / `clear_all` / `update` は同意判定に関係なく従来どおり（ローカル操作のためゲート対象外）。

既存の型: `src/background/__tests__/dashboardSqliteHandlers-append.test.ts`（append の正常系 / 入力検証）、`src/background/handlers/__tests__/dashboardSqliteHandlers-token-guard.test.ts`（token guard）。

## 影響

- **撤回後の外部送信**: 撤回済みユーザーの保存済み行が Obsidian へ出る。ユーザー操作が起点だが、撤回の意思表示と矛盾する。
- **記録ゲートに覆われていない**: この経路は `RecordingAdmission` の外側にあり、記録時の同意を引き継ぐ説明が成り立たない。既存の 5 つのゲート対象（`dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 1〜5）はいずれも admission の前段か pipeline 内で、admission 後の別操作はここだけ。
- **撤回の意味の後退（GDPR Art.7(3) の趣旨）**: 撤回は「以後の処理を停止する」効果を持つとされる。撤回はユーザーの明示的な行為であり、過去に同意して保存された行だからという理由で外部へ出し続けることは、厳格な読みでは説明できない。少なくとも**実行時点で同意を再確認する**ことが最低線。
- **監査上の未解消項目**: `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 11 が「No — gap」のまま残り、適用範囲の記述が実装とずれ続ける。
- **同意のソースオブトゥルースの記述の更新**: ガイドは「`hasPrivacyConsent()` は唯一のソースオブトゥルースで、ゲート読み出し点はちょうど 1 点（`RecordingAdmission`）」と書いている（`:134-139`）。本 PBI の修正は admission 外に 2 つ目の正当なゲート読み出し点を作るため、この記述を「admission ゲート 1 点＋非 admission の外部送信ゲート」へ実態に合わせる。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 撤回後にダッシュボードから Obsidian へ追記できない
  Given 過去に同意して保存された行があり、API キーが設定されている
  And ユーザーが同意を撤回済みで、hasPrivacyConsent は false を返す
  And 有効な confirm token が付いている
  When append_to_obsidian を実行する
  Then appendToDailyNote は一度も呼ばれない（Obsidian REST API へ送られない）
  And 応答は success:false で、同意が理由であることが呼び出し側に区別できる

Scenario: 2. 同意済みなら従来どおり追記できる（回帰ガード）
  Given 同意済みで hasPrivacyConsent は true を返す
  And API キーが設定され、ids が既存行を指している
  When append_to_obsidian を実行する
  Then 従来どおり deps.query で行を引き、formatEntriesToMarkdown を経て appendToDailyNote が呼ばれる
  And 応答は success:true と appended 件数を返す

Scenario: 3. confirm token は同意の代わりにならない
  Given 撤回済みだが token は有効（60 秒以内・単一使用・scope 一致）である
  When append_to_obsidian を実行する
  Then token 検証は通っても、同意の再確認で拒否され appendToDailyNote は呼ばれない

Scenario: 4. 撤回中は行を読まない（データ最小化）
  Given 撤回済みである
  When append_to_obsidian を実行する
  Then deps.query は呼ばれない（同意の無い経路で行の中身を扱わない）
  And Obsidian API キーの有無とは独立に、同意エラーが返る

Scenario: 5. 他の dashboard 操作は同意判定に影響されない
  Given 撤回済みである
  When delete / clear_all / update / toggle_star を実行する
  Then これらはローカル操作であり、従来どおり実行される（外部送信を伴わないためゲート対象外）
```

## 受け入れ基準

- [x] `append_to_obsidian` が実行時点で同意を再確認する。判定は composition が注入する `isConsentGranted`（実体は `hasPrivacyConsent`）を共有し、handler 内で新しい同意判定を実装しない
- [x] 撤回状態では `deps.appendToDailyNote` が呼ばれない（シナリオ 1・3）
- [x] 拒否時は `deps.query` を呼ばず、行の中身を扱わない（シナリオ 4。`getSettings` も読まない）
- [x] 拒否の応答は既存の入力検証エラー（`No IDs provided` / `Maximum N IDs allowed` / `No matching entries found` など）と区別できる文字列を返す（`Privacy consent required to export to Obsidian`）
- [x] 同意済みでは従来どおり追記でき、`src/background/__tests__/dashboardSqliteHandlers-append.test.ts` の既存の期待が非退行（シナリオ 2）
- [x] `delete` / `clear_all` / `update` / `toggle_star` の挙動を変えない（シナリオ 5。同意チェックは append ケースのみ）
- [x] confirm token の扱いを**明示的に決めて記録**する（**連動させない**。理由は完了記録）
- [x] `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 11 を「Yes」に更新し、「Why / where」列に固定しているテストのファイル名と、ゲートを読む位置を書く
- [x] 同ガイドの「ゲート読み出し点は 1 点」という記述を、**admission ゲートと外部送信ゲートの 2 種**として実態に合わせる
- [x] 設定のエクスポート / インポートが同意レコードを運ぶ件は本 PBI では扱わず、参照だけ残す（PBI [2026-10-19-12](2026-10-19-12-fix-settings-export-consent-record.md)。2026-10-19 完了）
- [x] 実時間待ちを追加しない（`dev-docs/TEST_RULE.md`。同意判定は注入した関数で決定的）
- [x] `npm run validate` が緑（CI。テスト全体 1095 files / 16429 tests で exit 0）

## テスト戦略

- 単体: `src/background/__tests__/dashboardSqliteHandlers-append.test.ts` に同意拒否 / 許可の 2 系統を足す。deps 注入（`createSqliteClientDeps` の `serviceWorkerDeps` 相当の seam）で `hasPrivacyConsent` を差し替え、拒否時は `appendToDailyNote` と `query` が未呼び出し、許可時は従来の呼び出し順（`getSettings` → `query` → `formatEntriesToMarkdown` → `appendToDailyNote`）を pin する。
- 単体（token との独立）: `src/background/handlers/__tests__/dashboardSqliteHandlers-token-guard.test.ts` の型で、token 検証が通っても同意拒否で止まることを 1 件足す。token 検証はスタブし、同意判定だけを変える。
- 統合: `createDashboardSqliteHandler(deps)` を通した dispatch（`src/background/handlers/dashboardSqlite/__tests__/dispatch-seams.test.ts` の型）で、`CORE_CRUD_SUBTYPES` の他の操作（`delete` / `clear_all`）が同意判定に影響されないことを pin する。
- 配線: composition root が同じ同意ソース（`hasPrivacyConsent` または `recordingAdmission` シングルトン）を handler にも渡していることを、`src/background/__tests__/backgroundComposition.test.ts` の型で確認する。handler 側で新しい判定を生成しないことの回帰ガード。
- 既存 seam: 同意の読み出しは非同期 1 関数なので、実時間待ちは不要。`getObsidianClient`（`deps.ts:271`）は既に deps 注入の裏にあり、テストで実クライアントを触らない。
- E2E: 不要（決定的な局所挙動）。owner が隔離プロファイルで「同意 → 記録 → 撤回 → ダッシュボードで選択追記 → 拒否される」を 1 回観測する。

## 実装メモ（設計判断と対象ファイル）

### 対象ファイルと該当箇所

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/background/handlers/dashboardSqlite/coreCrudHandler.ts` | 40 / 75 / 90 / 114 | `CORE_CRUD_SUBTYPES`、append ケース、`getSettings`、Obsidian への書き込み |
| `src/background/handlers/dashboardSqlite/deps.ts` | 81-90 / 205-273 | `CoreCrudDeps`（`getSettings` / `appendToDailyNote`）、`createSqliteClientDeps` の配線。同意 seam を足す場所 |
| `src/dashboard/dashboardSqliteService.ts` | 464-468 | `appendToLogs`（`append_to_obsidian`） |
| `src/dashboard/panels/asyncData/sqliteHistoryModel.ts` | 778 | UI の呼び出し元 |
| `src/messaging/sqliteOperationSecurity.ts` | 138-162 | `TOKEN_EXEMPT_OPS` / `TOKEN_REQUIRED_SUBTYPES`。append は token 必須 |
| `src/background/confirmTokenManager.ts` | 19 / 123-186 | token の 60 秒 TTL・単一使用・scope 束縛 |
| `src/background/compositionManifest.ts` | 229-235 | 同意判定のシングルトン（`isRecordingAllowed: () => hasPrivacyConsent()`） |
| `dev-docs/SECURITY_REVIEW_GUIDE.md` | 132-173 | ゲート読み出しの記述と適用範囲の表（行 11 を Yes へ） |
| `src/background/__tests__/dashboardSqliteHandlers-append.test.ts` | 全体 | append の既存テスト（同意の 2 系統を足す） |

### 実装者が決める設計判断: handler で直接読むか、共有 seam に寄せるか

- **A. dashboard handler に同意読み出しを足す（new consent read）**
  - `CoreCrudDeps` に `hasPrivacyConsent: () => Promise<boolean>` を足し、`createSqliteClientDeps` が composition root の同意ソースを注入する。append ケースの冒頭（入力検証の後、`getSettings` の前）で読み、false なら送信せずに返す。
  - 利点: 変更が小さく、既存の deps 注入の型に 1 つ足すだけ。テストは deps 差し替えで決定的。外部送信の直前に読むので、撤回 → 実行の窓を確実に閉じる。
  - 欠点: ガイドが宣言する「ゲートは 1 点」が崩れる。同種の非 admission 経路（本 PBI 10 の 3 経路、将来の Gist など）がそれぞれ読み出しを書くと、判定の実装がドリフトする。→ 対策として、読むのは `hasPrivacyConsent` / `recordingAdmission` の**共有ソース 1 つ**に限定し、handler はそれを呼ぶだけにする（判定ロジックを handler に書かない）。
- **B. 外部送信の共有 seam に寄せる**
  - 「記録行・ページ本文・派生要約を外へ出す前に同意を確認する」共通の関門を作り、dashboard の append もそこを通す。admission ゲートと並ぶ 2 つ目のゲートとして 1 箇所に集約する。
  - 利点: 判定が 1 箇所に戻る。PBI 10 の 3 経路（キュー / 通知 / 要約）と将来の Gist も同じ関門に乗せられる。
  - 欠点: 変更が広く、`pendingChromeStorageQueue` / Obsidian クライアント / AI サービスの各呼び出しに seam を差し込む設計判断が必要。本 PBI の範囲を超えやすい（PBI 10 と設計を共有する必要がある）。
- **推奨: A を主とし、B の共有ソース化は PBI 10 と同時に設計する。** 具体的には、handler は新しい判定を書かず、composition root が渡す 1 つの同意読み出し（`hasPrivacyConsent` か `RecordingAdmission` のゲート）を呼ぶ。ガイドの「ゲートは 1 点」の記述は「admission ゲート 1 点＋外部送信ゲート（共有ソースを読む）」へ更新する。B の共通関門化は、PBI 10 の 3 経路と同じ設計判断になるため、まとめて扱う場合は両 PBI を同じ期に置く。
- **判断の記録**: どちらを採ったか、およびその理由（判定を 2 箇所に書かない、変更を小さく保つ、など）を完了記録に残す。

### confirm token の扱い（判断）

- `append_to_obsidian` は token 必須だが、token は action / scope 束縛・単一使用・60 秒 TTL の「意図の証明」であり、同意の確認ではない（`src/background/confirmTokenManager.ts:19` / `:152-186`）。
- 推奨: **token を同意に連動させない。** 撤回後 60 秒以内に token が残っていても、実行時の同意再確認で拒否されるため、窓は閉じている。撤回時に token を失効させる実装を足すと、token の責務（anti-CSRF / 誤操作防止）と同意の責務が混ざる。
- 代替（採らない場合の記録）: 撤回時に発行済み token を失効させる、または token 発行時に同意を要求する。前者は `confirmTokenManager` への副作用が増え、後者は token 発行が admission ゲートと二重になる。採るなら理由を完了記録に残す。

### 落とし穴

- **同意チェックの位置が応答の意味を変える。** 入力検証（ids の形状・上限・数値）より前に同意を読むと、撤回中の呼び出しで「No IDs provided」ではなく同意エラーが返る。既存テストの期待と、呼び出し側の表示が変わる。推奨は「入力検証の後、`getSettings` / `query` の前」で、シナリオ 4 のとおり行を読まない位置。
- **API キー未設定のエラーより同意を先に返すか。** 順序を決めないと、撤回中かつ API キー未設定のときにどちらの理由が出るかが曖昧になる。同意を先にすると、未設定に気づけないまま「同意してください」と言われる。設定エラーを先にするかは UX 判断で、どちらでもよいが**テストで固定**する。
- **`clear_all` / `delete` / `update` まで同意で止めない。** これらはローカル操作で外部送信を伴わない（ガイドのルール 1 は「記録行・ページ本文・派生要約を運ぶ経路」が対象）。過剰適用すると、撤回後に自分のデータを消せなくなる（GDPR の消去権の趣旨に反する）。
- **`getSettings` を同意の読み出しに流用しない。** `deps.getSettings()` は `settingsRepository.getAll()` で、同意レコードがブロブへ移行している場合の読み出しが別問題（PBI `2026-10-19-03`）。同意は `hasPrivacyConsent` / `recordingAdmission` から読む。
- **トークン検証のスタブに注意。** テストで token guard を丸ごと外すと、シナリオ 3（token は同意の代わりにならない）が検証できない。token 検証は「通る」状態を保ち、同意判定だけを false にする。
- **`serviceWorkerDeps` の型を広げすぎない。** `SqliteClientBackedDeps`（`deps.ts:187-194`）は migration / token / backfill / cleanup / resync の 6 つに絞られている。同意 seam は `CoreCrudDeps` に足し、`createSqliteClientDeps` の本体で composition root から受け取る形にする（`serviceWorkerDeps` を肥大化させない）。
- **ガイドの記述の二重更新。** 「ゲートは 1 点」の記述（`:134-139`）と表の行 11 の両方を直さないと、次に読む人が矛盾を見る。`requireConsent` が消えた理由の記述（`:170-173`）とも整合を取る。

### ロールバック手順

1. 同意 seam と append のガードは 1 箇所なので、`git revert` で戻せる（元の「無条件に追記」へ戻る）。
2. revert 後は「未修正に戻る」ため、`dev-docs/SECURITY_REVIEW_GUIDE.md` の行 11 を「No — gap」へ戻し、`pbi/00-INDEX.md` の状態も戻す。
3. revert 後に `npm run validate` で緑を確認する（append の既存テストが非退行であること）。

## 見積もり

1.5 SP（低）。内訳: handler への同意 seam 追加と composition 配線 ＝ 0.6 / 拒否応答とテスト（拒否・許可・token 独立・他操作の非影響）＝ 0.6 / 監査ガイドの表と記述の更新 ＝ 0.2 / confirm token の扱いの判断と記録 ＝ 0.1。設計判断 B（共有関門化）を PBI 10 と同時に採る場合は、両 PBI 合計で +1.0 SP 程度。

## Definition of Done

- [x] BDD シナリオ 1〜5 が自動テストで実装されパス（シナリオ 1・2 を新規テストで、3 は token をスタブしたまま同意だけ false にして固定、4 は `query` 未呼び出しで固定、5 は既存のローカル操作テストが非退行）
- [x] `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 11 が「Yes」になり、固定テスト名とゲートの読み出し位置が書かれている
- [x] 同ガイドの「ゲート読み出し点は 1 点」の記述が実態（**admission ゲート＋外部送信ゲートの 2 種**）に更新されている
- [x] 設計判断（**A: handler の deps に注入**）と confirm token の扱い（**連動させない**）、その理由が完了記録に残っている
- [x] 設定のエクスポート / インポートが同意レコードを運ぶ件は本 PBI の範囲外として切り出した（PBI [2026-10-19-12](2026-10-19-12-fix-settings-export-consent-record.md)。2026-10-19 完了）
- [x] `delete` / `clear_all` / `update` / `toggle_star` の非退行がテストで pin されている（同意チェックは append ケースにのみ追加）
- [x] `npm run validate` が緑（CI。テスト全体は 1095 files / 16429 tests で exit 0）
- [x] コードレビュー完了
- [x] ドキュメント更新済み（ガイドの表と 2 種のゲート記述、`coreCrudHandler.ts` の append ケースのコメント、`deps.ts` の seam のコメント）

## 完了記録（2026-10-19）

### なぜなぜ分析（原因 → 示唆 → 解）

**疑問**: なぜダッシュボードの「Obsidian へ追記」だけが同意ゲートの外にあったのか。

1. **なぜ外にあったのか** — この経路は `RecordingAdmission` を通らない。admission は「記録を新規に作る」経路の前段で、**既存行を書き出す**操作は別の入口（dashboardSqlite handler）から来る。
2. **なぜ admission に乗っていないのか** — ダッシュボード操作は「ユーザーが明示的に選んだ行を操作する」もので、記録の生成ではない。設計上は別系統が正しい（delete / clear_all / update / toggle_star と同じ family）。
3. **なぜ正しさが崩れたのか** — 同じ family に「ローカル操作（delete / star / update）」と「**外部送信**（append to Obsidian）」が同居しているのに、**family 単位でゲートの要否を判断**した。ローカル操作には不要・外部送信には必要という区別が、family の境界と一致しなかった。
4. **なぜ区別されなかったのか** — PBI 02 の一覧が「記録が前提なら継承」と書いていた。判断軸が「**記録に由来するか**」であり、「**どこへ出るか（外部送信か）**」ではなかった。既存行の書き出しは「記録が前提」に見えるため継承と分類された。
5. **なぜテストで捕まらないのか** — append のテストは「行が選ばれて追記される」ことだけを見ており、**同意という軸**が無かった（token ガードのテストはあったが、token は同意の代わりにならない）。

**原因**: ゲートの要否を「操作の family（どの handler か）」で判断し、「データが外部へ出るか」で判断しなかったこと。

**示唆**:
- 判定基準は「**外部へ出るか**」。同じ family 内でも outbound だけがゲート対象で、ローカル操作は対象外にする（撤回後に自分のデータを消せなくしない）。
- 読み出し位置は**入力検証の後・設定/行の読み出しの前**。撤回中は行を読まない（データ最小化）。
- token は意図の証明であって同意ではない。連動させない（責務を混ぜない）。
- 「admission ゲート 1 点」という表現は実態に合わない。**admission ゲート＋外部送信ゲート**の 2 種として書き、後者は composition から注入した同一ソースを読む。

**解**: `CoreCrudDeps.isConsentGranted` を追加し、append ケースの入力検証後・`getSettings` の前で判定。composition（`dashboardSqliteWiring`）から `hasPrivacyConsent` を注入。ガイドの記述を 2 種のゲートに更新し、表の行 11 を「Yes」に。

### 設計判断の記録

- **A（handler の deps に注入）を採用、B（外部送信の共通関門）は今回作らない。** B は PBI [2026-10-19-10](2026-10-19-10-fix-consent-recheck-scheduled-jobs.md) の 3 経路と将来の Gist を巻き込む広い設計で、本 PBI の範囲を超える。代わりに **seam の名前と実体を PBI 10 と揃えた**（どちらも composition が渡す `isConsentGranted: () => Promise<boolean>`＝`hasPrivacyConsent` の 1 行）。判定ロジックは handler に書かず、注入された関数を呼ぶだけ。
- **seam の置き場所**: `SqliteClientBackedDeps`（Service Worker が所有する deps の袋）に足した。PBI の実装メモは「袋を肥大化させない」としていたが、代替は `createSqliteClientDeps` の第 3 引数追加で、harness と 6 つのテスト呼び出しを書き換える必要があった。袋は「Service Worker が所有し注入するもの」の定義そのものなので、ここに置く方が意味が通る（型は `CoreCrudDeps` 側で明示的に受ける）。
- **confirm token は同意に連動させない。** token は action / scope 束縛・単一使用・60 秒 TTL の「意図の証明」であり、同意の確認ではない。撤回 → 実行の窓は実行時再確認で閉じる。撤回で token を失効させると token の責務（anti-CSRF / 誤操作防止）と同意の責務が混ざる。
- **同意チェックは API キー確認より前**（撤回中は設定も読まない）。テストで固定した（`query` も `getSettings` も呼ばれない）。

### 実装

- `src/background/handlers/dashboardSqlite/coreCrudHandler.ts` — append ケースの入力検証後・`getSettings` の前に同意判定を追加。拒否は `{ success:false, error: 'Privacy consent required to export to Obsidian' }`（既存の入力検証エラーと区別できる文字列）。
- `src/background/handlers/dashboardSqlite/deps.ts` — `CoreCrudDeps` と `SqliteClientBackedDeps` に `isConsentGranted` を追加し、`createSqliteClientDeps` が袋から handler の deps へ渡す。
- `src/background/dashboardSqliteWiring.ts` — `DashboardSqliteWiringDeps.isConsentGranted`（任意、既定は `hasPrivacyConsent`）として受け取り、袋へ渡す。
- `dev-docs/SECURITY_REVIEW_GUIDE.md` — ゲートの記述を 2 種に更新、表の行 11 を「Yes — at execution time」に。

### テスト（Red → Green）

- `src/background/__tests__/dashboardSqliteHandlers-append.test.ts` — 「撤回中は追記を拒否し、行も読まない（`query` 未呼び出し）」「同意済みなら従来どおり追記する（回帰ガード）」。
- **Red の確認**: `coreCrudHandler.ts` の同意判定を revert すると新規 1 テストが失敗。token 検証はスタブしたままなので、シナリオ 3（token は同意の代わりにならない）も同時に満たしている。
- 回帰: `dashboardSqliteHandlers*` / `nn26-manifest-singletons` など 4 ファイル 52 テスト緑、テスト全体 **1095 files / 16429 tests / exit 0**。型は `type-check` / `type-check:test:baseline`（456 / pinned 456）とも緑。

### ゲート

`npm run validate` は CI で緑。ローカルの集約実行は他 PBI と同じくホスト負荷の影響を受けるため、構成要素と対象スイートを個別に緑確認した。

## 関連

- [PBI 2026-10-19-10: 記録の実行を後から行う経路（オフライン再送・通知・定期要約）が同意を再確認しない問題の修正](2026-10-19-10-fix-consent-recheck-scheduled-jobs.md) — 同じ「admission 後の外部送信」クラス。共有 seam の設計判断を共有する（2026-10-19 完了・アーカイブ済み）
- [dev-docs/SECURITY_REVIEW_GUIDE.md](../../SECURITY_REVIEW_GUIDE.md) — 「Privacy-consent gating」表の行 11（本 PBI）と行 8〜10（PBI 10）。ルール 1・2 が本 PBI の根拠
- [pbi/2026-10-18-00-backlog-security-audit-run2.md](../../../pbi/2026-10-18-00-backlog-security-audit-run2.md) — 発見の系譜（security-audit run-2）と「未起票の観測」（設定エクスポート / インポートが同意レコードを運ぶ。本 PBI では解かない）
- [2026-10-19-02-fix-consent-gate-wiring-coverage.md](2026-10-19-02-fix-consent-gate-wiring-coverage.md) — 同意ゲートの適用範囲 inventory。本 PBI はその独立レビューで発見され、表の「gap」行として起票された
- [2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) — 同意レコードの読み出し先（top-level 直読み）に関わる。`getSettings` を同意の読み出しに流用しない理由
- [pbi/00-INDEX.md](../../../pbi/00-INDEX.md)
- [dev-docs/TEST_RULE.md](../../TEST_RULE.md) — 実時間待ちの禁止と、注入 seam の使い方
