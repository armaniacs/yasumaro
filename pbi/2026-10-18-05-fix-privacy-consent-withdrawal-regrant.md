# PBI: 同意撤回後もレガシー同意マイグレーションが同意を自動再付与する問題の修正（GDPR Art.7 撤回の保全）

## ユーザーストーリー

個人データ処理に同意したユーザーとして、**一度撤回した同意が拡張機能の更新や popup を開くたびに勝手に復活しないこと**がほしい、なぜなら GDPR Art.7 は data subject の撤回を理由なしに妨げられないと定め、同意のないまま閲覧履歴の記録と AI 処理が再開され、加えて同意モーダルが出てこないため「同意していないことに気づけない」= 再訪 thickness（再訪する経路）がなくなるから。

## 優先度

- 順位: 05 / 25
- RICE: 4800（Reach=400 / Impact=3 / Confidence=100% / Effort=0.3）
- 根拠: 監査5位。`migrateLegacyPrivacyConsent` の `hasUsedPrivacyFeatures` ゲートが「継続中の設定状態（`master_password_enabled`、`privacy_mode`、`pii_confirmation_ui` の top-level 残存）」を「consent 以前の初回使用の証拠」と誤認し、`hasAlreadyConsented` は署名済み withdrawn レコード（`hasConsented:false` + `withdrawal`）と never-consented を区別しない。よって署名済み撤回が `chrome.runtime.onInstalled` update と popup の consent-modal チェックごとに上書きされ（`hasConsented:true` を署名保存）、GDPR Art.7 の撤回が破壊され同意なしの記録・AI 処理が再開する。しかも再付与は consent modal も抑止するため再訪 thicknesses がない。
  - -cohort（該当プロファイル）: master パスワード有効中（top-level `master_password_enabled === true` が残存）、または単一オブジェクト移行未完了で scatter key（`privacy_mode` / `pii_confirmation_ui`）が残存するプロファイル。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（GDPR 撤回の実効性に関わるため、fixture 変更時の `signAndStoreConsent` / 同意版数互換を慎重に扱う。既存テスト `migrateLegacyPrivacyConsent` は各 evidence key で grant を pin しており、ゲート修正により期待値が書き換わる可能性があるため、`hasConsented:false` を pin する新規テストの追加が必要。既存ユーザーで「本来は migration 済みの，却被 withdrawal レコードにより誤って skip される」新たな取りこぼし（under-grant）も発生しうるため、両方向のテストが必要）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `privacyConsent.migrateLegacyPrivacyConsent::withdrawal-regrant-legacy-evidence-keys`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/

**再現経路（trace）**

1. `src/background/handlers/lifecycleHandlers.ts:75` — `handleInstalled('update')` が拡張機能更新ごとに `migrateLegacyPrivacyConsent()` を呼ぶ。popup 側の兄弟経路 `src/popup/privacyConsentController.ts:57` → `shouldPromptForConsent` → `privacyConsent.ts:450` も同意モーダル判定ごとに同じ migration を再実行する。
2. `src/utils/storage/privacyConsent.ts:195` — `hasAlreadyConsented` は署名済み withdrawn レコード（`{hasConsented:false, withdrawal, signature}`）に対して false。`:200-202` の早期 return は「撤回」と「一度も同意していない」を区別しない。
3. `src/utils/storage/privacyConsent.ts:205` — `hasUsedPrivacyFeatures` は top-level `chrome.storage.local` を直接読む。`privacy_mode` / `pii_confirmation_ui` は単一オブジェクト設定移行が完了するまで残存し（`settingsMigration.ts:143-167` はどちらのキーも除外していない）、`master_password_enabled === true` は master パスワード設定後に top-level に残る。
4. `src/utils/storage/privacyConsent.ts:211` — `savePrivacyConsent()` → `signAndStoreConsent`（`:62-67`）が `StorageKeys.PRIVACY_CONSENT` を署名付き `{hasConsented:true, consentVersion:'2026-09-08'}` で上書きし、withdrawal レコード（および `withdrawal` フィールド）を破壊する（`getConsentWithdrawalHistory` `:280-287` は以降 null）。
5. `src/utils/storage/privacyConsent.ts:163` — `hasPrivacyConsent()` が true を返し、記録 / AI 機能が同意なしで再開。`shouldPromptForConsent`（`:449-460`）も false を返して consent modal を二度と出さない。

