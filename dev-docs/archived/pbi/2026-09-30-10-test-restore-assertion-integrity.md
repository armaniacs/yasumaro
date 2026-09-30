# PBI: マスターパスワード系テストの空振り assertion を修正し read-back 失敗経路をカバーする

種別: test
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワード機能を改修する開発者として、テストが本番の契約を実際に検証している状態を目指す。なぜなら、本番が呼ばないシンボルを assert した空振りテストや、本番で到達不能な状態を構築したテストが「緑の偽の保証」を与え、回帰を見逃すから。

## 優先度

- 順位: 10 / 13
- RICE スコア: 2.0(Reach=1 / Impact=0.5 / Confidence=1.0 / Effort=0.25)
- 根拠: 直接のユーザー価値は薄いが、他の全修正(順位 1〜9)の検証基盤となる。同点 3 件(10/11/12)の中で検証基盤として最優先。

## 証拠(レビュー由来・確認済み)

現状の空振り assertion(テスト名で特定する。行番号は目安):

- `src/dashboard/__tests__/masterPassword-branches.test.ts:276`(テスト「mode=set requires matching confirm password (returns early on mismatch)」)— 唯一の assertion が `expect(setMasterPassword).not.toHaveBeenCalled()`。`setMasterPassword` は utils 版のモック(`:41-49` の `vi.mock('../../utils/masterPassword.js')`)で、本番コントローラが呼ぶのは `setMasterPasswordService`(`:95` の `setMasterPassword as setMasterPasswordService`、encryptionSession 版)のため常に成立する
- `src/dashboard/__tests__/masterPassword.test.ts:788` / `:812` / `:901`(テスト「should show validation error when validatePasswordRequirements fails」「should show match error when passwords do not match in set mode」「should do nothing when masterPasswordInput element is null」)— 同じく utils 版 `setMasterPassword` への `not.toHaveBeenCalled()`。前 2 件は直前の DOM assertion が本番を検証しており、末尾の not-called だけが空振り。`:901` は not-called が唯一の assertion
- `src/dashboard/__tests__/masterPassword.test.ts:864-884`(テスト「should restore the checkbox when the service throws during save」)— `checkbox.checked = false` を手動で構築し、`preToggleChecked` の初期値も `false` のため false→false になる。本番の復元(`savePasswordInner` の catch 内 `checked = this.preToggleChecked`)を削除しても通る
- `src/utils/storage/encryptionSession.ts` の `reencryptApiKeysToKek` 末尾(`REENCRYPT_VERIFY_FAILED` を throw する箇所)— リポジトリ内でこの文字列に一致するのは本番コードの 1 箇所のみで、テストは 0 件。「認証メタデータは read back 確認が通るまで書かない」(`setMasterPassword` の JSDoc)という契約の失敗側が未検証
- `src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts:6` — ヘッダが「untouched until read-back verification passes」を謳うが、失敗経路のテストは無い

着地済み(本 PBI では触らない。前提として利用する):

- `masterPassword-r2.test.ts` の「hides confirmPasswordGroup in change mode」は change モードで hidden を期待する形に直り、fixture の `confirmPasswordGroup` は初期クラス無しのため、`showPasswordModal` の `classList.toggle('hidden', mode === 'change')` を消すと赤になる(空振りではない)
- `masterPassword-ui-state.test.ts` は本番 HTML と同じ初期クラス(modal は `hidden`、confirm group は `form-group`)の fixture を持ち、「set save 失敗で checkbox が OFF に戻る」を `toggleCheckbox(true)` 経由で検証している
- 本番のロールバックは `preToggleChecked` へ復元する実装になっており、「true→true の no-op」ではない

## BDD 受け入れシナリオ

```gherkin
  Scenario: 空振り assertion が本番シンボルを検証する
    Given masterPassword-branches.test.ts の confirm mismatch テストがある
    When テストが実行される
    Then assertion は setMasterPasswordService(encryptionSession 版)に対して行われる

  Scenario: read-back 失敗時に metadata が書かれないことが検証される
    Given read-back 検証が不一致になる状態が注入できる
    When set または change を実行する
    Then REENCRYPT_VERIFY_FAILED で失敗する
    And MASTER_PASSWORD_SALT/HASH/ENABLED は書かれない
```

