# PBI: 本番到達不能な並行マスターパスワード実装を削除して canonical 実装に集約する

種別: refactor
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワード機能を保守する開発者として、同名の set/change 実装が 2 系統に分かれた状態を解消したい。なぜなら、本番到達不能な旧実装(`utils/masterPassword.ts`)は 4 件のハードコード field リストや非アトミックな書き込みを抱えており、誤って wiring したり grep でこちらを修正したりすると `provider_api_key` / `github_pat` が旧 KEK に取り残されるから。

## 優先度

- 順位: 11 / 13
- RICE スコア: 2.0(Reach=1 / Impact=0.5 / Confidence=1.0 / Effort=0.25)
- 根拠: 直接のユーザー影響はないが、誤修正・誤 wiring のリスクを実在のコードとして除去する。

## 証拠(レビュー由来・全 import 走査で確認済み)

- 本番 import は 3 箇所のみ: `dashboard/masterPassword.ts:12-16`(verify/isSet/strength)、`utils/masterPasswordUiCore.ts:7`(validator 2 件)、`utils/storage/encryptionSession.ts:10`(strength)。`setMasterPassword` / `changeMasterPassword` を import する本番コードはゼロ(テストのみ: `utils/__tests__/masterPassword.test.ts:15,17`)
- dashboard は encryptionSession 版を alias で使用(`dashboard/masterPassword.ts:17-22` → `:225`/`:231`)
- 死んでいるのはファイルではなく関数単位。`utils/masterPassword.ts` ファイル自体と `utils/masterPasswordUiCore.ts` ファイル自体は本番で使用中のため削除しない(削除対象は `setMasterPassword` / `changeMasterPassword` / `buildSetStorageFn` とそれ専用のテスト・import のみ)
- `buildSetStorageFn`(`utils/masterPasswordUiCore.ts:48`)の参照元は `utils/__tests__/masterPasswordUiCore.test.ts` のみ。`buildGetStorageFn` は `dashboard/masterPassword.ts:303` が使用中で残す
- `utils/masterPassword.ts` を module mock している dashboard テスト 4 件(`src/dashboard/__tests__/masterPassword.test.ts` / `-r2` / `-branches` / `-enhanced`)が死蔵 `setMasterPassword` をモックしており、`expect(setMasterPassword).not.toHaveBeenCalled()` は本番経路(encryptionSession 版)を検証しない空のアサーションになっている
- manifest の `web_accessible_resources` は `wxt.config.ts` で生成され、`content-extractor.js` と `icons/icon48.png` のみ。masterPassword 系は含まれない。ファイルを削除しないため変更不要
- `utils/masterPassword.ts:105` `setMasterPassword` — metadata を直接書くだけで既存 ciphertext を再暗号化しない
- `:183` `changeMasterPassword` — `:235` の per-field 書き込みが `:239-241` の metadata 書き込みに先行する非アトミック、catch(`:244`)で途中失敗すると一部だけ新 KEK の不整合が残る
- `:220` — `['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key']` の 4 件ハードコードで canonical 6 件(`storage/apiKeyFields.ts:15-22`、`provider_api_key` / `github_pat` 欠落)と不一致。nested `settings` blob も未対応
- `:188` — `_reencryptFn` は JSDoc(`:180`)に反して一度も呼ばれない
- `:208` — salt 欠損時にランダム salt で oldKey を導出し全再暗号化を壊す
- `:163-166` — rehash が `MASTER_PASSWORD_KDF_ITERATIONS` を更新せず、encryptionSession 版(`:630-634`)と乖離
- 本実装の由来: commit 988b6157 で dashboard の import が encryptionSession 版へ切り替わり死蔵化

## BDD 受け入れシナリオ

