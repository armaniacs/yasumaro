# PBI: 単一オブジェクト設定移行が同意レコードと拒否カウンタを settings ブロブへ畳み、top-level を直読する所有モジュールから見えなくする問題の修正

## ユーザーストーリー

同意を撤回した（または拒否した）ユーザーとして、**撤回の記録と「3回拒否したら30日聞かない」という猶予の状態が、拡張機能の内部的な設定移行で消えないこと**がほしい、なぜなら撤回記録は GDPR Art.7 の撤回を後から示せる唯一の証跡であり、拒否カウンタはこちらの都合でモーダルを繰り返し出さないためのユーザー保護だから。移行でこれらが top-level から消えると、撤回履歴は読めなくなり（`getConsentWithdrawalHistory(): null`）、猶予は 0 に戻って、移行直後に不要な再同意モーダルが出る。

## 優先度

- 順位: 2026-10-19 の 01 / 02（同日起票 2 件のうち 1 番目）
- RICE: 600（Reach=400 / Impact=3 / Confidence=100% / Effort=2.0）
  - Reach: 単一オブジェクト設定移行は全プロファイルで 1 回走る。同意機能を使ったことのある母数を 400 と推定
  - Impact: 3。同意の可否そのものは壊れない（PBI 2026-10-18-05 の ack ガードが再付与を止めるため）が、**撤回の監査証跡が消える**ことと、拒否したユーザーに猶予を無視してモーダルが出ることの 2 点が重なる
  - Effort: 2.0 SP。allowlist の追加（1 行）＋既に畳まれたプロファイルの救済（設計判断込み）＋テスト
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（**storage key structure** は AGENTS.md が high-risk と明示する領域。`TOP_LEVEL_ONLY_KEYS` の変更は、移行の「完了」判定と全プロファイルの保存先に影響する。救済ステップを入れる場合は既存プロファイルの storage を書き換えるため、ロールバック計画が必要）

## 背景（発見の経緯）

PBI [2026-10-18-05](../dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md)（同意の自動再付与）の実装中に、独立レビューと局所再現で判明した。同 PBI の修正は「再付与を止める」ところまでで、**キーの置き場所そのものは直していない**（完了記録の「残課題」に切り出し済み）。

### 機構（コード上で確定）

1. `src/utils/storage/settingsMigration.ts:143-167` — `TOP_LEVEL_ONLY_KEYS` は「所有モジュールが `chrome.storage.local` を直接読むキー」を保護する allowlist。列挙されているのは `ENCRYPTION_*` / `HMAC_SECRET` / `MASTER_PASSWORD_*` / `PRIVACY_CONSENT_VERSION` / `TRANCO_VERSION` / `RECORDING_TRIGGERS` / `SNAPSHOT_INTERVAL_MINUTES` / `TRUST_DB`。
   - **`PRIVACY_CONSENT` / `PRIVACY_CONSENT_DENIED_COUNT` / `PRIVACY_CONSENT_LAST_DENIAL_TIME` は入っていない。** コメント（`:155-158`）は「Version-managed state read straight from storage (privacyConsent.ts, trancoConsentManager.ts)」と、まさに同意モジュールを allowlist の根拠に挙げているのに、同意レコード本体と拒否カウンタが漏れている。
2. `settingsMigration.ts:176-179` — `isMigratableStorageKey` は `STORAGE_KEY_VALUES`（`src/utils/storage/settingsBackup.ts:8` の `Object.values(StorageKeys)` 全値）に含まれ、allowlist に無ければ移行対象。よって上記 3 キーは移行対象。
3. `settingsMigration.ts:313-315` でそれらが `legacyKeys` に入り、`:319-328` で `settings` ブロブへ畳まれ、`:363` で top-level から削除される。
4. 同意を読む側は**すべて top-level 直読み**: `src/utils/storage/privacyConsent.ts` の `getPrivacyConsent`（`:95`）/ `migrateLegacyPrivacyConsent`（`:207-212`）/ `getConsentWithdrawalHistory`（`:338`）/ `getConsentDeniedCount`（`:459`）。ブロブ側の読み出しは無い。

### 局所再現（2026-10-19 実測、一時テストで確認後に削除）

`InMemoryStoragePort` に withdrawn レコードと拒否カウンタ 3 を seed し、`migrateToSingleSettingsObject({ port })` を実行:

```
MIGRATABLE privacy_consent = true
MIGRATABLE denied_count   = true
MIGRATABLE last_denial    = true
MIGRATABLE ack            = false          ← allowlist で保護されている

AFTER MIGRATION top-level consent = undefined
AFTER MIGRATION top-level count   = undefined
AFTER MIGRATION blob consent      = {"hasConsented":false,"withdrawal":{"withdrawalDate":"2026-10-01T00:00:00.000Z"},"signature":"sig"}
AFTER MIGRATION blob count        = 3

対照: allowlist 済みの ENCRYPTION_SALT / TRUST_DB は top-level に残り、移行対象の OBSIDIAN_PORT は消える
```

## 影響

- **撤回証跡の消失**: `getConsentWithdrawalHistory()` が `null` を返すようになる（GDPR Art.7 の撤回を事後に示せない）。
- **同意が「未同意」に見える**: 移行直後に再同意モーダルが出る。`PRIVACY_CONSENT_VERSION`（ack）は allowlist で残るため、PBI 05 の ack ガードが**再付与は止める**（＝同意なしで記録が再開する事故にはならない、安全側）。ただし利用者には理由の分からない再同意が要求される。
- **拒否カウンタの消失**: `getConsentDeniedCount()` が 0 を返す。3 回拒否して 30 日猶予に入っていたユーザーに、またモーダルが出る（ユーザー保護の後退）。
- **既に移行済みのプロファイルは救済が必要**: top-level が既に空なので、allowlist を直しても過去の移行で消えた分は戻らない。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 撤退済みプロファイルが設定移行を完了しても撤回履歴が読める
  Given 署名済みの withdrawn レコード（hasConsented:false + withdrawal + signature）が保存されている
  When  単一オブジェクト設定移行（migrateToSingleSettingsObject）が完了する
  Then  getConsentWithdrawalHistory は withdrawalDate を含む記録を返す
  And   getPrivacyConsent は hasConsented:false を返す

Scenario: 2. 拒否カウンタが移行を跨いで保持される
  Given 拒否カウンタが 3、最終拒否時刻が直近である
  When  単一オブジェクト設定移行が完了する
  Then  getConsentDeniedCount は 3 を返す
  And   shouldPromptForConsent は猶予規則に従って false を返す（30日以内）

Scenario: 3. 同意系キーはブロブへ移らない（回帰ガード）
  Given  top-level に privacy_consent / privacy_consent_denied_count / privacy_consent_last_denial_time がある
  When  単一オブジェクト設定移行が完了する
  Then  3 キーは top-level に残っている
  And   settings ブロブに privacy_consent 系キーは含まれない

Scenario: 4. 他の移行対象キーは従来どおり移動する（移行を殺さない）
  Given  top-level に obsidian_port のような通常の設定キーがある
  When  単一オブジェクト設定移行が完了する
  Then  obsidian_port は settings ブロブに入り、top-level から消える
  And   移行は completed として記録される

Scenario: 5. 既にブロブへ畳まれたプロファイルでも同意状態が正しく読める（救済）
  Given 過去の移行で settings ブロブにのみ privacy_consent（withdrawn）が入っており、top-level には無い
  When  拡張機能が起動して同意状態を判定する
  Then  撤回状態として扱われ、同意モーダルは再同意を求める（同意として扱われない）
  And   救済が行われる場合、top-level にレコードが復元されるか、ブロブ側の読み出しで一貫して解決される