## 受け入れ基準

- [x] `masterPassword-branches.test.ts` の confirm mismatch テストを `setMasterPasswordService` への assert に修正する
- [x] 同種の空振り assertion(`masterPassword.test.ts` の 3 件: validation error / match error / masterPasswordInput null)を本番シンボルへ修正する
- [x] `masterPassword.test.ts` の「restore the checkbox」テストを、set モーダルをチェックボックス操作で開いた状態から失敗させるシナリオへ書き換える
- [x] `REENCRYPT_VERIFY_FAILED` の失敗経路テスト(set と change)を追加する(read-back 不一致の注入方法を実装する)
- [x] 修正後、当該テストが意図した契約を壊す変更で赤くなることを確認する(テストのテスト)。本番コードは確認後に厳密に元へ戻す

## テスト戦略

### 単体
- 上記すべてが単体テストの修正・追加である

## 制約

- テスト修正が本番コードの挙動を変えない(assertion 修正のみ)
- `dev-docs/TEST_RULE.md` の規約に従う(実時間待ちの禁止等)

## 実装ガイド(低コストモデル向け)

この PBI はテストのみを変更する。本番コードの挙動は変えない。実装順は 08 -> 09 -> 06 -> 10 -> 11。08 / 09 が `encryptionSession.ts` を変更するため、行番号ではなく `grep -n` の出力で位置を特定する。

### 0. リポジトリ規約(必読)

- ファイルは Read ツールの `offset` / `limit` で読む。`sed` / `awk` / `head` / `tail` / `cat` は使わない。検索は `grep -n`
- コードとコード内コメントは英語。コメントは非自明な WHY のみ
- 本番コードで `any` / `unknown` 型を使わない(テストでは避けられない箇所のみ可)
- ESM の import は `.js` で終える
- テストを通すために固定時間待ちを入れない、retry 回数を上げない。awaited promise か `testDir/waitPolicy.ts` の `waitForMock` を使う
- `vi.useFakeTimers()` を既定オプションで呼ばない
- CRLF のファイルは CRLF を保つ(`file <path>` で確認。対象 4 ファイルは現状 LF)
- ツール呼び出しが権限で拒否されたら、迂回せず作業を止めて報告する

### 1. 前提と着手前チェック

```bash
cd /Users/yaar/Playground/obsidian-smart-history
grep -n "expect(setMasterPassword)" src/dashboard/__tests__/masterPassword-branches.test.ts src/dashboard/__tests__/masterPassword.test.ts
grep -n "REENCRYPT_VERIFY_FAILED" -r src testDir
grep -n "this.preToggleChecked" src/dashboard/masterPassword.ts
grep -n "toggle('hidden', mode === 'change')" src/dashboard/masterPassword.ts
git status --short
```

期待する出力:

- 1 本目: branches に 1 件(`:276` 付近)、`masterPassword.test.ts` に 3 件(`:788` / `:812` / `:901` 付近)。0 件なら既に修正済み。件数が違えば該当テストを Read で確認してから進める
- 2 本目: `src/utils/storage/encryptionSession.ts` の 1 件のみ(`throw new Error(...REENCRYPT_VERIFY_FAILED...)`)。テスト側にヒットするなら失敗経路テストが既にあるので、手順 5 は重複させない
- 3 本目: `= this.preToggleChecked` の代入が `catch` 内にある(PBI 07 着地の証拠)。無ければ順位 07 が未着地なので止めて報告する
- 4 本目: 1 件ヒットする(hidden のトグル)。無ければ止めて報告する
- 5 本目: 出力が空(作業ツリーがクリーン)。他の変更があれば触らない

### 2. 変更対象ファイル

編集する(テストのみ):

- `src/dashboard/__tests__/masterPassword-branches.test.ts`
- `src/dashboard/__tests__/masterPassword.test.ts`
- `src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts`
- 完了時に `pbi/2026-09-30-10-test-restore-assertion-integrity.md`(チェックボックスとアーカイブ移動のみ)

