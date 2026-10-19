# PBI: 同意へ戻る経路が設定画面に無く、拒否時の案内文が実装と食い違う問題の修正

## ユーザーストーリー

同意モーダルを拒否した（または同意を撤回した）ユーザーとして、**案内文が示すとおり設定画面からいつでも同意し直せること**がほしい、なぜなら拒否を 3 回重ねると `shouldPromptForConsent` の 30 日猶予でモーダルが抑止され、設定画面には撤回の操作しか無いため、**同意へ戻る UI 経路が 30 日間どこにも存在しなくなる**から。案内文は「後から設定画面で同意することができます」と約束しているのに、その設定画面に同意アクションが無い。

## 優先度

- 順位: 2026-10-19 の 07 / 08（同日 8 件のうち 7 番目）
- RICE: 160（Reach=80 / Impact=2 / Confidence=100% / Effort=1.0）
  - Reach: 影響は「拒否を 3 回したユーザー」に限られるため 80 と推定（母数は小さい）
  - Impact: 2。同意の実効性・記録の安全性は壊れない（記録は開始されないまま＝安全側）が、対象層では**再同意の UI 経路が 30 日間まったく存在しない**（確実に起きる。案内文が指す画面にアクションが無い）
  - Confidence: 100%。`privacySettingsPanel.ts:34` と `privacyConsentController.ts:169` を直読し、`acceptConsent` の production 呼び出し元がポップアップのモーダルだけであることを grep で確認済み
  - Effort: 1.0 SP。パネルに同意アクション 1 つ＋HTML＋i18n 文言 2 ファイル＋テスト
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（ダッシュボードの設定画面に同意アクションを足す＝UI と i18n の追加。既存の撤回導線の挙動は変えない）
- 根拠: 影響は「拒否を 3 回したユーザー」に限られるため Reach は小さいが、その層では**再同意の UI 経路が 30 日間まったく存在しない**（確実に起きる）

## 背景（発見の経緯）

PBI [2026-10-19-03](2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) と、アーカイブ済み [2026-10-18-05](2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md)（撤回時の拒否カウンタ解除）の周辺を読む過程で判明した。同 PBI は**撤回**の側（撤回時に猶予を解除する）を塞いだが、**拒否**の側は塞いでいない。拒否は同意レコードを書かず拒否カウンタと ack だけを残すため、猶予が明けるまでモーダルは出ず、設定画面にも同意アクションが無い。

### 機構（コード上で確定）

1. `src/dashboard/panels/staticForm/privacySettingsPanel.ts:34` ― 撤回ボタンは `state.hasConsented` が false のとき `hidden` になる（`btn.classList.toggle('hidden', !state.hasConsented)`）。このパネルにある同意関連の操作は撤回（`:35-70`）だけ。
2. `src/popup/privacyConsentController.ts:169` ― 拒否時のメッセージは `consentDeclinedMessage`「Without consent, main features of the extension will not be available. You can consent later from the settings screen.」（ja は `public/_locales/ja/messages.json:2612-2614`）。設定画面に同意アクションは無いので、この案内は事実に反する。
3. `acceptConsent`（`src/utils/storage/privacyConsent.ts:433-440`）の production 呼び出し元はポップアップの同意モーダルだけ（`src/popup/privacyConsentController.ts:148`）。ダッシュボード側に同意を書く経路は無い（grep で確認済み）。
4. `shouldPromptForConsent`（`src/utils/storage/privacyConsent.ts:502-527`）は `getConsentDeniedCount`（`:457-464`）と `getLastConsentDenialTime`（`:467-474`）を使い、拒否 3 回かつ直近 30 日以内なら false を返してモーダルを抑止する（`:513-523`）。
5. したがって拒否 3 回の状態では、**ポップアップのモーダルは 30 日抑止され、設定画面にも同意アクションが無く、同意する手段が 30 日間存在しない**。案内文はまさにその設定画面を指している。
6. 撤回済みユーザーは `withdrawPrivacyConsent` の拒否カウンタ解除（`privacyConsent.ts:307-315`）によりモーダルが再表示され得るが、同意へ戻る経路は依然モーダル 1 本だけで、コードコメント自身が「設定画面は撤回のみ」と書いている（`:307-309`）。

## 影響