```

## 受け入れ基準

- [ ] `migrateToSingleSettingsObject` の完了後も `privacy_consent` / `privacy_consent_denied_count` / `privacy_consent_last_denial_time` が top-level に残り、settings ブロブには入らない
- [ ] スキーマ移行の完了判定（`settings_migrated` が completed になる条件）が、allowlist 追加後も全プロファイルで到達する（allowlist 追加で「残っている移行対象キー」の判定が変わっても完了できる）
- [ ] 移行対象の他キー（例 `obsidian_port`）は従来どおりブロブへ移り、top-level から消える（移行そのものを殺さない）
- [ ] 既にブロブへ畳まれたプロファイルについて、(a) 救済するか (b) 救済しないかを**明示的に決めて記録**する。救済する場合は、同意状態の判定・撤回履歴・拒否カウンタの 3 つが一貫して読めることをテストで固定する
- [ ] `getConsentWithdrawalHistory()` が移行を跨いで `null` にならない
- [ ] `getConsentDeniedCount()` が移行を跨いで値を保持する
- [ ] 同意の署名検証（`buildSignaturePayload`）と同意版数比較（`PRIVACY_POLICY_VERSION`）の意味論を変えない
- [ ] `npm run validate` が緑。`settingsMigration` の既存テスト（`settingsMigration-completion-state.test.ts` / `settingsMigration-port-unify.test.ts` / `settingsBackupRestoreParity.test.ts`）が非退行

## テスト戦略

- **単体**: `migrateToSingleSettingsObject({ port })` に `InMemoryStoragePort` を渡し、同意系 3 キーが top-level に残ること・ブロブに入らないこと・他キーは移ることを固定。`getConsentWithdrawalHistory` / `getConsentDeniedCount` / `shouldPromptForConsent` を移行の前後で比較する。
- **統合**: 実際の起動順に近い形（移行 → 同意判定 → 撤回履歴の読み出し）を通す。`lifecycleHandlers` の `handleInstalled('update')` を実モジュールで通す既存の型（`src/background/handlers/__tests__/lifecycleHandlers-consentWithdrawal.test.ts`）を再利用できる。
- **E2E**: 不要（決定的な局所挙動）。ただし「既に移行済みのプロファイル」の救済を入れる場合は、owner が隔離プロファイルで「移行完了 → popup を開く → 再同意モーダルが出ない」ことを 1 回観測する。

## 実装メモ（実装者向け）

### 対象ファイルと該当箇所

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/storage/settingsMigration.ts` | 143-167 | `TOP_LEVEL_ONLY_KEYS`。同意系 3 キーが漏れている |
| `src/utils/storage/settingsMigration.ts` | 176-179 | `isMigratableStorageKey`。`STORAGE_KEY_VALUES` 全値が対象 |
| `src/utils/storage/settingsMigration.ts` | 313-315 / 319-328 / 363 | 収集 → ブロブへマージ → top-level から削除 |
| `src/utils/storage/settingsBackup.ts` | 8 | `STORAGE_KEY_VALUES` の定義（全 `StorageKeys` 値） |
| `src/utils/storage/privacyConsent.ts` | 95 / 207-212 / 338 / 459 | すべて top-level 直読み |
| `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts` | 138-149 | `legacyStorage()` fixture。同意系キーの seed を足す場所 |
| `src/utils/storage/__tests__/settingsMigration-port-unify.test.ts` | 141-160 | `InMemoryStoragePort` を渡す移行テストの型 |

### 最小変更の選択肢

1. **`TOP_LEVEL_ONLY_KEYS` に同意系 3 キーを追加する（推奨・主）**
   - allowlist のコメント自身が「所有モジュールが `chrome.storage.local` を直接読むキーを守る」と書いており、`privacy_consent` 系はその条件に完全に一致する。`PRIVACY_CONSENT_VERSION` が既に入っているのに本体と拒否カウンタが漏れていたのは単純な漏れと読める。
   - 副作用: 移行の「残っている移行対象キー」判定が変わるため、完了判定のテストを確認する。**既に移行済みのプロファイルは救済されない**（top-level は空のまま）。
2. **移行時に同意系キーだけ top-level へ復元する救済ステップを足す（選択肢 1 と併用）**
   - 既にブロブへ畳まれたプロファイル（＝今日までの全プロファイルの一部）を救う唯一の方法。ブロブを読める層（`settingsMigration` 自身）で行う。`privacy_consent` がブロブにあり top-level に無い場合に書き戻す。
   - 副作用: 既存プロファイルの storage を書き換える。冪等にし、「ブロブに無い / 既に top-level にある」場合は何もしない。ロールバックは「書き戻しを止める」だけで、書き戻した値は同意状態として正しいため害が出ない。
3. **同意モジュール側をブロブ対応にする（repository 経由の読み出し）**
   - 根本的だが、`privacyConsent.ts` は「@layer 1 — Layer 0 only」を宣言しており、`SettingsRepository`（同じ Layer 1）を import すると層の制約に触れる。seam を上位層から注入する設計変更になるため、単独では推奨しない。

**推奨: 1 を主、2 を併用。** 2 の救済を入れない場合は、受け入れ基準のとおり「救済しない」判断とその理由（既存プロファイルは再同意モーダル 1 回で回復するため許容）を完了記録に残す。

### 実装者向け注記 — 現状コードの確認（着手前に必ず実行）

```bash
# 同意系キーが移行対象かどうか（期待: consent / denied_count / last_denial = true, ack = false）
grep -n "TOP_LEVEL_ONLY_KEYS" -A 30 src/utils/storage/settingsMigration.ts
# 同意を読む側が全て top-level 直読みであること
grep -n "chrome.storage.local.get" src/utils/storage/privacyConsent.ts
```

