# PBI: SW での復号キー導出失敗を握りつぶさずロック状態として伝搬する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを有効化したユーザーとして、バックグラウンドの AI 呼び出しや Obsidian 保存が「Bearer [object Object]」「API key is missing」のような原因不明の失敗にならず、ロック中であることが明示されたい。なぜなら、service worker には `cachedMasterPassword` を書く経路が存在せず、キー導出の throw が握りつぶされて ciphertext がそのまま `apiKey` として使われるから。

## 優先度

- 順位: 6 / 13
- RICE スコア: 4.8(Reach=2 / Impact=3 / Confidence=0.8 / Effort=1.0)
- 根拠: 機能全壊級の重大度だが、修正はエラー伝搬・型検証・UI 誘導の組立であり工数は中。失敗モードの「沈黙」が最も悪い部分。

## 証拠(レビュー由来・配線を直接確認済み)

呼び出し連鎖(関数名基準。行番号は目安):

- `applyMigrationsCore`(`src/utils/storage/settingsMigration.ts`)— `keyProvider()` の呼び出しが try 内。catch が `logError(..., CRYPTO_KEY_DERIVE_FAILURE)` のみで `return { settings: merged, reEncrypted, unrecoverable }` し、`merged` の API キーは `EncryptedData` のまま
- `compositionManifest.ts` の `settingsRepository` エントリ — `new SettingsRepository(new SettingsChromeStorageAdapter())` で keyProvider 注入なし。`SettingsRepository.resolveKeyProvider` が `encryptionSession.js` の `getOrCreateEncryptionKey` を動的 import する
- `getOrCreateEncryptionKey` → `deriveKeyFromMasterPassword` — SW では `cachedMasterPassword` が常に null のため `throw new Error('ENCRYPTION_LOCKED: Master password required')`。IS_LOCKED 経路は `'ENCRYPTION_LOCKED: Session is locked'`。専用エラークラスは無く、メッセージ接頭辞のみ
- `unlockWithPassword` の本番呼び出しは `changeMasterPassword` 内のみ。background/popup/messaging に SW 向けアンロック経路は無い(SW は復号できない)
- AI: `RemoteAIService.loadSettings` → `repo.getAll()` → `processSummarySlot` が `factory(effectiveSettings)`(= `createProviderStrategy`)を try 内で構築し、catch が汎用文言 `Error: Failed to generate summary...` に潰す。`GenericOpenAICompatibleProvider` コンストラクタ(`OpenAIProvider.ts`)は `this.apiKey = s[entry.apiKeyKey] as string | undefined`(型検証なし)で、object のまま `Bearer ${this.apiKey}` になる。`GeminiProvider` も `settings[StorageKeys.GEMINI_API_KEY] as string | undefined` で同様(`x-goog-api-key` に object が入る)
- Obsidian: `saveToObsidianStep` → `ObsidianClient.appendToDailyNote` → `_getConfig` → `buildObsidianConfig` の `buildFromSettings` が `typeof apiKey === 'object'` を「`Error: API key is missing. Please check your Obsidian settings.`」として投げる(ロックが原因と分からない)。`buildFromOverride` 側は `typeof apiKey !== 'string'` で `API key is missing`
- `saveToObsidianStep` は例外を再 throw し、pipeline が `error.message` を通知と pending キューに渡す。`testConnection` 系 catch は `API key is missing` を含むメッセージを CONFIGURATION として扱う

## BDD 受け入れシナリオ

```gherkin
  Scenario: ロック中の AI 呼び出しは明示的なロックエラーで失敗する
    Given マスターパスワードが有効で service worker がロック状態である
    When AI 呼び出しが行われる
    Then リクエストは送信されずロックを示すエラーコードで失敗する
    And Authorization ヘッダに ciphertext 由来の値が使われない

  Scenario: Obsidian 保存もロックを理由として失敗する
    Given 同じロック状態である
    When Obsidian への保存が行われる
    Then ロックを示すエラーで失敗する
    And 「API key is missing」とは表示されない
```