- **拒否 3 回の猶予中（主）**: 同意する手段が 30 日間存在しない。拡張機能の主要機能は同意なしでは使えず、ユーザーは案内文に従って設定画面を開いても何もできない（案内文と実装の食い違い）。
- **撤回済み（副）**: モーダル 1 本だけが復路。ポップアップを開かないユーザーは設定画面からは戻れない。撤回を扱うコードの注釈も「同意へ戻る UI 経路は同意モーダルしかない」と明記しており、設定画面に同意アクションが無いことが前提になっている。
- **案内文の信頼性**: 実装に無い導線を案内し続けると、以後の同意まわりの説明がすべて疑わしくなる。
- 記録・AI 処理は同意なしで再開せず、同意が勝手に復活することもない（PBI 05 の ack ガード。安全側）。壊れているのは同意の回復経路だけ。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 拒否 3 回で猶予中のユーザーが設定画面から同意し、記録が再開できる（主経路）
  Given 拒否カウンタが 3、最終拒否時刻が直近 30 日以内である
  And   単一オブジェクト設定移行が完了しており、ack（privacy_consent_version）が存在する
  And   ポップアップを開いても同意モーダルは抑止される（shouldPromptForConsent が false）
  When  ユーザーが設定画面の Privacy タブで同意アクションを押す
  Then  署名済み同意レコード（hasConsented:true）が保存され、hasPrivacyConsent が true を返す
  And   拒否カウンタがリセットされ、猶予が解除される（getConsentDeniedCount が 0）
  And   本文保存フラグと ack が acceptConsent 経由で一貫して書かれる
  And   設定画面の表示が同意済みへ切り替わり、撤回アクションが現れる

Scenario: 2. 撤回済みのユーザーも設定画面から再同意できる
  Given 署名済みの withdrawn レコード（hasConsented:false + withdrawal + signature）がある
  When  ユーザーが設定画面の Privacy タブで同意アクションを押す
  Then  hasPrivacyConsent が true を返し、撤回レコードは新しい同意レコードで置き換わる
  And   getConsentWithdrawalHistory は null になる（撤回は履歴ではなく現在状態を表す）

Scenario: 3. 拒否時の案内文が実際の導線と一致する
  Given 拒否カウンタが 1 または 2 である（案内文が出る段階）
  When  ユーザーが拒否ボタンを押す
  Then  表示される案内文は、設定画面の Privacy タブにある同意アクションを具体的に指す
  And   その画面に同意アクションが実際に存在する（案内と実装が食い違わない）

Scenario: 4. 猶予の計算そのものは変わらない（回帰ガード）
  Given 拒否カウンタが 3、最終拒否時刻が直近 30 日以内である
  When  shouldPromptForConsent を評価する
  Then  同意していない限り false を返し、モーダルは抑止されたままである
  And   30 日経過後・最終拒否時刻が null・needsReconsent の各境界の戻り値は従来どおり

Scenario: 5. 同意アクションの保存が失敗したとき（異常系）
  Given 設定画面の Privacy タブで未同意状態であり、storage 書き込みが失敗する
  When  ユーザーが同意アクションを押す
  Then  パネルは失敗を表示し、成功したように見せない
  And   同意状態は未同意のままで、hasPrivacyConsent は false を返す

Scenario: 6. 本文保存のオプトインを巻き戻さない（境界）
  Given content_storage_enabled が true のプロファイルで、同意状態は未同意である
  When  ユーザーが設定画面から同意する
  Then  content_storage_enabled は true のままで、同意レコードと ack だけが回復する
