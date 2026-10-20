# PBI: 通知 Save クリック経路に同意アドミッション pre-stage を適用する

## ユーザーストーリー

プライバシー同意を撤回したユーザーとして、表示が残っている通知の Save を押しても記録が実行されてほしくない。なぜなら同じセーブを popup / dashboard 経由で行えば `privacy_consent_required` で拒否されるのに、通知クリックだけは同意の再確認を挟まずに本文が SQLite / Obsidian に残るから。

## 優先度

- 順位: 04 / 25
- RICE: 4800（Reach=400 / Impact=3 / Confidence=100% / Effort=0.3）
- 根拠 / 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微
  - 監査4位。通知の Save ボタンだけが、同意レジストリが全記録経路に課している共通ゲートの pre-stage を経由しない。`{'notification-confirm'}` ポリシーは `force:true` で domainFilter/trust/privacyHeaders をすべて通過させ、残る防御は permission ステップだけ。同意撤回後に残存した通知をクリックするだけで pipeline が走って記録され、同一セーブを通常経路で行えば `privacy_consent_required` で拒否される。非対称かつ contrary（同意が撤回されているのに記録される）。修正は既存 RecordingAdmission seam をDIで注入するだけ。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `notificationHandlers.onButtonClicked::missing-consent-admission-prestage`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 14番 / findings.json）。

- 対照: registry 経路（`VALID_VISIT` / `MANUAL_RECORD` / `SAVE_RECORD` / `REGENERATE`）は `RecordingAdmission.admit()` を必ず先に走らせ、`hasPrivacyConsent()` が false なら `privacy_consent_required` で拒否する（`src/background/handlers/recordingHandlers.ts:110` ほか）。通知ディスパッチだけがその前段を持たない。
- 残る防御が薄い: `notification-confirm` のソースポリシーは `force:true`（`src/background/recordRequestBuilder.ts:77`）なので `decideDomainFilter` / `decideTrust` / `decidePrivacy` は force で即 allow（`src/utils/recordingGateTable.ts:82` 付近）。実効的な拒否は permission ステップと truncate のみ。
- 到達可能: pending ページの TTL は `PENDING_MAX_TTL_MS = 24h`（`src/utils/pendingStorage.ts:92`）。同意済みで発行された privacy-confirm 通知は最長24時間生存し、その間に `withdrawPrivacyConsent()`（`src/utils/storage/privacyConsent.ts:242`）で同意を撤回できる。通知清除はクリック時に無条件（`src/background/handlers/notificationHandlers.ts:50`）だが、その前なら通知は画面に残る。
- 未pin: `src/background/handlers/__tests__/notificationHandlers.test.ts:89` 以降のテストは prefix 判定・clear・pending 空・buttonIndex=1・join のみを pin しており、consent / admission の振舞い検証が1件も無い（「既存の採用検討 pin が無いため追加テスト必須」）。

## BDD受け入れシナリオ

```gherkin
Scenario: 同意撤回後の通知 Save は記録しない
  Given 同意済みの状態の通知に privacy-confirm 通知が表示されている
  And ユーザーが同意を撤回済みで、hasPrivacyConsent が false を返す
  When 通知の Save ボタン（buttonIndex 0）をクリックする
  Then 記録パイプラインは一度も起動されず、privacy_consent_required で拒否される
  And pending ページは保持され、通知クリックは静かに失敗しない（ログまたは通知で理由が観測できる）

Scenario: 同意済みなら従来どおり保存できる
  Given 同意済みで hasPrivacyConsent が true を返す
  And pending ページに該当 URL がある
  When 通知の Save ボタン（buttonIndex 0）をクリックする
  Then 従来どおり記録が実行され、SingleFlight の join と recovery claim の順序は変わらない
  And 成功後は pending ページが削除される

Scenario: 記録対象が無い／別ボタンの挙動は不変
  Given pending ページに該当 URL が無い、または buttonIndex が 1
  When 通知の Save / 閉じるボタンを押す
  Then record は呼ばれず、従来どおり pending ページの削除（または no-op）のみ行われる
```