**cohort が持続する理由（evidence）**

- `src/utils/storage/encryptionSession.ts:537` — master パスワード設定時に top-level へ `MASTER_PASSWORD_ENABLED: true` を直接書く。本番コードが削除するのは無効化パスのみ（`DISABLE_REMOVED_KEYS` `:355-360`、削除は `:880`）。つまり master パスワード有効中はセッションをまたいでも証跡が残る。
- `src/utils/storage/settingsMigration.ts:143` — `TOP_LEVEL_ONLY_KEYS` は keyring / consent-version / trust 系を除外するが `master_password_enabled` / `privacy_mode` / `pii_confirmation_ui` は除外していないため、pending / partial 状態のプロファイルでは散在コピーがそのまま残る。
- `src/utils/storage/privacyConsent.ts:253` — `withdrawPrivacyConsent` は署名済み withdrawn レコードを書くが、evidence キー（`disableNavTrail` のみ `:264-268`）を消さないため、撤回後もゲートが true のまま残る。
- `src/popup/__tests__/privacyConsent.test.ts:261` — 既存テストは各 evidence key で migration grant を pin するが、「withdrawn consent + evidence key」ケースが存在しないため、再付与は pin されていない挙動。

**監査側の blocker（着手前に潰すべき検証）**

needs_validation の bounded local 再現は未実行（source-only 実行ポリシーによりビルド / テスト / 対象ソースを import する node スクリプトが禁止されていた）。`validation_plan.local` が定める bounded な再現を**実装着手前に**通すこと: testDir の vitest + mock chrome で ① `withdrawPrivacyConsent()` → ② `chrome.storage.local['master_password_enabled']=true` → ③ `migrateLegacyPrivacyConsent()` の連鎖で、再現時は `hasConsented` が true へ戻る／`getConsentWithdrawalHistory()` が null になることを確認し、修正後は withdrawal レコード（または migration-spent マーカー）によって migration が no-op になり同意が撤回状態のままであることを確認する。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. レガシー同意マイグレーション（正常系・後方互換）
  Given 署名済みで同意済みのレコード（hasConsented:true / consentVersion: 現行）がある
  When  拡張機能が更新され migrateLegacyPrivacyConsent が走る
  Then  関数は false を返し
  And   同意レコードは書き換えられない

Scenario: 2. 署名済み撤回 + top-level 証跡キーで再付与されない（update 経路）
  Given ユーザーが同意を撤回しており、署名済み withdrawn レコード（hasConsented:false + withdrawal + signature）が保存されている
  And   top-level に master_password_enabled=true が残っている（master パスワード有効中のプロファイル）
  When  拡張機能の更新で chrome.runtime.onInstalled(update) が発火し migrateLegacyPrivacyConsent が走る
  Then  関数は false を返し、同意の再付与（savePrivacyConsent 呼び出し）は行われない
  And   hasPrivacyConsent は false のまま
  And   getConsentWithdrawalHistory は withdrawal 履歴を保持したまま null にならない
  And   撤回済みユーザーに対して同意は記録・AI 処理の結果として扱われない

Scenario: 3. 署名済み撤回 + consent-modal チェックで再付与されない（popup 経路）
  Given 署名済み withdrawn レコードがあり、top-level に privacy_mode または pii_confirmation_ui（単一オブジェクト移行未完了の scatter key）が残っている
  When  ユーザーが popup を開き shouldPromptForConsent が走る
  Then  再付与は行われず、同意状態は撤回のまま維持される
  And   同意モーダルは再付与によって抑制されない（撤回方針に沿った判定になる）