編集しない: `src/dashboard/masterPassword.ts`、`src/utils/storage/encryptionSession.ts` を含む全ての本番コード、`masterPassword-ui-state.test.ts`、`masterPassword-r2.test.ts`、`testDir/` 配下、他の PBI ファイル。本番コードは手順 3〜5 の変異チェックで一時的に書き換えるが、必ず元に戻し、最後に `git diff --stat` に本番ファイルが出ないことを確認する。

### 3. 変異チェック(テストのテスト)の共通手順

`git stash` は使わない。本番ファイルを退避して書き換え、実行し、復元する。

```bash
scratch=/private/tmp/claude-501/-Users-yaar-Playground-obsidian-smart-history/da95449b-76c0-48e3-a5cb-e4e3a778215f/scratchpad
cp src/dashboard/masterPassword.ts $scratch/masterPassword.ts.orig
# 1. Edit ツールで本番ファイルに一時変異を入れる(各手順に記載)
# 2. 対象テストだけ実行し、赤になることと失敗メッセージを確認する
npx vitest run src/dashboard/__tests__/masterPassword-branches.test.ts
# 3. 必ず復元する
cp $scratch/masterPassword.ts.orig src/dashboard/masterPassword.ts
# 4. 復元の確認(出力が空であること)
git diff --stat -- src/dashboard/masterPassword.ts src/utils/storage/encryptionSession.ts
```

`encryptionSession.ts` を変異させるときは、同じ形で `$scratch/encryptionSession.ts.orig` に退避する。変異が有効でテストが緑のままなら、そのテストは空振りである。assertion を直して再実行する。

### 4. 手順: ダッシュボード側の空振り(4 件)

共通の直し方: `expect(setMasterPassword).not.toHaveBeenCalled()`(utils 版)を、本番が呼ぶ `setMasterPasswordService` と `changeMasterPasswordService` への not-called に置き換える。両ファイルとも `setMasterPasswordService` / `changeMasterPasswordService` は import 済み。

**4-1. `masterPassword-branches.test.ts` の「mode=set requires matching confirm password」**

```ts
// before
await new Promise((r) => setTimeout(r, 0));
expect(setMasterPassword).not.toHaveBeenCalled();
// after
await waitForMock(() => expect(refs.passwordMatchError!.textContent).toBe('i18n_passwordMismatch'));
expect(setMasterPasswordService).not.toHaveBeenCalled();
expect(changeMasterPasswordService).not.toHaveBeenCalled();
```

`waitForMock` で本番が確実に不一致経路を通ったことを待つ(肯定的な錨)。錨の後に not-called を見るので、サービス呼び出しが遅れて起きる場合の見逃しも防げる。その後、`setMasterPassword` を使う行が無くなったら次を行う。

- 同ファイルの `vi.mocked(setMasterPassword).mockResolvedValue({ success: true });`(2 テストにある死んだ準備)を削除する
- `grep -n "setMasterPassword\b" src/dashboard/__tests__/masterPassword-branches.test.ts` で残りを確認し、コード上の参照が 0 になったら import 内の `setMasterPassword,` 行を削除する(未使用 import は lint エラー)。`vi.mock` のファクトリ内の定義は残す

変異: `src/dashboard/masterPassword.ts` の `if (validateAndSetMatchErrors(password, confirmPasswordValue, this.dom.passwordMatchError)) return;` を `validateAndSetMatchErrors(password, confirmPasswordValue, this.dom.passwordMatchError);` に変える(`return` を消す)。期待: 4-1 のテストが `expected "spy" to not be called at all, but actually been called 1 times`(`setMasterPasswordService` に対して)で赤になる。

**4-2. `masterPassword.test.ts` の「should show validation error when validatePasswordRequirements fails」**(`:788` 付近)

```ts
// before
expect(setMasterPassword).not.toHaveBeenCalled();
// after
expect(setMasterPasswordService).not.toHaveBeenCalled();
expect(changeMasterPasswordService).not.toHaveBeenCalled();
```

変異: `if (validateAndSetPasswordErrors(password, this.dom.passwordStrengthError)) return;` の `if (...) return;` を外して呼び出しだけにする。期待: エラー表示の assertion は通り、not-called の assertion で赤になる。

**4-3. 「should show match error when passwords do not match in set mode」**(`:812` 付近)