## 受け入れ基準

- [x] `NotificationHandlersDeps` に共通 RecordingAdmission 由来の `admit` seam が追加され、`deps.record(...)` の**前**に実行される（`src/background/handlers/notificationHandlers.ts:33` / `:91`）
- [x] 同意撤回状態（`admit` が `{ rejected: { reason: 'privacy_consent_required' } }` を返す）では `deps.record` が一度も呼ばれない
- [x] 同意済みでは従来どおり記録が実行され、既存の pending 削除・join・recovery claim の挙動に回帰がない
- [x] 拒否時は `removePendingPages([url])` を呼ばない（同意し直せば再試行できる。拒否で pending を消さない）
- [x] `admit` は compositionManifest の `recordingAdmission` シングルトン（`src/background/compositionManifest.ts:229` 付近）を単一共有する（handler 内で新しい RecordingAdmission を生成しない）
- [x] `src/background/handlers/__tests__/notificationHandlers.test.ts` に consent 拒否 / 許可の2系統が pin され、`src/background/handlers/__tests__/notificationSingleFlight.test.ts:81` の deps 構築が新 deps に合わせて更新される
- [x] 通知クリックが無反応にならないフィードバック（i18n メッセージ、または `privacy_consent_required` を明示したログ）が用意されている（副作用 🟡軽微 の緩和策）
- [x] `npm run validate` が緑（type-check / lint / test すべて）

## テスト戦略

- 単体: `src/background/handlers/__tests__/notificationHandlers.test.ts` に `admit` を差し替えた DI テスト（`admit` が `privacy_consent_required` を返すケースで `record` が未呼び出し、かつ `removePendingPages` が保持側）、および `{ settings }` を返すケースで `record` が従来どおり呼ばれる回帰 pin。
- 統合: `src/background/__tests__/backgroundComposition.test.ts`（および compositionManifest 関連テスト）で、通知ハンドラがメッセージ経路と同じ `recordingAdmission` シングルトンを参照していることを確認する配線テスト。
- E2E: 通知クリック → 保存の実挙動。現状 `testDir/e2e/` に通知系スペックは存在しないため、まず手動 bounded 観測（同意撤回 → 通知 Save → 記録が増えない）を `dev-docs/TESTING_GUIDE.md` の手動チェックリスト側で記録し、Playwright に載せる場合は notification モック生成の工数込みで別途判断する。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（trace / evidence）

| ファイル:行 | 内容 |
|---|---|
| `src/background/service-worker.ts:264` | `chrome.notifications.onButtonClicked` 登録。sender も router trust tier も無い独自イベント |
| `src/background/service-worker.ts:194` | `createNotificationHandlers({ record: (data) => recordingPipeline.record(data) })` ― admission seam を注入していない配線 |
| `src/background/handlers/notificationHandlers.ts:33-35` | `NotificationHandlersDeps` が `record` のみ。`admit` が無い |
| `src/background/handlers/notificationHandlers.ts:87-95` | `claimRecoveryOwner('manual')` → `deps.record(buildRecordRequest('notification-confirm', ...))`。この間に同意ゲートが無い |
| `src/background/handlers/notificationHandlers.ts:50` | クリック時に `chrome.notifications.clear` を無条件実行（撤回済みでも通知は消える） |
| `src/background/recordingAdmission.ts:69-103` | 共有 `admit(kind, sender)`。非 valid-visit は `isRecordingAllowed()` false で `privacy_consent_required` |
| `src/background/handlers/recordingHandlers.ts:110` | 対照実装: registry 経路は `deps.admit('valid-visit', sender)` を先に走らせる |
| `src/background/recordRequestBuilder.ts:77` | `'notification-confirm'` ポリシー `force: true` |
| `src/utils/recordingGateTable.ts:82` 付近 | `decidePrivacy` 等は `force` で即 allow（domainFilter / trust / privacyHeaders が無効化） |
| `src/background/pipeline/RecordingOrchestrator.ts:129` | sink: `record()` が13ステップ pipeline を実行 |
| `src/utils/pendingStorage.ts:92` | `PENDING_MAX_TTL_MS = 24h` ― 撤回と記録の窓（第4シナリオの前提） |
| `src/background/compositionManifest.ts:229-239` | `recordingAdmission` シングルトン定義（`isRecordingAllowed: () => hasPrivacyConsent()`） |
| `src/background/createBackgroundServices.ts:116` | コンテナが `recordingAdmission` を返す（`service-worker.ts:104` の `services` から参照可能） |

