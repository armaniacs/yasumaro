# PBI: fail-open KEK チェーンと unwrap 失敗時の自己修復が、同意・エクスポート署名鍵を黙って失効させる問題の修正

## ユーザーストーリー

個人データ処理に同意し、設定・ログの署名付きバックアップを糧にしているユーザーとして、**ブラウザが KEK（鍵暗号化鍵）を失ったときでも、同意記録や以前のエクスポートが「理由を添えられずに黙って失効」にならないこと**がほしい、なぜなら privacy consent が `hasConsented:false` へ暗黙にリセットされると、ユーザーは同意が失効した理由の説明を受けられず GDPR Art.7 の説明義務（撤回・再同意の理由告知）を満たせず、さらに回転前に署名した設定/ログエクスポートが検証 hard-fail して輸入できず、バックアップが**静かに恒久的に読めなくなる**から。加えて暗号化鍵の失効はユーザーが良いか悪いか判断できる性質のものなので、「静かな再生成」ではなく「ユーザーに見える再同意/再設定フロー」として扱う必要がある。

## 優先度

- 順位: 15 / 25
- RICE: 750（Reach=100 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査15位。run-1 から持ち越し、run-2 で再検証された項目（verdict: `needs_validation`）。`durableKeyStore` は IndexedDB の不在・任意の例外を `null`/`false` に丸める（意図された fail-open 配管、`durableKeyStore.ts:21-24`）が、呼び出し側はこれを「新しいキーを生成する」のに読んでいる。KEK 候補チェーン（session `:179-214` → legacy local → durable IDB）が全滅すると新 KEK が生成・保存され（`hmacKeyStore.ts:224-245`）、既存のラップ済み署名鍵全てが孤児化する。unwrap 失敗側の2経路は分割していて、consent/notification の署名鍵は隔離＋再生成（`hmacKeyStore.ts:330-339`）する一方、settings/log エクスポート用の `HMAC_SECRET` は隔離なく上書きのみ（`encryptionSession.ts:922-926`）。結果: 保存済み privacy consent が `hasConsented:false` へ暗黙にリセットされ（`privacyConsent.ts:104`）、回転前の署名済み設定/ログエクスポートは輸入時に検証を hard-fail し（`settingsExportImport.ts:335-343` / `:731-740`）、bypass が無い。
  - -cohort（該当プロファイル）: KEK の session キャッシュが失われ、かつ `yasumaro-crypto` / `yasumaro-secret-crypto` の IndexedDB ストアが永続化しない環境（プライベートモード、ブラウザ再起動後の best-effort eviction、拡張機能 IDB の再採番）のプロファイル。加えて legacy local KEK も残っていない（移行済み）プロファイルが全候補を殺す。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（暗号鍵の失効・再同意・エクスポート互換性に関わるため、**HEK 回復時のユーザー体験設計が必要**。具体的には: ①`HMAC_SECRET` に隔離経路を追加すると、以後のすべての署名済みエクスポートが「どの鍵で署名されたか」を判定する余地を持ち、`encryptedExportCodec.ts:92` の検証契約と UI の失敗メッセージ（i18n）の意味が変わる。②consent 側を fail-closed（再同意プロンプト）に倒すと、同意モーダルの提示タイミングが `privacyConsent.ts:110` の版数判定経路と交差するため、PBI 05（migration 再付与阻止）と合わせて設計しないと二重プロンプトや再付与の復活が出る。③既存の「再生成して自己修復」挙動は**ブラウザ再起動で KEK を一度失った既存ユーザーを救う**役割も担っているため、単に fail-closed にすると復旧不能に見える。既存テスト `hmacKeyStoreRegeneration.test.ts` は隔離＋再生成を pin しており、`hmacKeyStoreChain.test.ts:58` は全候補空での新規生成を pin しているため、**期待値の書き換えが不可避**。加えて既に失効済みの端末では旧署名の復元手段が無い以上（マイグレーション的な救済は行わない）、「告知して再同意」の UX を新しく設計する必要がある)

## 背景（監査の出典）