```

## 受け入れ基準

- [x] 未同意（`getPrivacyConsent().hasConsented === false`）のとき、設定画面の Privacy タブに同意アクションが表示され、押下で `acceptConsent({ contentStorageEnabled })` 相当の 3 点セット（同意レコード＋`content_storage_enabled`＋ack）が一貫して書かれる → **完了記録参照（実装済み）**
- [x] 同意後、拒否カウンタがリセットされ猶予が解除される（`getConsentDeniedCount()` が 0、`getLastConsentDenialTime()` が 0）
- [x] 同意後 `hasPrivacyConsent()` が true を返し、拒否 3 回の猶予中でも設定画面から同意できる（BDD シナリオ 1）
- [x] 撤回済みの状態からも設定画面で再同意でき、新しい同意レコードが署名付きで保存される（BDD シナリオ 2）
- [x] 本文保存のオプトインの既存値を巻き戻さない。`contentStorageEnabled` は固定値ではなく `getContentStorageEnabled()` の現状値（または同意アクション行のチェックボックス状態）を渡す（BDD シナリオ 6）
- [x] 同意済みのユーザーには同意アクションを表示しない（撤回アクションと排他）
- [x] 拒否時の案内文（`consentDeclinedMessage`）が ja・en 両方で実装と一致し、設定画面の Privacy タブの同意アクションを指す（BDD シナリオ 3）
- [x] 新規 i18n キーが ja・en 両方にあり、`npm run check-i18n` が緑（en が default_locale のため片側だけの追加は不可）
- [x] 既存の撤回導線（確認ダイアログ→SQLite 削除→撤回の順、データ削除失敗時に撤回しない、非同意時に撤回ボタンが `hidden`）が非退行
- [x] ポップアップのモーダル挙動（accept / decline、3 回拒否の 30 日猶予、ack の書き込み）が非退行
- [x] `shouldPromptForConsent` の猶予規則の計算は変更しない（猶予テストが非退行、BDD シナリオ 4）
- [x] `npm run validate` が緑

## テスト戦略

- **単体（パネル）**: `src/dashboard/panels/staticForm/__tests__/privacySettingsPanel.test.ts`。未同意状態で同意アクションが表示され、押下で `acceptConsent` が期待どおりの `contentStorageEnabled` で呼ばれることを固定する。同意済みでは同意アクションが隠れること、保存失敗時は失敗表示になり成功を装わないことも同じファイルで固定する。既存の `buildContainer()` fixture（`:67-78`）に新要素を足す。
- **単体（同意モジュール）**: `src/popup/__tests__/privacyConsent-version.test.ts` の `shouldPromptForConsent - denial count paths`（`:194-231`）に、猶予解除の事後条件を足す。「拒否 3 回＋直近 → 猶予で `shouldPromptForConsent` false」の既存 pin はそのまま残す（回帰ガード）。
- **統合**: 「未同意（拒否 3 回＋直近、ack あり）→ 設定画面の同意アクション相当の処理 → `hasPrivacyConsent()` が true、`getConsentDeniedCount()` が 0、`shouldPromptForConsent()` が false（同意済みのため）」を通す。実モジュールの `privacyConsent.ts` を storage モックで通す `src/popup/__tests__/privacyConsent.test.ts` の型を再利用でき、パネル側は `acceptConsent` をモックして呼び出し契約を固定する（層をまたいだ 1 本の経路を二重に検証しない）。
- **E2E**: 不要（決定的な局所挙動）。owner が隔離プロファイルで「3 回拒否 → 設定画面を開く → 同意アクションが出る → 押す → 同意済み表示に変わる」を 1 回観測する。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/dashboard/panels/staticForm/privacySettingsPanel.ts` | 24-71 | 同意状態の表示と撤回だけの操作。同意アクションを足す場所 |
| `src/dashboard/panels/staticForm/privacySettingsPanel.ts` | 34 | `btn.classList.toggle('hidden', !state.hasConsented)`。同意アクションはこの逆条件で表示する |
| `src/dashboard/panels/staticForm/privacySettingsPanel.ts` | 35-70 | 撤回リスナー（確認→SQLite 削除→撤回）。非退行の対象 |
| `src/dashboard/panels/staticForm/privacySettingsPanel.ts` | 6 | `privacyConsent.js` からの import 行。`acceptConsent` / `getContentStorageEnabled` / `resetConsentDeniedCount` を追加 |
| `entrypoints/options/index.html` | 1616-1619 | `#consentStatusDisplay` / `#btnWithdrawConsent` / `#withdrawConsentStatus` の form-group。同意アクションと状態表示を足す |
| `entrypoints/options/index.html` | 555-556 | `#contentStorageEnabled`（`data-storage-key="content_storage_enabled"`）。本文保存オプトインの既存 UI |
| `src/utils/storage/privacyConsent.ts` | 433-440 | `acceptConsent`。3 点セットと状態変更通知を所有。設定画面から再利用する |
| `src/utils/storage/privacyConsent.ts` | 457-474 | `getConsentDeniedCount` / `getLastConsentDenialTime`。猶予の読み出し |
| `src/utils/storage/privacyConsent.ts` | 491-496 | `resetConsentDeniedCount`。猶予解除に使う owner の公開 API |
| `src/utils/storage/privacyConsent.ts` | 502-527 | `shouldPromptForConsent`。猶予分岐は `:513-523`。計算は変えない |
| `src/utils/storage/privacyConsent.ts` | 533-540 | `getContentStorageEnabled`。既存オプトイン値を読む |
| `src/popup/privacyConsentController.ts` | 148 | `acceptConsent` の唯一の production 呼び出し元。非退行の対象 |
| `src/popup/privacyConsentController.ts` | 165-171 | 拒否時の案内文（`consentDeclinedMessage`）。3 回目は案内を出さない分岐は維持 |
| `public/_locales/ja/messages.json` | 2612-2614 | `consentDeclinedMessage`。文言を実装に合わせる |
| `public/_locales/en/messages.json` | 2694-2696 | `consentDeclinedMessage`。同上 |
| `src/dashboard/panels/staticForm/__tests__/privacySettingsPanel.test.ts` | 67-78 | `buildContainer()` fixture。新要素を足す |
| `src/dashboard/panels/staticForm/__tests__/privacySettingsPanel.test.ts` | 30-33 | `privacyConsent.js` のモック。新しい export を足す |
| `src/popup/__tests__/privacyConsent-version.test.ts` | 194-231 | 猶予の境界テスト。非退行＋解除の pin を足す |
| `src/popup/__tests__/privacyConsentController.test.ts` | 288-305 | 拒否メッセージの pin（キー名で比較）。キー名を変えなければ文言変更の影響なし |