### 最小変更（推奨）

1. `NotificationHandlersDeps` に admit seam を1本追加する。推奨シグネチャは `admit: (kind: RecordAdmissionKind) => Promise<AdmissionOutcome>`（sender を composition root 側で bind する形）。
2. `notificationHandlers.ts:87` の claim 成功後・`:91` の `deps.record` の**直前**に `const admitted = await deps.admit('save')` を置き、`'rejected' in admitted` なら `logWarn(..., reason)` して `return`（`removePendingPages` は呼ばない → pending 保持）。
3. kind は `'save'` を推奨。`KIND_RATE_BUCKET.save === null`（`recordingAdmission.ts:39`）なのでレート制限は走らず、通知クリックは「明示的なユーザー操作」という既存コメント（`recordingAdmission.ts:36`）と整合する。`'manual'` を選ぶと origin 不明のレートカウンタに当たり、意図しない拒否が増える。
4. 配線は `src/background/service-worker.ts:194` で `services.recordingAdmission` から bind する。`services` は同ファイル `:104` で既に生成済み、`createBackgroundServices()` は `recordingAdmission` を返す（`createBackgroundServices.ts:116`）なので新規インスタンスは不要。
5. sender が無い点: `chrome.notifications.onButtonClicked` は sender を持たない。`recordingAdmission.admit('save', {} as chrome.runtime.MessageSender)` のように composition root 側だけで空 sender を bind し、handler に `any` / `unknown` を漏らさないこと（`toSenderLike` はレート分岐内でのみ使われるため `'save'` では未使用）。`RecordingAdmit` の sender を optional に広げる案も存在するが、共有 seam の型変更は影響が広いので今回は避ける。

### 着手前に潰すべき検証（ブロッカー）

監査 verdict は `needs_validation`。観測そのものは source-only 実行ポリシーで未実施のため、**着手前に bounded なローカル観測で再現を確定させる**こと（Red を先に1本作ってから直す進め方で進める）:

- `testDir` の mock chrome で、`hasPrivacyConsent` が false（撤回済み）を返す状態で、署名済み `privacy-confirm-<hmac(url)>` 通知ID + pending ページ1件を seed し `onButtonClicked(id, 0)` を呼ぶ。
- 現状の挙動（修正前）を一度だけ観測して記録する: `deps.record` が呼ばれていれば監査所指で確定。呼ばれていなければ needs_validation 提案を棄却して本 PBI をクローズする。
- 修正後は同じ観測で `record` 未呼び出し + `privacy_consent_required` 拒否を assert する。
- 監査 `validation_plan` の deployment 観測（隔離プロファイルで同意撤回 → 通知 Save → 記録が増えないか）は手動確認として `dev-docs/TESTING_GUIDE.md` のチェックリストに1行足す。

### 既存テストへの追加項目

- `src/background/handlers/__tests__/notificationHandlers.test.ts:89` の `mockRecordingLogic` は `record` のみを持つ。admit を足すか、deps ファクトリを `createNotificationHandlers({ record, admit })` に統一する。
- 現状 `getPendingPages` は `[]` を返し続けるモック（`:11-14`）。`record` が呼ばれる happy path が1件も無いので、pending に1件入れた状態で「同意済み → record される」「撤回 → record されない」の2本を追加する。
- `:123`（buttonIndex=0 + pending 空）と `:130`（buttonIndex=1）は回帰としてそのまま残す。
- `src/background/handlers/__tests__/notificationSingleFlight.test.ts:81` の `createNotificationHandlers({ record })` も新 deps でコンパイルが通るよう更新する。