```gherkin
  Scenario: マスターパスワード操作の実装系統が単一になる
    Given リポジトリに set/change の実装が存在する
    When production コードの import を走査する
    Then encryptionSession 版のみが参照され、utils 版の set/change は存在しない

  Scenario: 削除後も既存の全テストが green である
    Given 死蔵実装とそのテストが削除されている
    When validate(type-check + test)を実行する
    Then 全テストがパスする
```

## 受け入れ基準

- [ ] `utils/masterPassword.ts` の `setMasterPassword` / `changeMasterPassword` と、テスト専用ヘルパー(`masterPasswordUiCore.ts` の `buildSetStorageFn` がテスト専用と確認できればそれも)を削除する
- [ ] `verifyMasterPassword` / `isMasterPasswordSet` / `calculatePasswordStrength` / validator は残す(本番使用中)
- [ ] `utils/__tests__/masterPassword.test.ts` の set/change 関連テストを削除または encryptionSession 経路のテストへ置換する
- [ ] 4 件ハードコード field リストが消え、canonical(`API_KEY_FIELD_NAMES`)のみが残る
- [ ] `npm run validate` が green

## テスト戦略

### 単体
- 削除後の import 走査(スクリプトまたは grep 検証)で残存参照ゼロを確認する

## 制約

- 本番動作を一切変更しない(純粋な削除とテスト移行)
- 層規約(lint-layers-docs)を維持する

## 実装ガイド(低コストモデル向け)

### 0. リポジトリ規約(必読)

- ファイルは Read ツールの `offset` / `limit` で読む。`sed` / `awk` / `head` / `tail` / `cat` でファイルを読まない・編集しない。検索は `grep -n` / `grep -rn`
- コードとコード内コメントは英語。コメントは非自明な WHY のみ
- ESM import は必ず `.js` 拡張子で終える
- 固定時間 wait(`setTimeout` 待ち・`sleep`)やリトライ回数の引き上げでテストを通さない
- CRLF のファイルは CRLF を保つ(`file <path>` で確認。この PBI の対象ファイルは全て LF)
- ツール呼び出しが権限で拒否されたら、回避せず止めて報告する
- zsh では `grep` の `--include=*.ts` が glob 展開エラーになる。実行前に `setopt nonomatch` を打つか、`--include='*.ts'` と引用符で囲む

### 1. 前提と着手前チェック

死んでいるのは関数単位(`setMasterPassword` / `changeMasterPassword` in `src/utils/masterPassword.ts`、`buildSetStorageFn` in `src/utils/masterPasswordUiCore.ts`)。`masterPassword.ts` と `masterPasswordUiCore.ts` の両ファイルは残す。

```bash
cd /Users/yaar/Playground/obsidian-smart-history
# (A) utils 版 set/change の import 元。期待: src/utils/__tests__/masterPassword.test.ts のみ(本番コードはゼロ)
grep -rn "setMasterPassword\|changeMasterPassword" src entrypoints --include='*.ts' | grep -v "encryptionSession\|MasterPasswordService\|setMasterPasswordNowBtn\|changeMasterPasswordBtn\|getElementById\|getMessage\|i18n_\|titleKey"
# (B) buildSetStorageFn の参照。期待: 定義(masterPasswordUiCore.ts:48)と masterPasswordUiCore.test.ts のみ
grep -rn "buildSetStorageFn" src entrypoints testDir scripts eslint
# (C) 本番の utils/masterPassword.js import。期待: 3 件のみ
#     dashboard/masterPassword.ts(verify/isSet/strength), utils/masterPasswordUiCore.ts(validator 2 件), utils/storage/encryptionSession.ts(strength)
grep -rn "masterPassword\.js'" src --include='*.ts' | grep -v __tests__
# (D) dynamic import・登録リスト。期待: manifest/wxt/eslint/knip に masterPassword 系の記載なし(LAYERS.md と lint-layers-docs.mjs の 1 行ずつのみ)
grep -n "masterPassword" wxt.config.ts package.json eslint.config.js scripts/lint-layers-docs.mjs dev-docs/LAYERS.md
grep -rln "masterPassword" eslint
ls knip.json knip.jsonc .knip.json 2>/dev/null
```