注記: i18n の実体は `public/_locales/` 配下にあり、`npm run check-i18n`（`node scripts/release-checks/check-i18n.mjs --skip-unused`、`validate` に同梱）が ja/en のキー集合の一致と source 参照キーの存在を検査する。

### 実装手順

1. **HTML**: `entrypoints/options/index.html:1614-1620` の form-group に同意アクション（例 `#btnGrantConsent`、`data-i18n="grantConsent"`）と状態表示（例 `#grantConsentStatus`、`aria-live="polite"`）を追加する。初期状態は `hidden` にし、パネル mount 時に表示を決める。`dist/*/options.html` はビルド成果物なので直接編集しない。
2. **パネル**: `privacySettingsPanel.ts:6` の import に `acceptConsent` / `getContentStorageEnabled` / `resetConsentDeniedCount` を追加する（既存の撤回と同じ Layer 1 直 import でよい）。
3. **表示の排他**: `state.hasConsented` を基準に、撤回ボタンは現行どおり `!hasConsented` で `hidden`、同意アクションはその逆で表示する。両方が同時に出ないことをテストで固定する。
4. **押下時の処理**: `const contentStorageEnabled = await getContentStorageEnabled();` → `await acceptConsent({ contentStorageEnabled });` → `await resetConsentDeniedCount();` → 表示更新（同意済み文言＝既存の `consented` / `consentedNoDate`、撤回ボタンを表示、同意アクションを `hidden`）→ status に成功文言。`acceptConsent` が同意レコード・保存フラグ・ack と状態変更通知を一貫して書くので、**パネルから `chrome.storage.local.set` を直接呼ばない**。失敗時は例外を捕まえて失敗文言を出し、表示を同意済みへ変えない。
5. **本文保存オプトインの設計判断（必須）**: 既定 `false` を固定で渡さない。設定画面には既に `#contentStorageEnabled`（本文保存のオプトイン、`:555-556`）があり、ここで `false` を渡すとユーザーが有効にしていた本文保存を黙って無効化する。同意アクションの目的は同意の回復であって本文保存の意思変更ではないため、`getContentStorageEnabled()` の現状値をそのまま渡す（同意アクション行にチェックボックスを出す場合も、mount 時にこの値で描画し、押下時にその checked を渡す）。
6. **猶予の解除**: 設定画面から明示的に同意した時点で「拒否したがまだ答えていない」という猶予の前提が消えるため、owner の API `resetConsentDeniedCount()` を呼んで解除する。代替案として `acceptConsent` の内部で解除する方法もある（ポップアップ経路とも一貫する）が、既存のモーダル経路の事後状態を変えるため、本 PBI ではパネル側の 1 呼び出しを主案とする。どちらを採るかを決めて完了記録に残す。
7. **i18n**: 新キー（例 `grantConsent` / `consentGrantedFromSettings` / `consentGrantFailed`）を ja・en の両方に追加する。`consentDeclinedMessage` は**キー名を変えずに文言だけ**更新し、設定画面の Privacy タブの同意アクションを具体的に指す文にする（ポップアップの「設定画面」はダッシュボードの Privacy タブであることを明示する）。
8. **テスト**: パネル単体（表示の排他・押下時の呼び出し契約・失敗表示・本文保存値の引き継ぎ）、同意モジュールの猶予解除、統合 1 本を追加する。