security-audit run-2 の needs_validation リード（run-1 持ち越し）。fingerprint: `e24dc390002ac5bb3a808a15787462b0dd56584867f35d820db92c5c9b4a72dc`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` / `NEEDS-VALIDATION.md:156`〜「## 6. fail-open KEK chain + unwrap-failure self-heal silently rotate every HMAC signing key」）。

判定は `needs_validation`。run-2 での到達範囲の確認: durable IndexedDB KEK ストアはエビクション（eviction）を含む実際の永続ストアの損失にトリガを限定し、ページコンテキストからの到達性はソースから解消済み（`externally_connectable` なし、`web_accessible_resources` は `content-extractor.js` + `icon48.png` のみ → `wxt.config.ts:288`）。残る未検証事項は fail-open チェーン終端と unwrap 失敗 self-heal の2経路、およびブラウザ側の IDB 保持事実。

**再現経路（trace）**

1. `src/utils/crypto/durableKeyStore.ts:53-61` ― `loadDurableWrappingKey` は `storage` が無ければ `:55`、`get()` が例外を投げれば `:59` で `null` を返す。ヘッダコメント `:21-24` がこれを「呼び出し側は新しいキーを生成する fallback にする」契約と明記している（意図された fail-open）。
2. `src/utils/crypto/hmacKeyStore.ts:179-214` ― KEK 候補チェーン。session（`:180` 前後）→ legacy `localStored`（`:195-208`）→ durable IDB（`:209-213` で `loadDurableWrappingKey` を呼び、`null` なら `throw new Error('no durable KEK')`）。
3. `src/utils/crypto/hmacKeyStore.ts:216-222` ― 候補ループが全滅を飲む。`:224` のコメント「All candidates exhausted (fresh install or post-restart with no durable key): generate a new KEK」に続き、`:227` で `webcrypto.getRandomValues` で新 KEK を生成し `saveDurableWrappingKey` で保存する。**fresh install と「永続ストア喪失」を同一視している**のが本件の核心。
4. `src/utils/crypto/hmacKeyStore.ts:319-339` ― `getOrCreateWrappedHmacKeyLocked`。既存 envelope の unwrap に失敗すると `:331` で warn、`:333` で `${storageKey}${QUARANTINE_SUFFIX}`（`:89`）へ旧 envelope を隔離、`:335` で「HMAC key regenerated after unwrap failure; signatures made with the old key will no longer verify」を `CRYPTO_HMAC_FAILURE` で記録し、再生成へ落ちる。この経路は `getConsentHmacKey`（`:405`）と `getNotificationHmacKey`（`:414`）＝ `consentHmacSigner`（`:433`）/ `notificationHmacSigner`（`:424`）が使う。
5. `src/utils/storage/encryptionSession.ts:904-943` ― `getOrCreateHmacSecret` の unwrap 失敗 catch（`:919`）は `:922` で「Failed to unwrap HMAC secret, regenerating」を記録し、`:924-926` で新規 secret を生成してラップし直し、**隔離せずに `:926` で `HMAC_SECRET` を上書き**する（旧 envelope は痕跡を残さず消える）。`:918-921` のコメントは今でも「The KEK lives in chrome.storage.session」と書かれており、`durableKeyStore` 導入前の前提で**既に stale**。`:942` の `cachedHmacSecret` でプロセス内キャッシュも更新される。`exportHmacSigner`（`:956`）はこの関数を毎回解決するため、回転は即座に picking up される。
6. `src/utils/storage/privacyConsent.ts:94-105` ― `getPrivacyConsent` は署名検証に失敗すると `:104` で `{ hasConsented: false, needsReconsent: true, signatureInvalid: true }` を返す。**ユーザー向けの再同意プロンプトは原則出ない**（`:110-113` の版数不一致経路は `needsReconsent` を立てず、`signatureInvalid` は popup/background の UI 層で optional 扱い）。
7. `src/utils/settingsExportImport.ts:335-343`（暗号化エクスポート）と `:714-740`（平文エクスポート。`:731` の `verifier.verify` 失敗で `:740` `return null`）― 検証不一致は**無条件拒否**（`:738` コメント「VULN-009 fix: reject import unconditionally … Do not allow force-import」）。bypass は無い。

**既存テスト（現状 pin している挙動）**

- `src/utils/crypto/__tests__/hmacKeyStoreRegeneration.test.ts:46` ― 隔離＋再生成＋エラーコードログを pin。`:63` は正常 unwrap 時に隔離しないこと、`:72` は隔離が1世代だけ、`:85` は KEK 保存失敗時もキーを返す（fail-open）を pin。
- `src/utils/crypto/__tests__/hmacKeyStoreChain.test.ts:39` session 優先、`:51` durable fallback、`:58` 全候補空で新規 KEK 生成＋永続化を pin。
- `src/utils/crypto/__tests__/hmacKeyStoreRestart.test.ts` ― durable ストア経由の再起動経路。
- `src/utils/storage/__tests__/privacyConsentSignatureReset.test.ts:17` ― 署名検証失敗が `needsReconsent` + `signatureInvalid` を返すこと、`:36` は再同意で回復することを pin。
- `src/utils/__tests__/settingsExportImport-signature.test.ts` / `settingsExportImport.test.ts` ― 署名検証失敗で `null` を返すこと。

**監査側の blocker（着手前に潰すべき owner 確認）**

`findings.json.blockers[0]` _contractually_: 対象 Chromium/Edge/Firefox プロファイルで IndexedDB eviction / private-mode が `yasumaro-crypto` / `yasumaro-secret-crypto` ストアを実際に失うかどうかは、ソース外（ブラウザ/ストレージ保持）の決定的事実である。本 run は source-only 実行ポリシーで sandboxed 実行が利用できず、bounded な観測結果は確立できていない。**実装着手前に owner が `validation_plan.deployment` の手順で観測すること**（隔離テストプロファイル＋合成 fixture のみ。本番データ・生存標的の走査はしない）。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 永続 KEK ストアの喪失で privacy consent が暗黙にリセットされない
  Given ユーザーが現行版の privacy consent に同意済みで、consent 署名鍵がラップ済み envelope で保存されている
  And   ブラウザ再起動で session KEK キャッシュが失われ、yasumaro-crypto の IndexedDB ストアも永続化しない（eviction / private mode）
  When  拡張機能が KEK を解決する（getConsentHmacKey 相当）
  Then  システムは「永続ストアの喪失」と「初回インストール」を区別して扱い、
  And   ユーザーを名学生/@ 見える再同意フローへ誘導する（黙って hasConsented:false へ倒さない）
  And   同意記録自体は署名済みレコードとして保持され、後から再同意すれば以前の状態へ戻る

Scenario: 2. 回転前に署名済みの設定エクスポートが輸入できる or「失効した」ことを理由を添えて伝える
  Given ユーザーが KEK 喪失前的時点で署名済みの設定エクスポートファイルを持っている
  When  そのインポートを試行する
  Then  検証は通る（鍵の寿命をまたいで署名検証が成立する）か、
  And   不可解な失敗ではなく「このエクスポートの署名は失効済みの鍵で作成されているため輸入できません（再エクスポートしてください）」という具体的な理由を UI に表示する
  And   「無視して強制入力」する bypass は_integrity を壊すため追加しないが、
  And   「再エクスポートしてください」という回復手順が必ず提示される

Scenario: 3. HMAC_SECRET にも consent 鍵と同じ隔離経路がある（非対称を解消）
  Given getOrCreateHmacSecret の unwrap が KEK 喪失で失敗し、旧 wrapped envelope が HMAC_SECRET に残っている
  When  新しい secret を生成して永続化する
  Then  旧 envelope は consent/notification 鍵と同じ「-quarantine」経路へ退避され、
  And   上書き前に退避が必ず完了していること（storage.local.set の順序として pin する）
  And   退避失敗時も損失ipelines ではなく明示的なエラーとして観測できること（hmacKeyStore.ts:333 と同じ .catch(() => undefined) で黙殺しない）

Scenario: 4. 新規インストール（初回 ever）では KEK チェーン終端がそのまま新 KEK 生成になる（回帰ガード）
  Given どの KEK 候補も存在しない完全な新規プロファイル（envelope も consent も無い）
  When  KEK を解決する
  Then  新 KEK が生成・永続化され、既存挙動どおり例外を投げずに動作する
  And   「永続ストア喪失」のユーザー向け通知は出ない（初回は正常系）
```