期待と一致しない場合(本番コードが `setMasterPassword(password, fn)` 形式の utils 版や `buildSetStorageFn` を import している、`(A)` に `src/utils/__tests__/masterPassword.test.ts` 以外が出る等)は、削除せず止めて不一致の grep 出力を報告する。

### 2. 変更対象ファイル

削除するファイル: なし(ファイル単位の削除・登録変更は不要。したがって `manifest.json` / `wxt.config.ts` の `web_accessible_resources`、`eslint/rules/utils-layer-boundary.mjs` とそのテスト、`dev-docs/LAYERS.md`、`scripts/lint-layers-docs.mjs` は変更しない)。

編集するファイル:

| ファイル | 変更 |
|---|---|
| `src/utils/masterPassword.ts` | `setMasterPassword`・`changeMasterPassword` を削除。不要になった import(`EncryptedData` 型、`generateSalt`、`encrypt`、`decryptData`、`deriveKey`、`bytesToBase64`、`CRYPTO_PARAMS`)を削除。`errorMessage` / `hashPasswordWithPBKDF2` / `verifyPasswordWithPBKDF2` / `base64ToBytes` / `validatePasswordPolicy` は `verifyMasterPassword` 等が使うので残す。ファイル先頭 JSDoc の「パスワード設定、検証、変更」を実態(検証・強度チェック・バリデーション)に直す |
| `src/utils/masterPasswordUiCore.ts` | `buildSetStorageFn` を削除。`buildGetStorageFn` は残す |
| `src/utils/__tests__/masterPassword.test.ts` | `describe('setMasterPassword')` と `describe('changeMasterPassword')` を削除。import から `setMasterPassword` / `changeMasterPassword` を除く。`vi.mock('../crypto/index.js')` 内で不要になったモック(`generateSalt` / `encrypt` / `decryptData` / `deriveKey`)は、残るテストが使わなければ削除 |
| `src/utils/__tests__/masterPasswordUiCore.test.ts` | `describe('buildSetStorageFn')` と import の `buildSetStorageFn` を削除 |
| `src/dashboard/__tests__/masterPassword.test.ts` | 下記「5. 既存テストへの影響」 |
| `src/dashboard/__tests__/masterPassword-r2.test.ts` | 同上 |
| `src/dashboard/__tests__/masterPassword-branches.test.ts` | 同上 |
| `src/dashboard/__tests__/masterPassword-enhanced.test.ts` | `vi.mock('../../utils/masterPassword.js')` の `setMasterPassword: ...` 行(32 行目付近)を削除 |

触らないファイル: `src/utils/storage/encryptionSession.ts`(canonical)、`src/dashboard/masterPassword.ts`、`src/utils/storage/apiKeyFields.ts`、`src/utils/__tests__/storage-extra.test.ts` と `obsidianEnabled.test.ts`(`calculatePasswordStrength` のみモックしており影響なし)、`masterPassword-ui-state.test.ts` と `masterPassword-set-guard.test.ts`(モックに `setMasterPassword` を持たない)、他の PBI ファイル、`CHANGELOG.md` は本 PBI では触らない。

### 3. 手順

1. 前節 1 のコマンドを実行し、期待どおりであることを確認する。
2. 節 4 のベースラインを記録する。
3. テストの参照を先に外す(本番コードはまだ触らない)。`src/dashboard/__tests__/` の 4 ファイルを節 5 のとおり修正し、`npx vitest run src/dashboard` が green のままであることを確認する。
4. `src/utils/__tests__/masterPassword.test.ts` から set/change の `describe` を削除し、`src/utils/__tests__/masterPasswordUiCore.test.ts` から `buildSetStorageFn` の `describe` を削除する。
5. 本番コードから削除する: `src/utils/masterPassword.ts` の `setMasterPassword` / `changeMasterPassword` と不要 import、`src/utils/masterPasswordUiCore.ts` の `buildSetStorageFn`。
6. 4 件ハードコード配列の消滅を確認する: `grep -rn "'openai_2_api_key'\]" src --include='*.ts' | grep -v __tests__` が `src/utils/masterPassword.ts` を含まないこと。
7. 節 6 の検証コマンドを順番に実行する。