## 受け入れ基準

- [ ] `applyMigrationsAndDecryptWithReEncrypt` がキー導出失敗を握りつぶさず、ロック状態を示すシグナル(結果フィールドまたは専用エラー)を返す
- [ ] `OpenAIProvider` を含む apiKey 消費者が、string 以外の値を黙って使わず明示エラーにする
- [ ] ロック状態のエラーが通知・AI 要約結果・接続テスト結果まで届き、i18n 文言(en/ja)でロックが原因だと分かる(SW 向け unlock 経路は本 PBI の範囲外で、文言は「バックグラウンドでは使えない」ことを明示する)
- [ ] 既存の decrypt 成功パスと migration 挙動は変えない

## テスト戦略

### 統合
- マスターパスワード有効 + ロック状態で AI 呼び出し・Obsidian 保存がロックエラーになることを検証する
- ciphertext が Authorization ヘッダに使われないことを検証する

### 単体
- `applyMigrationsAndDecryptWithReEncrypt` のキー導出失敗時の返却形を検証する

## 設計判断

- `SettingsRepository.getAll` は throw しない。ロック中でも API キー以外の設定(ドメインフィルタ等)は SW が使うため、throw すると記録全体が止まる。ciphertext は `settings` に残したまま(blank 禁止)、消費者が「object の API キー = 未復号」として `EncryptionLockedError` を投げる
- SW への unlock 経路は追加しない(範囲外)。ユーザー向けには「API キーがマスターパスワードでロックされておりバックグラウンド処理では使えない」ことを i18n 文言で明示する。SW 側アンロックの設計は別 PBI とする

## 制約

- ロック状態で平文キーが露出する挙動を導入しない
- async/await のみ。ESM import は `.js` 拡張子

## 実装ガイド(低コストモデル向け)

### 0. リポジトリ規則(必読)

- ファイルは Read ツールの offset/limit で読む。`sed` / `awk` / `head` / `tail` / `cat` は使わない。検索は `grep -n`
- コードとコード内コメントは英語。コメントは非自明な WHY のみ
- 本番コードで `any` / `unknown` を使わない(テストは可)
- ESM import は必ず `.js` 拡張子
- 固定時間待ち(`setTimeout` / `sleep` / `waitForTimeout`)や retry 回数の引き上げでテストを通さない。await した Promise か `testDir/waitPolicy.ts` の `waitForMock` を使う。`vi.useFakeTimers()` を既定オプションで呼ばない
- CRLF のファイルは CRLF を保つ(編集前に `file <path>` で確認。本 PBI の対象ファイルは現状すべて LF)
- ツール呼び出しが権限で拒否されたら、回避せず作業を止めて報告する
- シェルは zsh。パス一覧は配列に入れる(`files=(a b c)` と `"${files[@]}"`)。クォート無しの文字列変数は分割されない

### 1. 前提と着手前チェック

PBI 01 / 02 / 03 / 04 / 05 / 07 / 12 / 13 は着地済み(アーカイブ済み)。PBI 08 / 09 は `encryptionSession.ts` を編集するが、本 PBI は同ファイルを編集しない。ただしロック判定は `ENCRYPTION_LOCKED` というメッセージ接頭辞に依存するため、次を確認する。

```bash
grep -n "ENCRYPTION_LOCKED" src/utils/storage/encryptionSession.ts
```
期待: `throw new Error('ENCRYPTION_LOCKED: Master password required')` と `throw new Error('ENCRYPTION_LOCKED: Session is locked')` の 2 行以上。接頭辞が変わっていたら、判定を新しい接頭辞に合わせ(手順 1 の `isEncryptionLockedError`)、テストのメッセージも同じ文字列にする。