## 受け入れ基準

- [ ] `durableKeyStore` が「永続ストアが無い / 破損 / エラー」を **null（= 新規生成）と判定できる情報と区別して**返せる（eviction と初回未設定を区別する。最小手段として `DurableKeyStorage`（`durableKeyStore.ts:34`）に存在判定/到達可否 probe を足すか、`loadDurableWrappingKey` の戻り値を `CryptoKey | null | 'absent-store'` のような判別可能 union にする）
- [ ] KEK チェーン終端（`hmacKeyStore.ts:224-245`）が、新規インストールと「永続ストア喪失」で **別経路を踏む**。ストア喪失側では静かに新 KEK を生成して既存 envelope を孤児化させず、ユーザー向けの再同意/再設定フロー（HEK 回復 UX）を起動する
- [ ] `getOrCreateHmacSecret`（`encryptionSession.ts:919-929`）に `hmacKeyStore.ts:333` と同じ隔離（`-quarantine`）経路が入り、**退避が上書き（`:926`）より先に完了する**ことがテストで pin される
- [ ] `HMAC_SECRET` の隔離失敗が `.catch(() => undefined)` で黙殺されない（`hmacKeyStore.ts:333` と同じでも、最低限は観測可能なログ/エラーコードが残る）
- [ ] privacy consent が、署名検証失敗で `hasConsented:false` へ倒れる際に **ユーザーが見る再同意経路へ必ず到達する**（`privacyConsent.ts:104` の `signatureInvalid` が UI 層で「表示するか否かの任意扱い」にならないこと。`src/popup/privacyConsentController.ts` / `privacySettingsPanel.ts` の `shouldPromptForConsent` 相当経路を確認・pin する）
- [ ] 署名検証失敗によるエクスポート輸入拒否（`settingsExportImport.ts:335-343` および `:731-740`）は、**理由が具体的なユーザー向けメッセージ**（どの鍵が失効したか / 再エクスポートが必要か）として表示され、i18n（ja/en 両方）に追加される。既存の「無条件拒否（integrity 保護）」自体は維持する
- [ ] 既存テストの期待値が本修正の挙動に合わせて**明示的に書き換えられ**、書き換えた理由が各テストにコメントで残る（`hmacKeyStoreRegeneration.test.ts:46` / `hmacKeyStoreChain.test.ts:58` / `privacyConsentSignatureReset.test.ts:17` / `settingsExportImport-signature.test.ts`）
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` が同内容で更新され、鍵失効時の同意リセットとエクスポート失効の扱いが記載される

## テスト戦略

- **単体**: `setDurableKeyStorageOverride`（`durableKeyStore.ts:41`、テスト専用 seam）で **throw を起こす fake** を注入し KEK ストア喪失を模す。その状態で `getOrCreateHmacSecret`（`encryptionSession.ts:904`）と consent 署名鍵取得（`hmacKeyStore.ts:405` 相当）を **それぞれ2回**呼び、(a) 回転が検知され隔離・再同意導線へ入ること、(b) `getPrivacyConsent` が `hasConsented:false` へ黙って倒れないこと、(c) **consent/notification 鍵には `-quarantine` 経路があるのに `HMAC_SECRET` には無い**という現状の非対称を Red として pin し、修正後は (c) が「両方にある」期待値へ書き換わることを確認する。加えて `storage.local.set` の**呼び出し順序**（隔離 → 上書き）を fake の set 実装で観測する。既存 `hmacKeyStoreRegeneration.test.ts` / `hmacKeyStoreChain.test.ts` / `hmacKeyStoreRestart.test.ts` の期待値を本修正に合わせて更新する。
- **統合**: `src/utils/settingsExportImport.ts` の HMAC 検証失敗経路（暗号化 `:335-343` / 平文 `:731-740`）。失効済み鍵で署名されたエクスポート（固定 nonce の合成署名を `HmacSigner` fake で生成）に対し、(a) 回復メッセージ（再エクスポート指示）が reasons 付きで返る、(b) integrity を壊す強制輸入は増えない、の2点。既存の `settingsExportImport-signature.test.ts` と同じ signer 注入の流儀（`ImportHmacVerifier`、`:110`）を手本にしてつなげる。
- **E2E**: owner 観測（隔離プロファイルでプライベートモード / クォータ evict を模し、同意状態とエクスポート輸入挙動を確認）。実測手順は `findings.json` の `validation_plan.deployment` に従い、Chromium / Edge / Firefox の各プロファイルでブラウザ再起動を挟んで `yasumaro-crypto` と `yasumaro-secret-crypto` の IDB ストアが残るか、保存済み consent がリセットするか、回転前エクスポートが検証を通るかを記録する（**観察のみ・破壊的操作なし**）。Playwright 側で可能な範囲は private context / storage clear 経由の再現に留め、実ブラウザの eviction 挙動は owner 手動確認として報告書に貼る。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/crypto/durableKeyStore.ts` | 21-24 | fail-open 契約コメント。「IndexedDB 不在・任意エラーは null/false、呼び出し側は新キー生成に fallback」 |
| `src/utils/crypto/durableKeyStore.ts` | 34 | `export type DurableKeyStorage = IdbKeyStorage`（テスト注入 seam の型） |
| `src/utils/crypto/durableKeyStore.ts` | 41-43 | `setDurableKeyStorageOverride`（テスト専用差し替え） |
| `src/utils/crypto/durableKeyStore.ts` | 51-61 | `loadDurableWrappingKey`。`:55` / `:59` で `null` を返す |
| `src/utils/crypto/durableKeyStore.ts` | 67-76 | `saveDurableWrappingKey`。`:70` / `:75` で `false`（保存失敗も fail-open） |
| `src/utils/crypto/hmacKeyStore.ts` | 89 | `QUARANTINE_SUFFIX = '-quarantine'` |
| `src/utils/crypto/hmacKeyStore.ts` | 179-214 | KEK 候補チェーン（session → legacy local → durable IDB）。`:209-213` が durable 呼び出し |
| `src/utils/crypto/hmacKeyStore.ts` | 216-222 | 候補ループ。全滅を握りつぶす |
| `src/utils/crypto/hmacKeyStore.ts` | 224-245 | **チェーン終端**。`:224` コメント、`:227` 新 KEK 生成、`:238-244` 保存失敗ログ |
| `src/utils/crypto/hmacKeyStore.ts` | 319-339 | `getOrCreateWrappedHmacKeyLocked`。`:331` warn、**`:333` 隔離 set**、`:335` 「signatures made with the old key will no longer verify」 |
| `src/utils/crypto/hmacKeyStore.ts` | 405 / 414 | `getConsentHmacKey` / `getNotificationHmacKey`（隔離経路を使う側） |
| `src/utils/crypto/hmacKeyStore.ts` | 424 / 433 | `notificationHmacSigner` / `consentHmacSigner` |
| `src/utils/storage/encryptionSession.ts` | 904-943 | `getOrCreateHmacSecret`。`:918-921` **stale コメント**（KEK は session にあるという旧前提）、`:922` ログ、`:924-926` 生成＋**隔離なし上書き**、`:942` キャッシュ更新 |
| `src/utils/storage/encryptionSession.ts` | 956 | `exportHmacSigner`（呼び出しごとに secret を解決するため回転が即反映） |
| `src/utils/storage/privacyConsent.ts` | 94-105 | 署名検証。`:104` `{hasConsented:false, needsReconsent:true, signatureInvalid:true}` |
| `src/utils/storage/privacyConsent.ts` | 108-115 | 版数一致判定（PBI 05 と交差する） |
| `src/utils/storage/privacyConsent.ts` | 163-165 | `hasPrivacyConsent` |
| `src/utils/settingsExportImport.ts` | 335-343 | 暗号化エクスポートの HMAC 不一致 → `return null` |
| `src/utils/settingsExportImport.ts` | 714-740 | 平文エクスポート。`:714` 署名無し拒否、`:730` verifier 解決、`:731-740` 検証失敗 `return null`（VULN-009 無条件拒否） |
| `src/utils/crypto/encryptedExportCodec.ts` | 92 | `verifyEncryptedExportHmac`（'mismatch' を返す検証契約） |
| `src/utils/crypto/__tests__/hmacKeyStoreRegeneration.test.ts` | 46 / 63 / 72 / 85 | 隔離＋再生成の pin |
| `src/utils/crypto/__tests__/hmacKeyStoreChain.test.ts` | 39 / 51 / 58 | 候補チェーン順・全滅時新規生成の pin |
| `src/utils/storage/__tests__/privacyConsentSignatureReset.test.ts` | 17 / 29 / 36 | 署名失敗 → `needsReconsent` の pin |
| `wxt.config.ts` | 288 | `web_accessible_resources` は `content-extractor.js` + `icon48.png` のみ（ページからの到達不可＝run-2 で到達性は解消済み） |