4-2 と同じ置き換え。変異は 4-1 と同じ(match の `return` を消す)。

**4-4. 「should do nothing when masterPasswordInput element is null」**(`:901` 付近)

4-2 と同じ置き換え(`await flushPromises()` は既存のまま残す。このテストには待つべき肯定的な錨が無く、負の証明のみのため)。

変異(2 箇所を同時に変える): `savePassword()` と `savePasswordInner()` の冒頭にある `if (!this.dom.masterPasswordInput) return;` の 2 行を削除し、`const password = this.dom.masterPasswordInput.value;` を `const password = this.dom.masterPasswordInput?.value ?? 'ValidP@ss1';` に変える。期待: `setMasterPasswordService` が呼ばれ、not-called で赤になる。1 箇所だけの変異では TypeError で止まりサービスに届かないため、必ず 3 行を同時に変える。

`masterPassword.test.ts` は `setupDefaultMockValues` が utils 版 `setMasterPassword` を使うため、import は消さない。

**4-5. 「should restore the checkbox when the service throws during save」**(`:864` 付近)を書き換える

同ファイル内の `openModalViaCheckbox()`(`isMasterPasswordSet` を false にしてチェックボックスを ON にし、set モーダルが `show` になるまで待つ)を使い、本番で到達可能な経路から失敗させる。

```ts
it('should restore the checkbox to OFF when the service throws during a set save', async () => {
  vi.mocked(setMasterPasswordService).mockRejectedValue(new Error('KDF failed'));
  setupFullDOM();
  vi.resetModules();
  const { initMasterPasswordSettings } = await import('../masterPassword.js');
  initMasterPasswordSettings();

  await openModalViaCheckbox(); // checkbox is now checked, preToggleChecked === false
  const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'ValidP@ss1';
  (document.getElementById('masterPasswordConfirm') as HTMLInputElement).value = 'ValidP@ss1';

  document.getElementById('savePasswordBtn')!.click();

  await waitForMock(() => expect(showStatus).toHaveBeenCalledWith('status', 'KDF failed', 'error'));
  expect(checkbox.checked).toBe(false);
});
```

変異: `catch` 内の `this.dom.masterPasswordEnabled.checked = this.preToggleChecked;` を削除(または `= true`)。期待: 最後の `expect(checkbox.checked).toBe(false)` が `expected true to be false` で赤になる。旧テストは同じ変異で緑のままだった。`masterPassword-ui-state.test.ts` に近いテストがあるが、こちらは実 `setupFullDOM` fixture の回帰として残す(消さない)。

### 5. 手順: `REENCRYPT_VERIFY_FAILED` の失敗経路(`encryptionSession-reencrypt.test.ts`)

read-back は `reencryptApiKeysToKek` 内の 2 回目の `readApiKeyPlacements`(`port.get(['settings', ...API_KEY_FIELD_NAMES])`)で、`port` は `ChromeStoragePort`(実体は `chrome.storage.local`)。テストのグローバル `chrome.storage.local.get` / `set` は `vi.fn` なので、「ciphertext を書いた後の get だけ値を汚す」ラッパで注入する。この注入コードは実機で未検証のため、通らない場合は手順末尾の診断に従う。

ファイル末尾の `describe('KEK rotation — resume', ...)` の後(最外 `describe` の内側)に追加する。