```bash
grep -n "unrecoverable\|getEncryptionKey" src/utils/storage/settingsMigration.ts
grep -n "async function processSummarySlot\|private async processSummarySlot" src/background/ai/RemoteAIService.ts
grep -n "typeof apiKey" src/utils/obsidianConfigBuilder.ts
```
期待: `ApplyMigrationsResult` に `unrecoverable: StorageKey[]` がある / `processSummarySlot` が 1 件 / `typeof apiKey` が 2 件(`buildFromSettings` の `=== 'object'` と `buildFromOverride` の `!== 'string'`)。合わなければ着手せず報告する。

エラー種別の登録は不要: 新しい `ErrorCode` は追加しない(`dev-docs/ERROR_CODES.md` 変更なし)、新しいメッセージ型も無い(messaging バリデータ変更なし)。レイヤー: 新ファイルは import が `../i18n.js` のみで `LAYER0_FILES` / `LAYER1_FILES` に載せない(`eslint/rules/utils-layer-boundary.mjs` の対象外)。`src/background/` から `src/utils/` への import は合法。逆向き(utils から background)は作らない。

### 2. 変更対象ファイル

編集: `src/utils/storage/settingsMigration.ts` / `src/background/ai/RemoteAIService.ts` / `src/background/ai/providers/OpenAIProvider.ts` / `src/background/ai/providers/GeminiProvider.ts` / `src/utils/obsidianConfigBuilder.ts` / `src/background/obsidianClient.ts` / `public/_locales/en/messages.json` / `public/_locales/ja/messages.json`

新規: `src/utils/storage/encryptionLockedError.ts` と、節 4 のテスト 5 ファイル

触らない: `src/utils/storage/encryptionSession.ts`(PBI 08/09 の領域)/ `src/utils/storage/SettingsRepository.ts`(`getAll` は throw させない。設計判断を参照)/ `src/background/compositionManifest.ts` / `src/utils/logger/types.ts`(ErrorCode 追加なし)/ `dev-docs/ERROR_CODES.md` / 他の PBI ファイル / `manifest.json`(新ファイルは background と dashboard からのみ import され、content script は import しない)

### 3. 手順(節 4 のテストを先に書いて RED を確認してから実施する)

1. 新規 `src/utils/storage/encryptionLockedError.ts`

```ts
import { getMessageOr } from '../i18n.js';

export const ENCRYPTION_LOCKED_CODE = 'ENCRYPTION_LOCKED';

const FALLBACK_MESSAGE =
  'Your API keys are locked by the master password and cannot be used by background tasks. Open the dashboard and review the master password setting.';

export class EncryptionLockedError extends Error {
  readonly code = ENCRYPTION_LOCKED_CODE;
  constructor() {
    super(getMessageOr('encryptionLockedApiKeys', FALLBACK_MESSAGE));
    this.name = 'EncryptionLockedError';
  }
}

// encryptionSession throws plain Errors prefixed with the code, so match both shapes.
export function isEncryptionLockedError(e: unknown): boolean {
  return e instanceof EncryptionLockedError
    || (e instanceof Error && e.message.startsWith(`${ENCRYPTION_LOCKED_CODE}:`));
}

// A non-null object here is the undecrypted envelope: decryption always yields a string.
export function assertApiKeyResolved(value: unknown): void {
  if (typeof value === 'object' && value !== null) throw new EncryptionLockedError();
}
```
2 つの関数の引数だけは、`catch (error: unknown)` と `let apiKey: unknown`(`buildFromOverride`)の値をそのまま受けるため、`errorMessage(error: unknown)`(`src/utils/errorUtils.ts`)と同じ慣例で `unknown` を許す(入力を検査して narrow するだけの型ガード)。エラーメッセージに値を含めない。

2. `settingsMigration.ts` の `ApplyMigrationsResult` に `locked: boolean` を追加(コメント: true when the key provider refused because the session is locked; ciphertext is left untouched in `settings`)。ファイル先頭の import に `import { isEncryptionLockedError } from './encryptionLockedError.js';` を追加

3. `settingsMigration.ts` の `applyMigrationsCore`