### 最小変更の選択肢

1. **KEK 失効を「静かな再生成」ではなく「ユーザーに見える再同意/再設定フロー」に変える（fail-closed）**
   `durableKeyStore.ts` に「ストア不在（= eviction / private mode）」と「エラー」を区別して返す手段（`DurableKeyStorage` に probe を足すのが最小）。`hmacKeyStore.ts:224-245` のチェーン終端が「ストア不在」のときだけ既存 wrapped envelope が残っているなら新 KEK を黙って生成せず、**鍵失効通知 + 再同意/再設定フロー**を起動する。コストは UX 設計（i18n ja/en）と UI 配線。**注**: HEK 回復 UX（master パスワードの再入力が要るのか、consent の再取得だけで足りるのか）は owner と詰める必要があり、ここが本 PBI の最大の未定部分。
2. **`HMAC_SECRET` にも consent 鍵と同じ隔離（quarantine）経路を与える**
   `encryptionSession.ts:919-929` に `hmacKeyStore.ts:333` と同じ `${storageKey}-quarantine` 退避を、退避→上書きの順で入れる。**これだけでも「旧 envelope が痕跡なく消える」事故は止まる**ので、1 の UX 設計に先行して最小 PR として切り出せる。副作用: `HMAC_SECRET-quarantine` キーが storage に残る（読み取りは無視されるので後方互換を壊さない）。FE 側は quarantine を読んで鍵の寿命判定に利用できる。