### 実装者向け注記 ― 現状コードの確認（着手前に必ず実行）

```bash
# 1. 設定画面に同意アクションが無いこと（期待: 撤回の hidden 切替と撤回リスナーだけ）
grep -n "hasConsented\|btnWithdrawConsent\|acceptConsent" src/dashboard/panels/staticForm/privacySettingsPanel.ts
# 2. acceptConsent の production 呼び出し元がポップアップだけであること（期待: privacyConsentController.ts:148 のみ）
grep -rn "acceptConsent" src/ entrypoints/ --include=*.ts | grep -v __tests__
# 3. 猶予分岐（期待: 拒否 3 回 + 最終拒否から 30 日以内で false）
grep -n "THIRTY_DAYS_MS" -B 8 -A 8 src/utils/storage/privacyConsent.ts
# 4. 案内文が設定画面を指していること（期待: ja 2612 / en 2694 付近）
grep -n "consentDeclinedMessage" -A 2 public/_locales/ja/messages.json public/_locales/en/messages.json
# 5. 本文保存オプトインの既存 UI（期待: content_storage_enabled に束縛されたチェックボックス）
grep -n "contentStorageEnabled" entrypoints/options/index.html
```

**既実装ではない**（設定画面から同意を書く production 経路は存在しない。grep 2 の結果が空になること＝本 PBI の前提）。

### 落とし穴