```ts
// before
const unrecoverable: StorageKey[] = [];
try { ... } catch (e) {
    await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
}
return { settings: merged, reEncrypted, unrecoverable };

// after
const unrecoverable: StorageKey[] = [];
let locked = false;
try { ... } catch (e) {
    if (isEncryptionLockedError(e)) {
        locked = true;
        await logWarn('Encryption key unavailable: session is locked', {}, undefined, 'settingsMigration');
    } else {
        await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
    }
}
return { settings: merged, reEncrypted, unrecoverable, locked };
```
ロックは SW で `getAll` のたびに起きる想定状態のため warn に落とす。ロック以外の失敗は従来どおり logError で握りつぶす(挙動不変)。

4. 消費者にガードを入れる(1 ファイル 1 ステップ相当。各ファイルで `import { assertApiKeyResolved, isEncryptionLockedError } from '<相対>/utils/storage/encryptionLockedError.js';` の必要分のみ)
   a. `OpenAIProvider.ts` の `GenericOpenAICompatibleProvider` コンストラクタ: `this.apiKey = s[entry.apiKeyKey] as string | undefined;` を `const rawKey = s[entry.apiKeyKey]; assertApiKeyResolved(rawKey); this.apiKey = rawKey as string | undefined;` に。legacy fallback の `this.apiKey = s[\`${normalizedName}_api_key\`] as string | undefined;` も同様
   b. `GeminiProvider.ts`: `const storedKey = settings[StorageKeys.GEMINI_API_KEY] as string | undefined;` の直前に `assertApiKeyResolved(settings[StorageKeys.GEMINI_API_KEY]);`
   c. `obsidianConfigBuilder.ts`: `buildFromSettings` の `if (!apiKey || apiKey === '' || typeof apiKey === 'object')` の直前に `assertApiKeyResolved(apiKey);`。`typeof apiKey === 'object'` の枝は `null` 対策として残してよい。`buildFromOverride` の `if (!apiKey || typeof apiKey !== 'string')` の直前にも `assertApiKeyResolved(apiKey);`
   d. `RemoteAIService.ts` の `processSummarySlot` の catch の先頭

```ts
} catch (error: unknown) {
  if (isEncryptionLockedError(error)) {
    addLog(LogType.WARN, 'AI provider slot skipped: API keys are locked', { traceId });
    return {
      success: false,
      summary: `Error: ${errorMessage(error)}`,
      failure: createFailure(FailureKind.CONFIGURATION),
    };
  }
  addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
  ...
```
   `CONFIGURATION` は `breakerInputFor` が `ignore` を返すため breaker を開かない(アンロック後に 15 分閉じ込められない)。`testConnection` 側の catch は `message: msg` を返すので変更不要
   e. `obsidianClient.ts` の `testConnection`: override 分岐の catch と外側の catch に、`msg.includes('API key is missing')` より前に `if (isEncryptionLockedError(e)) return withFailure({ success: false, message: errorMessage(e) }, connectionTestFailure(e, FailureKind.CONFIGURATION));`(外側は `else if` 連鎖の先頭に同内容)。`appendToDailyNote` は変更不要(`_getConfig` の例外は内側 try の外なので `_handleError` を通らずそのまま pipeline に伝わる)

5. i18n: `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` の `"masterPasswordReencryptAborted"` の直前に同じキーを追加

```json
  "encryptionLockedApiKeys": {
    "message": "Your API keys are locked by the master password and cannot be used by background tasks. Open the dashboard and review the master password setting."
  },
```
ja: `"API キーがマスターパスワードでロックされているため、バックグラウンド処理では使用できません。ダッシュボードでマスターパスワードの設定を確認してください。"`。en の文言は `FALLBACK_MESSAGE` と一致させる。追加後 `node -e "JSON.parse(require('fs').readFileSync('public/_locales/en/messages.json','utf8'))"` を ja にも実行して構文を確認する

### 4. テスト先行(RED)

各テストは実装前に `npx vitest run <file>` で実行し、失敗(未実装の import 解決エラーまたは assertion 失敗)を確認してから手順 3 を実装する。