3. **`durableKeyStore` の「null/false = 新規生成」契約を見直し、eviction と初回未設定を区別する**
   `loadDurableWrappingKey` の戻り値を判別可能 union（`CryptoKey | null | 'absent-store'`）にし、呼び出し側が意味を決める。型変更は `hmacKeyStore.ts:209-213` の1呼び出し点と `saveDurableWrappingKey` の戻り値（`false` の意味も「保存失敗」であって「無かった」ではない）に伝播する。**1 の前提**であり、単独では挙動を変えない（型だけ変えて分岐しない）。

推奨: **2 を先に（独立 PR・低リスク）→ 3 → 1 の順**。2 だけでも「上書きで旧 envelope が消える」非対称は解消され、blast radius を抑えられる。1 は UX 設計（PBI 05・同意 modal 判定と Wiring）が要るため、owner 確認後に着手する。

### 着手前に潰すべき owner 確認（監査 blocker）

- **[必須] 対象ブラウザで KEK ストアが実際に失われるか**: `yasumaro-crypto` / `yasumaro-secret-crypto` の IDB ストアが、プライベートモード・ブラウザ再起動・クォータ evict のいずれで**永続化しない**かを、隔離プロファイル（合成 fixture のみ）で観測する（`validation_plan.deployment`）。**失われないなら**本 PBI の Reach 100 は過大であり、RICE スコアと優先順位を見直すこと。
- **[必須] bounded local 再現**: sandbox 可能な環境で、`DurableKeyStorage` override に throw を仕込んだ fake + mock `chrome.storage` で `getOrCreateHmacSecret` と consent 署名鍵取得を2回呼び、(a) 静かな回転、(b) `HMAC_SECRET` に隔離が無い非対称、(c) consent が `hasConsented:false` へ倒れること、を Red として観測する（`validation_plan.local`）。再現できなければ実装着手を止め、`findings.json` の verdict を更新すること。
- **[推奨] HEK 回復 UX の決定**: KEK 喪失時に master パスワードの再入力を要求するのか、consent の再取得だけで足りるのか。`EncryptionSession` 側の既存 HEK 導線と合わせると同時に決める（owner 判断）。