### 4. テスト先行(ベースライン)

削除前に実行し、`Test Files` と `Tests` の数値を記録する。

```bash
npx vitest run src/utils src/dashboard src/background src/popup
```

削除後の許容差分は削除した死蔵テストだけ。`src/utils/__tests__/masterPassword.test.ts` の `setMasterPassword` 4 件と `changeMasterPassword` 4 件、`masterPasswordUiCore.test.ts` の `buildSetStorageFn` 1 件、計 9 件が減る。Test Files の数は変わらない。それ以外の差分が出たら原因を調べる。

live な経路のカバレッジが減っていないことの確認: set/change の本番経路は `src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts`、`encryptionSession-branch.test.ts`、`encryptionSession-set-guard.test.ts`、`src/utils/__tests__/storage-security.test.ts` が検証している。`npx vitest run src/utils/storage src/utils/__tests__/storage-security.test.ts` の件数が削除前後で同一であること。`verifyMasterPassword` / `isMasterPasswordSet` / `calculatePasswordStrength` / validator のテストは `masterPassword.test.ts` に残るので、`grep -n "describe('" src/utils/__tests__/masterPassword.test.ts` で `calculatePasswordStrength` / `validatePasswordRequirements` / `validatePasswordMatch` / `verifyMasterPassword` / `isMasterPasswordSet` が残っていることを確認する。

### 5. 既存テストへの影響

`src/dashboard/__tests__/` の 3 ファイルは `../../utils/masterPassword.js` から `setMasterPassword` を import してモックしている。モック factory からキーを消すと import 側が実行時エラーになるため、キー削除と import 削除を同時に行う。

- `masterPassword.test.ts`: モック factory(32-40 行目付近)の `setMasterPassword: vi.fn(),`、import(78 行目付近)の `setMasterPassword,`、`beforeEach` の `vi.mocked(setMasterPassword).mockResolvedValue({ success: true });`(132 行目付近)を削除。`expect(setMasterPassword).not.toHaveBeenCalled()`(788 / 812 / 901 行目付近の 3 箇所)は `expect(setMasterPasswordService).not.toHaveBeenCalled()` に置換する(encryptionSession 版の import は 87 行目付近に既にある)
- `masterPassword-r2.test.ts`: モック factory(39 行目付近)、import(69 行目付近)、`setupDefaultMockValues` 内の `vi.mocked(setMasterPassword)...`(117 行目付近)の 3 箇所を削除
- `masterPassword-branches.test.ts`: モック factory(42 行目付近。58 行目付近の encryptionSession 側モックは残す)、import(85 行目付近。95 行目付近の `setMasterPasswordService` は残す)、`vi.mocked(setMasterPassword).mockResolvedValue(...)`(232 / 251 行目付近の 2 箇所)を削除。`expect(setMasterPassword).not.toHaveBeenCalled()`(276 行目付近)は `expect(setMasterPasswordService).not.toHaveBeenCalled()` に置換
- 行番号は目安。必ず `grep -n "\bsetMasterPassword\b" <file>` で現在位置を確認し、`setMasterPasswordService` と `setMasterPasswordNowBtn` を巻き込まない(`\b` 付きの語境界一致で判別する)
- 置換後もテストが RED にならず、置換した 4 件のアサーションが「set が呼ばれない」という元の意図を保つこと

### 6. 検証コマンド(この順番)