1. `src/utils/storage/__tests__/settingsMigration-locked.test.ts`(`settingsMigration-unrecoverable.test.ts` の logger モック 3 ブロックと `generateKey` をそのままコピーする)
   - `flags locked and keeps ciphertext when the key provider reports ENCRYPTION_LOCKED`: Given `encryptApiKey('sk-secret', await generateKey(), StorageKeys.GEMINI_API_KEY)` の ciphertext を `{ [StorageKeys.GEMINI_API_KEY]: ciphertext }` で渡し、`getEncryptionKey: async () => { throw new Error('ENCRYPTION_LOCKED: Master password required'); }` を指定。When `applyMigrationsAndDecryptWithReEncrypt`。Then `result.locked` が `true`、`result.settings[StorageKeys.GEMINI_API_KEY]` が `toEqual(ciphertext)`、`result.reEncrypted` が `{}`、`result.unrecoverable` が長さ 0
   - `does not flag locked for other key derivation failures`: `throw new Error('CORRUPTION: encryption salt missing')` で `locked` が `false`、settings は ciphertext のまま
   - `reports locked=false when decryption succeeds`: 正しい鍵で `locked` が `false`、値が `'sk-secret'`
2. `src/utils/storage/__tests__/encryptionLockedError.test.ts`(モック不要)
   - `isEncryptionLockedError` が `new EncryptionLockedError()` と `new Error('ENCRYPTION_LOCKED: Session is locked')` で `true`、`new Error('CORRUPTION: x')` と文字列 `'ENCRYPTION_LOCKED'` で `false`
   - `assertApiKeyResolved({ iv: 'a', ciphertext: 'b' } as never)` が `EncryptionLockedError` を投げ、`assertApiKeyResolved('sk-x')` / `undefined` / `''` は投げない
   - 投げられたエラーの `message` に `'ciphertext'` と `'iv'` の値が含まれない
3. `src/background/ai/providers/__tests__/apiKeyLocked.test.ts`(`OpenAIProvider.test.ts` の `vi.mock` 群と `baseSettings` パターンをコピー)
   - `OpenAIProvider rejects an undecrypted (object) API key`: `new OpenAIProvider({ ...baseSettings, openai_api_key: { iv: 'a', ciphertext: 'b' } } as unknown as Settings)` が `toThrow(EncryptionLockedError)`
   - `GeminiProvider rejects an undecrypted (object) API key`: `gemini_api_key` に同様の object(`GeminiProvider.test.ts` の `baseSettings`)
4. `src/background/ai/__tests__/RemoteAIService-locked.test.ts`(`RemoteAIService.test.ts` の `makeRepo` と `vi.mock('../../../utils/auditLog.js', ...)` をコピー。プロバイダは差し替えず既定の `createProviderStrategy` を使う)
   - Given `global.fetch = vi.fn()`、settings `{ ai_provider_priority_list: [{ provider: 'openai' }], ai_provider: 'openai', summary_min_length: 0, openai_api_key: { iv: 'a', ciphertext: 'b' } }`。When `generateSummary('content', { url: 'https://example.com' })`。Then `success` が `false`、`summary` が `'master password'` を含み、`'Failed to generate summary'` を含まない、`failure?.kind` が `'configuration'`、`expect(global.fetch).not.toHaveBeenCalled()`
5. `src/background/__tests__/obsidianConfigBuilder-locked.test.ts`
   - `vi.mock('../../utils/storage/SettingsRepository.js', () => ({ settingsRepository: { getAll: vi.fn(), get: vi.fn() } }))`。`buildFromSettings`: `getAll` が `{ [StorageKeys.OBSIDIAN_HOST]: '127.0.0.1', [StorageKeys.OBSIDIAN_PROTOCOL]: 'http', [StorageKeys.OBSIDIAN_PORT]: '27123', [StorageKeys.OBSIDIAN_API_KEY]: { iv: 'a', ciphertext: 'b' } }` を返す。Then `buildObsidianConfig()` が `rejects.toBeInstanceOf(EncryptionLockedError)` かつメッセージが `/API key is missing/` に一致しない
   - override 経路: `buildObsidianConfig({ protocol: 'http', host: '127.0.0.1', port: '27123' })` で `get` が host キーには `'127.0.0.1'`、`OBSIDIAN_API_KEY` には object を返す(`mockImplementation(async (k) => ...)`)。Then 同様に `EncryptionLockedError`