### 落とし穴

- **`encryptionSession.ts:918-921` のコメントは今や誤り**。durableKeyStore 導入により KEK は session 限定ではない。この stale な前提が「再生成すれば平気」という自己修復の妥当性を支えているため、コメント修正は**修正の前提条件**（根拠の訂正）であり、付随するコメント修正だけにしない。
- **`getOrCreateHmacSecret` の `cachedHmacSecret`（`:942`）** はモジュールスコープのプロセス内キャッシュ。サービスワーカー再起動やテストではリセットされるため、単体テストで**「2回呼んだから同じ鍵」とは限らない**。テストでは cache を明示的に無効化/再設定すること。
- **「無条件拒否」の VULN-009 を緩めない**: `settingsExportImport.ts:738-740` のコメントが明確に言う通り、integrity チェックをバイパスする force-import を復活させない。UX 側で「再エクスポートしてください」を案内するのが正解で、「確認ダイアログで強制入力」は不可。
- **PBI 05 との交差**: `privacyConsent.ts:110` の `needsReconsent = !versionMatch && data.hasConsented === true` は、署名失敗経路（`:104`）と別系統で `needsReconsent` を立てる。両者を一本化しないと二重プロンプト、または片方の握り潰しが発生する。
- **既存テストの期待値書き換えが不可避**: `hmacKeyStoreChain.test.ts:58`「全候補空で新規 KEK を生成」を単純に fail-closed にすると、**新規インストールが壊れる**。シナリオ 4 の回帰ガードを必ず残すこと。
- **i18n**: 新規ユーザー向けメッセージは `_locales/ja/messages.json` と `en` の**両方**に追加する（片言語だけだと validate が落ちる）。