### 落とし穴

- 通知はクリック時に無条件 clear される（`:50`）。拒否時に pending を残しても「画面上の通知」は戻らないので、ユーザーが同意し直して popup / dashboard から再試行できることをメッセージまたはログに残すこと。
- 拒否時に `removePendingPages` を呼ぶと pending まで失われ、同意し直しても再記録できない。受け入れ基準どおり「保持」側に倒す。
- `admit` は `record` の**前**に置く。後ろに置くと recovery claim（`:87`）を消費した状態で記録拒否が起き、pending だけ残る不整合が生じうる。

### ロールバック手順

1. `notificationHandlers.ts` の `admit` 呼び出しと deps 型を元に戻す（composition root 側の bind 1行を削除）。
2. `service-worker.ts:194` を `{ record: ... }` に戻し、compositionManifest の変更があれば巻き戻す。
3. 追加テストを無効化せず残す（要件として無効化はしない。戻すのは配線のみ）。回帰を出す場合は該当の記録と `pbi/` の完了記録に「ロールバック済み」と明記する。

## 見積もり

1.0 SP（🟢低。deps への seam 追加と配線 1行、既存 seams 再利用。ただしブロッカー観測と既存2テストファイルの deps 更新を含む）

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス
- [x] `npm run validate` が緑
- [x] 監査 fingerprint `notificationHandlers.onButtonClicked::missing-consent-admission-prestage` を完了記録に残す
- [x] コードレビュー完了
- [x] ドキュメント更新済み（consent lifecycle の FEATURE.md 等。撤回後に通知クリックが拒否される旨を追記）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: 同意撤回状態（`hasPrivacyConsent()===false`）で署名済み privacy-confirm 通知 ID を実鍵で生成し `onButtonClicked(id, 0)` を実行 → **`deps.record` が 1 回呼ばれた**。payload は `force:true`・`skipDuplicateCheck:true` の `notification-confirm` ポリシーそのままで、`pendingAfter: []`（記録後に pending 削除）
- 影響: needs_validation から実証済みへ。Red テストはそのまま BDD シナリオ 1 として利用可能

## 関連

- `pbi/00-INDEX.md`
- 同じ consent 領域の PBI 05（2026-10-19 完了・アーカイブ済み: `dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md` / privacyConsent migration の再付与阻止）と実装時に window の整合を取ること（撤回後に legacy migration が同意を復活させると、本修正が無効化される。両者は同じ `hasPrivacyConsent()` を読むため、順序とテスト条件を共有する）
- `src/utils/pendingStorage.ts:92` の TTL（本 PBI の「通知が残る窓」の根拠）

## 完了記録（2026-10-20）

- 実装: deps の `isConsentGranted` を共通 RecordingAdmission 由来の `admit` seam に置換し、composition root（service-worker.ts）で空 sender を bind した `admit('save')` を注入。buttonIndex 0 先頭（getPendingPages/claim の前）で実行し、rejected なら `privacy_consent_required` を明示した logWarn のみで return（removePendingPages 不呼び出し = pending 保持）。SECURITY_REVIEW_GUIDE（outbound gate → admission gate への移動）と TESTING_GUIDE（手動観測 1 行）を更新。
- 設計判断: PBI 実装メモの「claim 成功後・record 直前」ではなく、既存の同意再読み込み位置（claim 前）で bare seam を置換。アーカイブ済み PBI 2026-10-19-10 の配置と本 PBI の落とし穴（claim 消費後の拒否で不整合）を両方満たし、受入シナリオの観測挙動は同一。
- 検証: 4 テストファイル 189 件緑（新規 3 本: 同意済み happy path のソースポリシー pin / 撤回 → record 未呼び出し・pending 保持 / 配線 2 本）/ type-check / eslint / docs-chars 0 違反 / graphify 済み。