### 5. 既存テストへの影響

- `vi.mock` にファクトリを渡しているテストは、新しい export を足す必要が生じない(既存モジュールの export は増やしていない)。ただし `i18n.js` をファクトリでモックしていて `getMessageOr` を含まないテストがロック経路を通ると `No "getMessageOr" export is defined on the mock` になる。その場合はそのファクトリに `getMessageOr: (_key: string, fallback: string) => fallback` を足す
- `ApplyMigrationsResult` に必須フィールド `locked` を足すため、この型の値を手組みするテスト/モックは `npm run type-check` が指摘する。`src/utils/storage/__tests__/settingsMigration-*.test.ts` と `settingsApiKeyFieldBinding.test.ts` は `unrecoverable` 等の個別 assertion のみで壊れない見込み。壊れたら `locked: false` を足す
- `API key is missing` を assert する既存テスト(`src/background/__tests__/obsidianClient.test.ts` / `obsidianClient-mutex.test.ts` / `obsidianClient-api-key-leak.test.ts` / `GeminiProvider.test.ts`)は空文字・未設定(string または undefined)を渡しており、ガードは object にしか反応しないため壊れない。壊れたら fixture が object を渡していないか確認し、期待をロックエラーに直す
- `src/utils/__tests__/storage-locking.test.ts` は `crypto.subtle` を空の `vi.fn()` でスタブして空文字を生成する。本変更のガードは「object の値」と「`ENCRYPTION_LOCKED` 接頭辞のエラー」だけに反応するので影響しない見込み。実装者は全体スイートで確認すること(このファイルと `src/utils/__tests__/storage-security.test.ts` は本ガイド作成時に中身を確認できていない)
- `src/utils/storage/__tests__/encryptionSession-*.test.ts` は本 PBI で触れない

### 6. 検証コマンド(この順)

```bash
npm run type-check
files=(src/utils/storage/encryptionLockedError.ts src/utils/storage/settingsMigration.ts src/background/ai/RemoteAIService.ts src/background/ai/providers/OpenAIProvider.ts src/background/ai/providers/GeminiProvider.ts src/utils/obsidianConfigBuilder.ts src/background/obsidianClient.ts)
npx eslint "${files[@]}"
npm run lint:layers-docs
npx vitest run src/utils src/dashboard src/background src/popup
tests=(src/utils/storage/__tests__/settingsMigration-locked.test.ts src/utils/storage/__tests__/encryptionLockedError.test.ts src/background/ai/providers/__tests__/apiKeyLocked.test.ts src/background/ai/__tests__/RemoteAIService-locked.test.ts src/background/__tests__/obsidianConfigBuilder-locked.test.ts)
npx vitest run "${tests[@]}" --repeats=20
```
`npx vitest run src/utils src/dashboard src/background src/popup` は全件 green であること。E2E は不要(UI 変更なし)。i18n は en/ja 両方に同じキーを足したことを `grep -n "encryptionLockedApiKeys" public/_locales/en/messages.json public/_locales/ja/messages.json` で 2 件確認する。

### 7. 落とし穴