### ロールバック手順

1. 変更を `src/utils/crypto/` と `src/utils/storage/` の暗号関連モジュール（＋テスト・i18n）に閉じ込め、**storage スキーマの破壊的変更を伴わない**ようにする。`-quarantine` キーは読み取りを伴わない追加キーにして、ロールバック後も無害（既存フィクスチャを壊さない）。
2. ロールバック: 修正コミットを `git revert`（または reset）し、`npm run validate` で緑を確認。ロールバックは「静かな再生成」という**修正前の挙動**に戻るので、それ以外の副作用（同意記録の破壊・旧署名の消失）は出さない。
3. すでにキーが失効済みの端末では、旧署名済みレコードを**復元する手段はロールバックで戻らない**（鍵は既に失われている）。その旨をリリースノート/Issue に明記し、必要なら該当ユーザー向けの案内（再エクスポート）を別途手配する。
4. ロールバック後も再現手順（`validation_plan.local`）は実行可能なまま残し、監査 fingerprint `e24dc390002ac5bb3a808a15787462b0dd56584867f35d820db92c5c9b4a72dc` の verdict は `needs_validation` のまま据え置き、run-3 以降の監査に再提示できるようにする。

## 見積もり

2.0 SP（🟡中。選択肢 2 の隔離追加＋選択肢 3 の型/契約見直し＋選択肢 1 の UX 配線、i18n ja/en、既存テスト期待値の書き換え（4ファイル）、owner blocker 検証が先行。1 の UX 設計が owner 判断待ちで幅が変わるため、1 を切り離して 1.0 SP の先行 PR にできる構成をしている）

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（シナリオ 1〜4 すべて）
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `e24dc390002ac5bb3a808a15787462b0dd56584867f35d820db92c5c9b4a72dc` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`public/PRIVACY.md` / `docs/PRIVACY.md` を同内容で更新）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）／Reach 下方修正
- 決め手: KEK ストアを失わせた 2 回目の呼び出しで **HMAC secret が黙って回転**し、`hmac_secret-quarantine` が存在しない（隔離なし）。consent 鍵経路には `privacy-consent-signature-key-quarantine` があり**非対称を実証**。`getPrivacyConsent()` は `{hasConsented:false, needsReconsent:true, signatureInvalid:true}` にリセットされる
- 影響: コード上の欠陥は確定。ただし **yasumaro は `unlimitedStorage` を付与済み**（`wxt.config.ts:231`）で、Chrome/Firefox とも eviction が免除されるため、失われる経路はプライベートモード・拡張削除・プロファイル削除に限られる。**Reach 100→30（RICE 750→150）**。選択肢 2（HMAC_SECRET の隔離）のみを先行させる低リスク PR が有効