```ts
describe('KEK rotation — read-back failure', () => {
  // Corrupts only reads issued after the rotation wrote ciphertext, so the
  // pre-write plan sees real data and the verification sees a mismatch.
  function corruptReadBackAfterWrite(field: string): () => void {
    const getMock = vi.mocked(chrome.storage.local.get) as unknown as ReturnType<typeof vi.fn>;
    const setMock = vi.mocked(chrome.storage.local.set) as unknown as ReturnType<typeof vi.fn>;
    const originalGet = getMock.getMockImplementation()!;
    const originalSet = setMock.getMockImplementation()!;
    let written = false;
    setMock.mockImplementation((items: Record<string, unknown>) => {
      if ('settings' in items || field in items) written = true;
      return originalSet(items);
    });
    getMock.mockImplementation(async (keys?: unknown) => {
      const result = (await originalGet(keys)) as Record<string, unknown>;
      if (!written || !Array.isArray(keys) || !keys.includes('settings')) return result;
      const bogus = { ciphertext: btoa('x'.repeat(32)), iv: btoa('y'.repeat(12)) };
      const nested = (result['settings'] ?? {}) as Record<string, unknown>;
      return { ...result, settings: { ...nested, [field]: bogus } };
    });
    return () => {
      getMock.mockImplementation(originalGet);
      setMock.mockImplementation(originalSet);
    };
  }

  it('set: fails with REENCRYPT_VERIFY_FAILED and never writes auth metadata', async () => {
    await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
    const metaBefore = await snapshotAuth();
    const restore = corruptReadBackAfterWrite('obsidian_api_key');
    try {
      await expect(setMasterPassword('NewP@ssw0rd123!')).rejects.toThrow('REENCRYPT_VERIFY_FAILED');
    } finally {
      restore();
    }
    expect(await snapshotAuth()).toEqual(metaBefore);
    expect(await isMasterPasswordEnabled()).toBe(false);
  });

  it('change: fails with REENCRYPT_VERIFY_FAILED and leaves the previous auth metadata', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await unlockWithPassword('OldP@ssw0rd123!');
    await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
    const metaBefore = await snapshotAuth();
    const restore = corruptReadBackAfterWrite('obsidian_api_key');
    try {
      await expect(changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!')).rejects.toThrow('REENCRYPT_VERIFY_FAILED');
    } finally {
      restore();
    }
    expect(await snapshotAuth()).toEqual(metaBefore);
  });
});
```

なぜこの形か: 本番の pre-write 読み取りを汚すと `ReencryptionAbortedError` になり別経路のテストになる。書き込み後に限定することで、read-back 検証だけを落とせる。`vi.clearAllMocks()` は実装を戻さないため、`finally` の `restore()` が必須。

診断(赤のまま通らない場合、順に確認): (a) `chrome.storage.local.set` の呼び出しキーを `console.log` で確認し `written` の判定条件を合わせる(nested の書き込みは `StorageTransaction.withLock('settings', ...)` 経由)。(b) 失敗が `ReencryptionAbortedError` なら注入が早すぎる。(c) 原因が特定できなければ固定待ちや retry で誤魔化さず、観測と仮説を報告して止まる。確認用のログは提出前に必ず消す。

変異(RED): `src/utils/storage/encryptionSession.ts` の `reencryptApiKeysToKek` 末尾、`if (roundTripped === null || !(await constantTimeCompare(roundTripped, item.plaintext))) {` から対応する `}` までの `throw` を、Edit で `// mutation` に置き換えて throw を無効にする(if 文の構文は保つ)。期待: 2 テストとも `rejects` の段階で `promise resolved ... instead of rejecting` 系のメッセージで赤になる(throw が無効なら set / change は正常終了するため)。変異後は `finally` の復元、`cp` による本番ファイルの復元まで済ませてから次へ進む。

### 6. 既存テストへの影響

- `masterPassword-branches.test.ts` の `setMasterPassword` import を消すのは、他テストが参照しない場合のみ(手順 4-1 の grep)
- `masterPassword.test.ts` の `setupFullDOM` / `openModalViaCheckbox` / `setupDefaultMockValues` は同ファイル内の多数のテストが共有する。4-5 は新規のテスト本体を書くだけで、これらのヘルパは変更しない
- `masterPassword-ui-state.test.ts` / `masterPassword-r2.test.ts` / `masterPassword-enhanced.test.ts` / `masterPassword-set-guard.test.ts` は編集しない。fixture の共有は無い(各ファイルが独自の DOM を持つ)
- `encryptionSession-reencrypt.test.ts` の追加テストは既存テストと状態を共有しない(`beforeEach` が storage と鍵を初期化する)

### 7. 検証コマンド(順番どおり)

```bash
cd /Users/yaar/Playground/obsidian-smart-history
npm run type-check
files=(
  src/dashboard/__tests__/masterPassword-branches.test.ts
  src/dashboard/__tests__/masterPassword.test.ts
  src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts
)
npx eslint "${files[@]}"
npx vitest run src/utils src/dashboard src/background src/popup
npx vitest run "${files[@]}" --repeats=20
git diff --stat
```