```bash
npm run type-check
npm run lint                 # errors 0 であること(未使用 import は lint で検出される)
npm run lint:layers-docs
npm run check-deprecated-aliases
npx vitest run src/utils src/dashboard src/background src/popup
npm run build                # 成功すること
grep -rln "changeMasterPassword\b.*getStorageFn\|buildSetStorageFn" dist .output 2>/dev/null   # 出力が空であること
```

`npm run build` の出力先は `.output/` または `dist/`(存在する方を対象にする)。ビルド成果物に `buildSetStorageFn` の文字列が残っていないこと。

### 7. 落とし穴

- `utils/masterPassword.ts` のファイルごと削除しない。本番で 3 箇所から import されている
- `encryptionSession.ts` にも同名の `setMasterPassword` / `changeMasterPassword` がある。こちらは canonical なので絶対に消さない。grep 結果は import 元のパスで区別する
- `masterPassword.ts` の `verifyMasterPassword` 内の `chrome.storage.local.set`(rehash)は変更しない(本 PBI は純粋な削除)
- 不要になった import を残すと `npm run lint` が失敗する。逆に `errorMessage` などを誤って消すと `verifyMasterPassword` の型検査が落ちる
- vi.mock factory からキーを消した場合、テスト側の import を残すと `No "..." export is defined on the mock` で落ちる
- テストが落ちても固定 wait やリトライ増で通さない。原因が分からなければ止めて報告する

### 8. コミットとアーカイブ手順

(a) 本 PBI の受け入れ基準と Definition of Done のチェックボックスを `[x]` にする。ただし `コードレビュー完了` は `[ ]` のまま残す。

(b)(c) 実装コミット(zsh では配列で扱う):

```bash
cd /Users/yaar/Playground/obsidian-smart-history
files=(
  src/utils/masterPassword.ts
  src/utils/masterPasswordUiCore.ts
  src/utils/__tests__/masterPassword.test.ts
  src/utils/__tests__/masterPasswordUiCore.test.ts
  src/dashboard/__tests__/masterPassword.test.ts
  src/dashboard/__tests__/masterPassword-r2.test.ts
  src/dashboard/__tests__/masterPassword-branches.test.ts
  src/dashboard/__tests__/masterPassword-enhanced.test.ts
)
git add -- "${files[@]}"
git commit -m "refactor(security): 到達不能な utils 版 set/change のマスターパスワード実装を削除する" \
  -m "encryptionSession 版が唯一の実装である状態にする。utils 版は 4 件のハードコード field リストと非アトミックな書き込みを持ち、誤って wiring や修正をすると provider_api_key / github_pat が旧 KEK に取り残されるため、本番から到達不能な関数とテスト専用ヘルパー buildSetStorageFn を、それらだけを検証するテストごと除去した。本番動作は変更しない。" \
  -- "${files[@]}"
```

(d) アーカイブ:

```bash
pbi=pbi/2026-09-30-11-refactor-remove-dead-masterpassword-module.md
git add -- "$pbi"
git mv "$pbi" dev-docs/archived/pbi/
git commit -m "docs(pbi): 09-30 PBI 11(死蔵マスターパスワード実装の削除)をアーカイブする" \
  -- "$pbi" dev-docs/archived/pbi/2026-09-30-11-refactor-remove-dead-masterpassword-module.md
```

`git add -A` / `git add .` は使わない。ファイルを削除した場合は `git rm` を使う(本 PBI では削除するファイルはない)。

### 9. 完了条件

- 節 1 の grep で utils 版 `setMasterPassword` / `changeMasterPassword` / `buildSetStorageFn` の参照が 0 件
- 節 6 の全コマンドが成功(lint は errors 0、build 成功)
- vitest の Test Files 数がベースラインと同じで、Tests 数の減少が節 4 の 9 件のみ
- 受け入れ基準と DoD が `[x]`(`コードレビュー完了` を除く)、実装コミットとアーカイブコミットの 2 つが作成済み

## 見積もり

1 SP

## Definition of Done

- [ ] 削除完了と validate green
- [ ] コードレビュー完了