- `SettingsRepository.getAll` を throw させない: ロック中でも API キー以外の設定を SW が使うため、throw すると記録全体が止まる
- 握りつぶしを残す箇所: ロック以外のキー導出失敗(CORRUPTION 等)は従来どおり logError して settings を返す(既存の migration 挙動を変えない)。伝搬させるのは「object の API キーを実際に使う瞬間」だけ
- アンロック後の復旧: breaker は `CONFIGURATION` を無視するので、ロック失敗でプロバイダが 15 分停止することはない。`FailureKind.AUTH` を使わない(即座に breaker が開く)
- pipeline はロックエラーを `error.message` で通知し pending に積む。再試行は同じ理由で失敗し続けるが、本 PBI では退避ロジックを変えない(SW アンロックは別 PBI)
- ciphertext を blank しない: `settings` の値を `''` に置換すると後続の書き込みで暗号文が失われる(`settingsMigration-unrecoverable.test.ts` が保証している)
- ログ・エラーメッセージに API キー、ciphertext(`iv` / `ciphertext`)、平文の値を出さない。フィールド名は可
- `isEncryptionLockedError` はメッセージ接頭辞一致を残す。`encryptionSession.ts` は plain `Error` を投げるため、`instanceof` だけでは実際の SW ロックを検出できない
- `assertApiKeyResolved` は空文字・undefined を許す。未設定は従来どおり「API key is missing」で、ロックとは別の状態

### 8. コミットとアーカイブ手順

(a) この PBI の受け入れ基準と DoD のチェックボックスを `[x]` にする。`コードレビュー完了` だけは `[ ]` のまま。

(b)(c) 実装をコミット(本文は WHY):

```bash
files=(src/utils/storage/encryptionLockedError.ts src/utils/storage/settingsMigration.ts src/background/ai/RemoteAIService.ts src/background/ai/providers/OpenAIProvider.ts src/background/ai/providers/GeminiProvider.ts src/utils/obsidianConfigBuilder.ts src/background/obsidianClient.ts public/_locales/en/messages.json public/_locales/ja/messages.json src/utils/storage/__tests__/settingsMigration-locked.test.ts src/utils/storage/__tests__/encryptionLockedError.test.ts src/background/ai/providers/__tests__/apiKeyLocked.test.ts src/background/ai/__tests__/RemoteAIService-locked.test.ts src/background/__tests__/obsidianConfigBuilder-locked.test.ts)
git add "${files[@]}"
git commit -m "fix(security): SW のロック中に API キーの暗号文を使わずロックエラーで失敗させる" -m "service worker には cachedMasterPassword を書く経路が無く、キー導出の失敗が握りつぶされて暗号文が apiKey として使われていた。object の API キーは EncryptionLockedError で明示的に失敗させ、原因不明の Bearer [object Object] や API key is missing を出さない。breaker は CONFIGURATION 扱いで開かない。" -- "${files[@]}"
```

(d) アーカイブ:

```bash
git add pbi/2026-09-30-06-fix-sw-decryption-lock-propagation.md
git mv pbi/2026-09-30-06-fix-sw-decryption-lock-propagation.md dev-docs/archived/pbi/
git commit -m "docs(pbi): 09-30 PBI 06(SW 復号ロック伝搬)をアーカイブする" -- pbi/2026-09-30-06-fix-sw-decryption-lock-propagation.md dev-docs/archived/pbi/2026-09-30-06-fix-sw-decryption-lock-propagation.md
```
`git add -A` / `git add .` は使わない。

### 9. 完了条件

- [ ] 節 4 のテスト 5 ファイルを実装前に実行して失敗を確認した
- [ ] `npm run type-check` / `npx eslint <変更ファイル>` / `npm run lint:layers-docs` が通る
- [ ] `npx vitest run src/utils src/dashboard src/background src/popup` が全件 green
- [ ] 新テストが `--repeats=20` で全て green
- [ ] `encryptionSession.ts` / `SettingsRepository.ts` / `compositionManifest.ts` に差分が無い
- [ ] en/ja に `encryptionLockedApiKeys` が同一キーで存在する
- [ ] ログ・エラーメッセージに鍵・暗号文の値が含まれない
- [ ] 実装コミットとアーカイブコミットが分かれ、`git add -A` を使っていない

## 見積もり

3 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] ロック時のユーザー向け文言が i18n(en/ja)で整備される
- [ ] コードレビュー完了