Scenario: 4. withdrawn レコードが無い旧来プロファイルは従来どおり grant する（回帰ガード）
  Given 同意レコードが未設定（never-consented）であり、evidence キー（master_password_enabled / privacy_mode / pii_confirmation_ui）のいずれかが存在する
  When  migrateLegacyPrivacyConsent が走る
  Then  関数は true を返し、署名付き hasConsented:true レコードが保存される
  And   既存 fixture の期待値（evidence キーごとの grant）が維持される
```

## 受け入れ基準

- [ ] 署名済み withdrawn レコード（`hasConsented:false` + `withdrawal`）が存在するとき、`migrateLegacyPrivacyConsent` は no-op となり、`hasConsented:true` を書き込まない
- [ ] `withdrawPrivacyConsent` 実行後に top-level evidence キー（`master_password_enabled` / `privacy_mode` / `pii_confirmation_ui`）が残っていても、update 経路・popup consent-modal 経路のどちらでも撤回状態が保持される
- [ ] `getConsentWithdrawalHistory()` が再付与後も `null` にならない（withdrawal フィールドが破壊されない）
- [ ] withdrawn レコードが無い never-consented プロファイルでは、既存 fixture の期待どおり evidence キーの存在を根拠に grant する（移行を殺さない）
- [ ] `getPrivacyConsent` の既存意味論（`needsReconsent` / `signatureInvalid` / ポリシー版数比較）を壊さない — 特に `PRIVACY_POLICY_VERSION` 不一致で再同意が必要なケースが migration によって握り潰されない
- [ ] `signAndStoreConsent` の署名ペイロード互換を壊さない（`withdrawal` フィールドの追加・判定が署名の検証結果に影響しない。`buildSignaturePayload` のキー列挙は変更しないか、変更する場合は既存署名済みレコードが検証を通ることを確認）
- [ ] `src/popup/__tests__/privacyConsent.test.ts` に「withdrawn + evidence key」ケース（update 経路 / popup 経路 / never-consented 回帰ガード）が追加され、`npm run validate` が緑
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` の撤回（withdrawal）の説明が、本修正の挙動と矛盾しないことを確認・同期する

## テスト戦略