全て緑であること。最後の `git diff --stat` に出るのは `files` の 3 ファイルだけ(本番ファイルが出たら変異の戻し忘れ)。

### 8. 落とし穴

- 変異は必ず元に戻す。`cp $scratch/...orig` で復元し、`git diff --stat -- <本番ファイル>` が空であることを確認してから次へ進む。`git stash` / `git checkout` での退避・復元はしない
- 他の assertion を弱めない(`toBe` を `toBeDefined` にする、期待値を消す、`expect` を減らす等はしない)
- 固定時間待ち・retry 増で通さない。新規の待ちは `waitForMock` のみ
- 型を `any` / `unknown` でごまかさない(注入ヘルパのキャストは上記の範囲に限る)。テストで避けられない箇所のみ許容
- CRLF のファイルではない(現状 LF)が、着手時に `file <path>` で再確認し、CRLF なら改行を保つ
- 行番号は 08 / 09 の着地でずれる。`grep -n` の出力と Read で確認してから編集する
- テスト名が変わると他の参照が壊れうる。4-5 で名前を変えたら `grep -rn "restore the checkbox" src` で参照を確認する

### 9. コミットとアーカイブ手順

```bash
cd /Users/yaar/Playground/obsidian-smart-history
pbi=2026-09-30-10-test-restore-assertion-integrity.md
files=(
  src/dashboard/__tests__/masterPassword-branches.test.ts
  src/dashboard/__tests__/masterPassword.test.ts
  src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts
)
```

(a) 本ファイルの受け入れ基準と Definition of Done の `- [ ]` を Edit で `- [x]` にする。ただし `コードレビュー完了` は `- [ ]` のまま残す。

(b) 対象ファイルだけを個別に add する(`git add -A` / `git add .` は使わない。zsh では文字列変数は分割されないため、配列を `"${files[@]}"` で展開する)。

```bash
git add "${files[@]}"
```

(c) テストのコミット(本文に理由を書く):

```bash
git commit -m "test(dashboard): 空振りだった assertion を本番シンボルに向け read-back 失敗経路を検証する" \
  -m "utils 版 setMasterPassword を対象にした not-called は本番が呼ばないため常に成立し、確認ロジックを壊しても赤にならなかった。encryptionSession 版のサービスに向け直し、肯定的な錨と変異チェックで空振りでないことを確認した。REENCRYPT_VERIFY_FAILED は read-back 不一致を注入して、認証メタデータが書かれない契約の失敗側を固定した。" \
  -- "${files[@]}"
```

(d) アーカイブ(PBI ファイルを add してから移動し、同じ形でコミット):

```bash
git add "pbi/$pbi"
git mv "pbi/$pbi" dev-docs/archived/pbi/
git commit -m "docs(pbi): 09-30 PBI 10(テストの空振り assertion 修正)をアーカイブする" \
  -- "pbi/$pbi" "dev-docs/archived/pbi/$pbi"
```

`git status --short` が空であることを確認する。push はしない。

### 10. 完了条件(レビュアー用)

- [ ] `grep -n "expect(setMasterPassword)" src/dashboard/__tests__/masterPassword-branches.test.ts` の出力が空で、`masterPassword.test.ts` にも本番で呼ばれない utils 版への not-called が残っていない
- [ ] 4-1〜4-5 の各変異で対象テストが赤になり、復元後に緑に戻ることを確認した(失敗メッセージを記録した)
- [ ] `REENCRYPT_VERIFY_FAILED` のテストが set と change の 2 件あり、変異(throw 無効化)で赤になる
- [ ] `git diff --stat` に本番ファイルが含まれない
- [ ] 手順 7 のコマンドが全て緑(`--repeats=20` を含む)
- [ ] 固定時間待ち・retry 増・型の緩和を導入していない
- [ ] テストコミットとアーカイブコミットが分かれ、`git add -A` を使っていない

## 見積もり

1 SP

## Definition of Done

- [x] 全修正済みテストが green
- [x] 意図的破壊テスト(契約を壊すと赤になる)の確認済み
- [ ] コードレビュー完了