## 関連

- `pbi/00-INDEX.md`
- consent lifecycle 領域の PBI 05（migration 再付与阻止。2026-10-19 完了・アーカイブ済み: `dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md` ― `needsReconsent` 判定が交差する）
- 監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` / `NEEDS-VALIDATION.md:156`〜）
- PBI 2026-09-14-09（durableKeyStore 導入の元 PBI。ヘッダコメントが本件の前提を記述している）

## 実装記録（2026-10-21・owner 判断込みで完了）

- 選択肢 2（HMAC_SECRET の隔離）: **実装済み**（先行 PR）commit `ef36ce32`。encryptionSession の getOrCreateHmacSecret に `${storageKey}-quarantine` 退避経路が入り、退避→上書きの順序を pin（専用テスト 4 件）
- 選択肢 3（durableKeyStore の判別 union 化）: **実装済み** PBI 2026-10-21-10（commit `bfdfec18`）。loadDurableWrappingKey の戻り値を DurableWrappingKeyOutcome（absent / failure + error / loaded）に変更、catch での丸めを排除、唯一の production 呼び出し点（hmacKeyStore KEK 候補チェーン終端）で failure 理由を safeLog → logError（CRYPTO_HMAC_FAILURE）で観測可能に。挙動不変・観測性のみ
- 選択肢 1（HEK 回復 UX）: owner 判断（2026-10-21）で **consent 再同意流用のみ** と裁定。既存の signatureInvalid → needsReconsent → shouldPromptForConsent → モーダル経路（privacyConsent.ts:522-546 → privacyConsentController.ts:53-63）で説明と再同意が完結し、追加 UI は不要。master password による KEK 再導出（deriveHmacWrappingKey）は production 呼び出し元 0 件で未配線のため、実装不採用
- 受け入れ基準の対応: シナリオ 1（consent 暗黙リセット保護）は既存の再同意経路で到達、シナリオ 2（エクスポート拒否の理由提示）は VULN-009 の無条件拒否を維持するため変更なし、シナリオ 3（HMAC_SECRET 隔離）は選択肢 2 で実装済み、シナリオ 4（fresh install 回帰）は hmacKeyStoreChain / Regeneration / Restart / Concurrency の既存 pin が PBI 10 で無改変のまま全 green を実証
- 検証: PBI 10 の 267 テスト全 green、validate:fast green、type-check 通過。PRIVACY.md は挙動不変・観測性のみの変更のため更新なし
- 残置（owner 手動確認）: 監査 blocker の IDB eviction 実機観測（unlimitedStorage 付与済みのため eviction 免除。失われる経路はプライベートモード・拡張削除・プロファイル削除に限られる）