**既実装ではない**（2026-10-19 に `migrateToSingleSettingsObject` を実走させ、top-level から消えることを実測済み）。

### 落とし穴

- **`InMemoryStoragePort` は `*_version` で終わるキーを数値の版数カウンタとして扱い、文字列値を捨てる**。`privacy_consent_version` は日付文字列なので、このポートに seed しても `get(null)` に出てこない（`InMemoryStoragePort.set` の分岐: 数値なら `versions`、`_version` 以外なら `store`、**文字列の `*_version` はどちらにも入らない**）。**この落とし穴を移行の欠陥と誤認しないこと**。ack の検証は `chrome.storage.local` のモック（`settingsMigration-completion-state.test.ts` の `harness`）で行う。ポート側の忠実性は別 PBI 候補として扱う。
- `TOP_LEVEL_ONLY_KEYS` への追加は**移行対象キーの集合を変える**。`settings_migrated` の完了判定（`legacyKeys` が空になったか）に影響しないか、`settingsMigration-completion-state.test.ts` の各境界テストで確認する。
- `settings` ブロブに既に同意レコードが入っているプロファイルでは、allowlist 追加後も top-level は空のまま。**救済を入れないと `getPrivacyConsent` は「未同意」を返し続ける**（症状は再同意モーダル。同意なしの記録再開にはならない）。
- 同意レコードは署名付き（`buildSignaturePayload`）なので、**ブロブから top-level へ戻すだけ**にして値を再生成しないこと（署名が壊れる）。
- `assignSettingValue` / 型（`Settings` / `StorageKey`）経由の代入と、`chrome.storage.local` への直接書き戻しでは経路が違う。救済は「移行の一部」として行うか「移行の外の一度きり」として行うかを決め、二重実行しても安全にすること。

### 着手前に潰すべき検証

owner 判断が 1 点だけある: **既にブロブへ畳まれたプロファイルを救済するか**（選択肢 2 を入れるか）。判断材料:
- 救済しない場合の実害は「移行直後に再同意モーダルが 1 回出る」＋「撤回履歴が読めない」。同意の実効性は PBI 05 の ack ガードで保たれる。
- 救済する場合のコストは storage 書き換え 1 回と冪等性のテスト。既に移行済みの全プロファイルに 1 度だけ走る。

### ロールバック手順

1. allowlist への追加は 1 行なので `git revert` で戻せる（同意系キーが再びブロブへ移るだけ。**値を壊さない**: 既に top-level にあるレコードは、次の移行でブロブへ畳まれる前に読める）。
2. 救済ステップを入れた場合、revert しても top-level に書き戻した値は同意状態として正しいため害はない（ブロブ側にも同じ値が残る。二重保持になるが、読み出しは top-level 優先で一貫する）。
3. revert 後に `npm run validate` で緑を確認し、監査上の verdict は「未修正に戻る」ため `pbi/00-INDEX.md` の状態も戻す。

## 見積もり

2.0 SP（🟡中）。内訳: allowlist 追加と完了判定の確認 = 0.3 / 移行後の読み出しテスト（単体・統合）= 0.7 / 救済ステップと冪等性のテスト = 0.7 / 既存 `settingsMigration` テストの追随 = 0.3。救済を入れない場合は 1.0 SP 相当。

## Definition of Done

- [ ] BDDシナリオ 1〜5 が自動テストで実装されパス（シナリオ 5 は救済するか否かの判断を明記したうえで）
- [ ] `npm run validate` が緑
- [ ] 既にブロブへ畳まれたプロファイルの扱い（救済する / しない）と、その理由が完了記録に残っている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`settingsMigration.ts` の `TOP_LEVEL_ONLY_KEYS` コメント、必要なら `dev-docs/LAYERS.md` の同意キー配置の記述）
- [ ] 完了時に `pbi/2026-10-18-05-*`（アーカイブ済み）の「残課題」から本 PBI へ参照を張り替える

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md` — 本 PBI を切り出した元 PBI（ack ガードが再付与を止める。完了記録の「残課題」に本件の詳細）
- `dev-docs/archived/pbi/2026-10-16-12-refactor-migration-port-unify.md` — 移行の port 統一。本 PBI はその移行対象キーの集合を触る
- `pbi/2026-10-18-04-fix-notification-consent-prestage.md` — 同じ consent lifecycle。`hasPrivacyConsent()` の読み出し前提が共通