- **単体**: `withdrawPrivacyConsent` → 証跡キー設定（`master_password_enabled=true` / `privacy_mode` / `pii_confirmation_ui`）→ `migrateLegacyPrivacyConsent` の連鎖。既存 `src/popup/__tests__/privacyConsent.test.ts` の `describe('migrateLegacyPrivacyConsent')`（`:261`〜）に「withdrawn + evidence key」ケースが無い（`:274`〜`:298` は各 evidence key で grant を pin しているだけ）。追加するケース: (a) withdrawn + `master_password_enabled=true` → false / hasConsented false / withdrawal 保持、(b) withdrawn + `privacy_mode` / `pii_confirmation_ui` → 同様、(c) never-consented + evidence key → true（既存期待値を維持）、(d) 署名検証失敗（signatureInvalid）系の既存ケース非退行。
- **統合**: popup `privacyConsentController.ts:53-63` の `initPrivacyConsent` → `shouldPromptForConsent` 呼び出し経路、および background `lifecycleHandlers.ts:74-83` の `handleInstalled('update')` → `migrateLegacyPrivacyConsent` 経路。両方とも「移行が再付与しない」ことを storage モック経由で固定する。
- **E2E**: 実画面で マスターパスワードを有効化 → ダッシュボードから同意を撤回 → 拡張機能をリロード（update 事象）／ popup を開き直す → 同意バッジ・記録状態が戻らない（同意复活なし）、同意モーダル判定が撤回方針に沿っていることを確認（`validation_plan.deployment` の owner-observed 手順）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/storage/privacyConsent.ts` | 183–230 | `migrateLegacyPrivacyConsent`。migration-spent マーカー無し・撤回非認識 |
| `src/utils/storage/privacyConsent.ts` | 195–202 | `hasAlreadyConsented`。withdrawn レコードと never-consented を区別しない早期 return |
| `src/utils/storage/privacyConsent.ts` | 205–208 | `hasUsedPrivacyFeatures`。継続中の設定状態を「consent 以前の初回使用の証拠」として再読 |
| `src/utils/storage/privacyConsent.ts` | 211 | `savePrivacyConsent()` による再付与（`signAndStoreConsent` `:62-67` 経由で signed `hasConsented:true` を保存） |
| `src/utils/storage/privacyConsent.ts` | 242–276 | `withdrawPrivacyConsent`。署名済み withdrawn レコードを書くが evidence キーは消さない |
| `src/utils/storage/privacyConsent.ts` | 280–287 | `getConsentWithdrawalHistory`。withdrawal フィールドが消えると null |
| `src/utils/storage/privacyConsent.ts` | 449–474 | `shouldPromptForConsent`。`:450` で migration を再実行し、再付与後は modal も出ない |
| `src/utils/storage/encryptionSession.ts` | 536–542 | master パスワード設定時に top-level `MASTER_PASSWORD_ENABLED: true` を書く |
| `src/utils/storage/encryptionSession.ts` | 355–360 / 880 | `DISABLE_REMOVED_KEYS`（削除は master パスワード無効化パスのみ） |
| `src/utils/storage/settingsMigration.ts` | 143–167 | `TOP_LEVEL_ONLY_KEYS`。`master_password_enabled` / `privacy_mode` / `pii_confirmation_ui` は除外されず scatter key が残存 |
| `src/popup/privacyConsentController.ts` | 53–63 | `initPrivacyConsent` → `shouldPromptForConsent`（popup 側の再実行経路） |
| `src/background/handlers/lifecycleHandlers.ts` | 74–83 | `handleInstalled('update')` → `migrateLegacyPrivacyConsent` |
| `src/popup/__tests__/privacyConsent.test.ts` | 261–311 | `describe('migrateLegacyPrivacyConsent')`。withdrawn ケース不在 |

### 最小変更の選択肢

1. **signed withdrawal レコード（`withdrawal` フィールドあり）を「撤回済み」として識別**し、`migrateLegacyPrivacyConsent` の冒頭のガードで no-op にする。`hasAlreadyConsented` と同じ storage スナップショット（`:186-191`）を既に取っているため、追加の storage 読み込みなしで判定できる。最小差分で GDPR 撤回を直接守る。
2. **migration-spent マーカーを導入**し、一度実行したら二度と発火させない（例: `StorageKeys` に legacy-migration 完了ビットを持つ、または withdrawal レコードに migration 済みフラグを載せる）。ただし本 Findings の cohort は「master パスワード有効中」で永続するため、マーカーだけでは「初回使用の証拠」を誤認した根本は残る（ゲート自体が残る点に注意）。
3. **`hasUsedPrivacyFeatures` を「継続中の設定状態」ではなく「移行元の忽然存在の証跡キー」に再定義**する。例えば `privacy_mode` / `pii_confirmation_ui` のみを証跡とし、`master_password_enabled` を証跡から外す、または「そのキーが今回初めて作られた」ことを追加条件にする。cohort の主因（master パスワード有効中）を直接潰すが、判定ロジックが複雑化し、将来の証跡キー追加時に同種の誤認を再導入しやすい。

いずれもモジュール境界の互換（既存 `consentVersion` 比較、`needsReconsent` 判定）を壊さないこと。推奨は **1 を主、3 の「`master_password_enabled` を証跡から外す」判断を副**として、2 は必要な場合のみ（例: 「grant 済みだが signed レコードが壊れた」ケースの救済）とする。

### 着手前に潰すべき検証（監査 blocker）

needs_validation の bounded local 再現（`validation_plan.local`）を先に通すこと。testDir の vitest + mock chrome で ① `withdrawPrivacyConsent()`、② `chrome.storage.local['master_password_enabled']=true`、③ `migrateLegacyPrivacyConsent()` の連鎖を Red として確認し、`hasConsented` が true へ戻る／`getConsentWithdrawalHistory()` が null になることを観察する。これが再現できなければ実装着手を止め、run-2 の findings.json を verdict 更新すること（confidence 100% の裏付け）。

### 落とし穴

- ゲートを単純に「`hasAlreadyConsented` が false なら skip」にするだけでは、**never-consented だが evidence キーがある旧来プロファイルの grant を殺す**（シナリオ 4 の回帰）。既存 fixture（`:274`–`:298`）が壊れるため、シナリオ 4 の回帰ガードを必ず残すこと。
- `signatureInvalid`（HMAC キー再生成で署名検証失敗した）レコードは `getPrivacyConsent` では `hasConsented:false, needsReconsent:true` になる。migration がこれを grant してよいかは現行挙動との整合を明示的に決める（skip 推奨。署名検証失敗＝同意状態の信頼性喪失）。
- `withdrawal` フィールドは `buildSignaturePayload`（`:50-57`）の署名対象に含まれるため、判定ロジックで withdrawal を書き換えると署名検証が壊れる。**新しい判定は既存レコードを読むだけ、書き換えない**こと。
- `TOP_LEVEL_ONLY_KEYS`（`settingsMigration.ts:143`）に証跡キーを追加して「上書きで回避する」案は、所有者が top-level を直接読む別モジュールとの不整合を招くため、採らない。
- 影響範囲は consent lifecycle 全体: `privacySettingsPanel.ts:57`（撤回 UI）、`requireConsent`（`:172`）、`shouldPromptForConsent` の 30 日猶予（`:460-470`）。修正後は「撤回済みだが猶予カウント logic に巻き戻される」経路がないか確認する。

### ロールバック手順

1. 変更は `src/utils/storage/privacyConsent.ts`（+テスト）に閉じ込め、`privacyConsent.ts` 以外の storage スキーマ変更を伴わないようにする（可能なら）。
2. ロールバック: 本ブランチを `git revert`（または修正コミットを reset）し、`npm run validate` で緑を確認。修正前の挙動に戻るだけで、storage に残る追加キー（migration-spent マーカーを使う場合）は読み取り無視される設計にし、後方互換を壊さない。
3. すでに本番列入済みの migration-spent マーカーを持つプロファイルは、ロールバック後も「grant 再発火」する挙動に戻るが、既存 signed レコードは壊していない（withdrawal フィールドを新たに書き足すこともない）ため、ロールバックは追加の損害を出さないこと。
4. ロールバック後も再現手順（validation_plan.local）は実行可能なまま残し、監査 fingerprint（`privacyConsent.migrateLegacyPrivacyConsent::withdrawal-regrant-legacy-evidence-keys`）の verdict を `needs_validation` のまま据え置く。

## 見積もり

3.0 SP（🟡中。判定ロジック 1 箇所の修正＋BDD 4 シナリオの単体 / 統合 / E2E テスト追加＋PRIVACY.md 同期。ブロッカー検証が先）

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（シナリオ 1〜4 すべて）
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `privacyConsent.migrateLegacyPrivacyConsent::withdrawal-regrant-legacy-evidence-keys` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`public/PRIVACY.md` / `docs/PRIVACY.md` の同内容 plates も更新）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: 同意 → 撤回（`hasConsented:false`・withdrawalHistory 非 null を確認）→ `master_password_enabled=true` → `migrateLegacyPrivacyConsent()` で **`hasConsented:true` に再付与、withdrawal フィールド消失、`getConsentWithdrawalHistory(): null`**
- 影響: GDPR Art.7 の撤回破壊が実測で確定。RICE は旧表の計算誤りを訂正して 4000（実質 2 位相当へ上昇）

## 関連

- `pbi/00-INDEX.md`
- consent lifecycle 領域の PBI 04（通知 Save の同意ゲート）と合わせて検証
- 監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` / `NEEDS-VALIDATION.md:565`〜）