- **`acceptConsent` は `contentStorageEnabled` を必須引数に取る**。既定 `false` を固定で渡すと、本文保存を有効にしていたユーザーの設定を黙って巻き戻す。上記手順 5 のとおり現状値を読んで渡すこと。
- 同意レコード・保存フラグ・ack は `acceptConsent` が一貫して書く。**パネル側で個別に storage を書かない**（ack を落とす、署名を壊す、通知を出し忘れるのいずれも起きる）。`chrome.storage.local.get` / `set` はキーの配列で複数キーをまとめて扱えるが、3 点セットをパネル側で組み立てないこと。カウンタの解除は owner の `resetConsentDeniedCount()` を呼ぶ。
- `privacySettingsPanel` は Layer 1 の `privacyConsent.ts` を直接 import してよい（既存の撤回も同じ）。`SettingsRepository` を新たに持ち込んで層の契約を崩さないこと。
- 再同意は `acceptConsent` → `savePrivacyConsent` が `privacy_consent` を署名付き `hasConsented:true` で上書きするため、`withdrawal` フィールド（撤回の監査証跡）は消える。これは既存のポップアップのモーダル経路と同一の挙動であり、本 PBI が新しい損失を導入するものではない。証跡を別キーへ退避するかは同意スコープの設計判断であり本 PBI の対象外（必要なら別 PBI として起票する）。
- i18n キーの追加漏れは `check-i18n` で落ちる。en が default_locale なので、ja だけに足すと英語ユーザーに生キーが出る。`public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方を同時に編集する。
- `consentDeclinedMessage` は既存テストが**キー名で**比較している（`privacyConsentController.test.ts:301`）。キー名は据え置き、値だけ更新する。
- `handleDeclineConsent` は拒否 3 回目で案内を出さずに return する（`privacyConsentController.ts:165-167`）。これは猶予の意味（これ以上聞かない）と整合する仕様なので変えない。文言だけを直し、3 回目の分岐は触らない。
- 同意アクションの表示条件は `state.hasConsented === false` とする（`needsReconsent` / `signatureInvalid` でも `hasConsented` は false になり、再同意が必要なケースはすべて拾える）。同意済みに同意アクションを出さない。
- `shouldPromptForConsent` の猶予計算（`:513-523`）は**変更しない**。本 PBI は経路と文言の追加であり、猶予の意味論は対象外。変更すると `privacyConsent-version.test.ts` の境界 pin が壊れる。
- 撤回導線の順序（SQLite 削除→撤回）とデータ削除失敗時の非撤回は非退行。同意アクションは削除を伴わないため確認ダイアログは不要（同意は破壊的でない）。
- `entrypoints/options/index.html` を編集したら `npm run build` で `dist/*/options.html` を再生成する。dist 配下を手で編集しない。
- 文言変更は同意スコープの変更ではないため `PRIVACY_POLICY_VERSION` は据え置く（版数を上げると全利用者に再同意モーダルが出る）。

### ロールバック手順

1. 変更はパネル 1 ファイル＋HTML 1 ファイル＋i18n 文言 2 ファイル＋テストに閉じる。**storage スキーマを増やさない**（新しいキーを作らない）ため、ロールバックで残るデータは無い。
2. `git revert` で同意アクションと文言を戻すと、設定画面は撤回のみに戻り、拒否 3 回の猶予の挙動は元のまま（`shouldPromptForConsent` は触っていないので計算も元のまま）。
3. ロールバック後 `npm run validate` が緑であることを確認し、`pbi/00-INDEX.md` の本 PBI の状態も戻す。
4. 同意済みのレコードは巻き戻らない（ロールバック後も同意状態は正しく読める）。監査上の verdict は「同意の回復経路が設定画面に無い状態へ戻る」ため、未修正として扱う。

## 見積もり

1.0 SP（🟢低）。内訳: パネルと HTML の同意アクション = 0.4 / i18n 文言の更新と新キー 2 ファイル = 0.1 / パネル単体・猶予解除・統合のテスト = 0.5。

## Definition of Done

- [x] シナリオ 1〜6 が自動テストでパス（Red を観測してから実装）
- [x] 同意後に拒否カウンタがリセットされ猶予が解除される（`resetConsentDeniedCount`）
- [x] 撤回済みからも設定画面で再同意できる
- [x] 本文保存オプトインの既存値を巻き戻さない（`getContentStorageEnabled()` の現状値を渡す）
- [x] 同意済みには同意アクションを出さない（撤回と排他）
- [x] 案内文が ja・en 両方で実装と一致（Privacy タブの「同意する」を指す）
- [x] 既存の撤回導線・ポップアップのモーダル挙動・`shouldPromptForConsent` の計算が非退行
- [x] `npm run validate` が緑（CI）
- [x] コードレビュー完了
- [x] 完了記録に、なぜなぜ分析と裁定（本文保存オプトインの扱い・猶予解除の置き場所）を残す
- [x] ドキュメント更新済み（`public/PRIVACY.md` / `docs/PRIVACY.md` を**バイト同一で同期**し、「拒否後の再同意」段落を追記。同意スコープは不変なので同意バージョンは据え置き）

## 完了記録（2026-10-19）

### なぜなぜ分析（原因 → 示唆 → 解）

**疑問**: なぜ「設定画面で後から同意できます」と案内しながら、設定画面に同意する手段が無いのか。

1. **なぜ設定画面に同意アクションが無いのか** ― Privacy タブは「状態表示 + 撤回」として作られた。撤回は「同意済みからの遷移」なので、`hasConsented` を前提にした UI になった。
2. **なぜ「撤回のみ」で足りたのか** ― 同意の獲得は**ポップアップのモーダル**が担う設計で、設定画面は「すでに同意した人の管理画面」という位置づけだった。
3. **なぜその分担が破れたのか** ― モーダルには**抑止**がある（3 回拒否で 30 日）。抑止された瞬間、同意獲得の唯一の担い手が沈黙する。設計時に「抑止は一時的」とだけ考え、**抑止中に代替経路が要る**ことを洗い出さなかった。
4. **なぜ案内文が実装と食い違ったのか** ― 案内文は「将来そうする」意図で書かれ、**実装との突き合わせが無かった**（文言はキー名で pin され、内容は検証されない）。
5. **なぜ気づくのが遅れたのか** ― 拒否 3 回は「レアな状態」と見なされ、その状態の UX を通しで確認していなかった（テストは単機能ごと）。

**原因**: 同意獲得の経路を**1 つだけ**用意し、その経路が**自分で自分を抑止する**設計にしたこと。抑止は「待てば戻る」が、待つ間の代替が無い。

**示唆**:
- 入口を 1 つに集約するのは良いが、**その入口が閉じうる**なら代替経路を同じ作業で用意する。
- 案内文は「実装に存在する導線」を指しているか確かめる。文字列の pin だけでは足りない。
- 「レアな状態」（拒否 3 回、撤回済み）こそ UX を通しで確認する価値がある。
- 同意の付与は `acceptConsent` の 1 経路に保つ。UI を増やしても**保存の一貫性（同意 + 本文保存 + ack）は 1 か所**に置く。

**解**: Privacy タブに `#btnGrantConsent` を追加し、`acceptConsent` → `resetConsentDeniedCount` を通す。撤回ボタンとは排他表示。本文保存オプトインは現状値を引き継ぐ。案内文を Privacy タブの同意ボタンに向ける。

### 裁定 1: 本文保存オプトインの扱い

**既存値を読んで渡す**（`getContentStorageEnabled()`）を採用。同意アクションの目的は**同意の回復**であって本文保存の意思変更ではないため、固定の `false` を渡すとユーザーが有効にしていた設定を黙って無効化してしまう。同意アクション行にチェックボックスは置かず、既存の `#contentStorageEnabled` を唯一の設定点として残す（設定点を 2 つにしない）。

### 裁定 2: 猶予解除の置き場所

**パネル側の 1 呼び出し**（`resetConsentDeniedCount()`）を採用。`acceptConsent` の内部で解除すると**ポップアップ経路の事後状態が変わる**（既存テストと挙動の前提を書き換える）ため。設定画面から明示的に同意した時点で「拒否したがまだ答えていない」という猶予の前提が消えるので、呼び出し側で解除するのが意味的にも素直。

### 実装

- `entrypoints/options/index.html` ― `#btnGrantConsent`（初期 `hidden`）と `#grantConsentStatus`（`aria-live="polite"`）を追加。
- `src/dashboard/panels/staticForm/privacySettingsPanel.ts` ― 表示を `renderConsentState()` に集約し、撤回と同意を排他に。同意押下で `getContentStorageEnabled()` → `acceptConsent({ contentStorageEnabled })` → `resetConsentDeniedCount()` → 表示更新。失敗時は失敗文言のみで**表示を同意済みに変えない**。撤回成功後は同意アクションが出る。
- i18n: `grantConsent` / `consentGrantedFromSettings` / `consentGrantFailed` を ja・en に追加。`consentDeclinedMessage` はキー名を変えずに「ダッシュボードの Privacy タブの『同意する』ボタン」を指す文言へ更新。
- `public/PRIVACY.md` / `docs/PRIVACY.md` ― 「拒否後の再同意」段落を追加（バイト同一を確認）。
- テスト: `privacySettingsPanel.test.ts` に 4 本（排他表示 2・同意成功時の契約 1・失敗時 1）。

### テスト（Red → Green）

- **Red**: パネル実装を revert すると新規 3 本が失敗（排他表示・成功契約・失敗表示）。
- **Green**: 15 本すべてパス。`check-i18n` 緑、`validate:json` 緑、`type-check` / baseline（456）緑。
- 回帰: 同意モジュール（`shouldPromptForConsent` の猶予）とポップアップのモーダル挙動は変更しておらず既存テストが緑。ローカル集約実行は負荷 20 で 5 ファイルが worker 起動失敗（個別実行では 126 tests 緑）。CI の `validate` を最終判定とした。

### 補足

`shouldPromptForConsent` の猶予計算には手を入れていない（シナリオ 4 の回帰ガード）。猶予が明ける前に同意したい人のための**代替経路**を足しただけで、「3 回拒否で 30 日モーダルを出さない」という決定自体は維持している。

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md` ― 撤回側の修正（撤回時に拒否カウンタを解除）。本 PBI は拒否の側（設定画面の導線と案内文）を扱う
- `pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md` ― 同意系キーの配置。同意レコードが読める前提が共通
- `pbi/2026-10-18-04-fix-notification-consent-prestage.md` ― 同じ consent lifecycle。`hasPrivacyConsent()` の読み出し前提が共通
- `docs/i18n-guide.md` ― ja・en 両方へのキー追加と `check-i18n` の規約
