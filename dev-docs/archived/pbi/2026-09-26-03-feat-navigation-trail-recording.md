# PBI: 遷移記録（流入元 URL・検索語のオプトイン記録と機能別同意）

種別: feat

## ユーザーストーリー

自分の調べ方を振り返りたいユーザーとして、次の2つを記録に残したい。どちらも自分で有効にしたときだけでよい。

- 各ページにどこから来たか（同じタブで直前に開いていたページ）
- どの検索語から来たか

どの検索語から探し始めて、どのページを経由したかが分かれば、同じ調査をまたするときの近道になり、自分の検索のくせにも気づけるから。

## ビジネス価値

- 提案2の「探索パス」と「検索→解決」指標（PBI 04）に必要なデータを、端末の中だけで記録できるようにする。
- 新しい権限は増やさない。`content_scripts` は `<all_urls>` にマッチしているので、`tabs.onUpdated` の `changeInfo.url` が Service Worker まで届く。
- 既定は OFF。ON にするときに機能別の同意を取る。
  - プライバシーポリシーの同意バージョンは上げない。上げると全ユーザーの同意が失効し、再同意するまで記録が止まる。
  - そのため、同意バージョンを最終更新日から切り離す改修もこの PBI に含める。
- 検索結果ページは既定でブラックリストに入っている。「記録しない」という約束を崩さないよう、次のとおり扱う。
  - 除外ドメインの流入元はオリジンだけを保存する。
  - 検索語は PII マスクをかけてから保存する。

## 優先度

- 順位: 03 / 4
- RICEスコア: 0.32（Reach=2 / Impact=1 / Confidence=80% / Effort=5 SP）
- 根拠:
  - オプトインのため、届く範囲は小さい。記録経路を 12 ホップたどる必要があり、プライバシー文書も改訂するため、工数が大きい。
  - 単独での価値は、02 のパネルに「検索語」と「流入元」を表示するところまでに限られる。
  - 04 の前提条件なので、04 より先に行う（依存を優先する）。
- 依存:
  - 02 のパネルと、その中の `renderRecord` が必要。
  - `pbi/2026-09-25-24-investigate-privacy-reconsent-ux.md` と同じ `privacyConsent.ts` を触るので、同時には着手しない。

## BDD受け入れシナリオ

```gherkin
Scenario: 同意して有効にすると、検索語と流入元が記録される
  Given プライバシー設定で「遷移記録」を ON にし、確認ダイアログで同意した
  When 同じタブで Google を「wasm sqlite fts5」と検索し、結果の記事を開いて記録された
  Then その記録の検索語は「wasm sqlite fts5」になる
  And 流入元はオリジン「https://www.google.com」だけになる（google.com は既定の除外ドメインのため）
  And リサーチ・セッションのその記録に「検索: wasm sqlite fts5」と「流入元: www.google.com」が表示される

Scenario: 除外されていないページからの遷移は URL 全体を記録する
  Given 遷移記録が有効である
  When 記録対象の記事 A から、同じタブで記事 B に移って B が記録された
  Then B の流入元は A の URL（# 以降を除く）になり、検索語は空になる

Scenario: 確認ダイアログでキャンセルすると有効にならない
  Given 遷移記録が OFF である
  When ユーザーがチェックボックスを ON にし、確認ダイアログでキャンセルを押す
  Then チェックボックスは OFF のままで、以後の記録に流入元も検索語も入らない

Scenario: OFF にすると以後は収集せず、タブの追跡状態も消える
  Given 遷移記録が有効で、タブの遷移を追跡している
  When ユーザーがチェックボックスを OFF にする
  Then 以後の記録に流入元と検索語は入らない
  And セッションストレージに残っていたタブの追跡状態が消える

Scenario: 既定では何も収集しない
  Given 遷移記録を一度も有効にしていない
  When ユーザーがページを閲覧して記録される
  Then 流入元と検索語は空で、タブの追跡状態も保存されない

Scenario: プライバシー同意を撤回すると遷移記録も無効になる
  Given 遷移記録が有効である
  When ユーザーがプライバシー同意を撤回する
  Then 遷移記録も OFF になる

Scenario: ポリシーの最終更新日を変えても全体の再同意は発生しない
  Given PRIVACY.md の最終更新日を実装日に変え、同意バージョンは 2026年9月8日のままである
  When リリースチェック check-privacy を実行する
  Then 同意バージョンと PRIVACY_POLICY_VERSION が一致するので合格する
  And 既存ユーザーの同意は有効のままである
```

## 受け入れ基準

- [x] プライバシーパネルに「遷移記録」のチェックボックスがあり、既定は OFF
- [x] ON にするときは確認ダイアログを出し、同意したときだけ有効にする
- [x] 有効なときだけ、自動記録（`valid-visit`）の行に `nav_source_url` と `search_query` が入る。無効なら両方 NULL
- [x] `nav_source_url`
  - 同じタブで直前に開いていた http(s) の URL を、フラグメントを除いて入れる
  - 流入元が除外ドメインならオリジンだけを入れる
- [x] `search_query`
  - 流入元が検索エンジンのルールに当てはまるときだけ入れる
  - PII マスクをかけ、最大 200 文字にする
- [x] シークレットタブのタブ遷移は追跡しない
- [x] OFF にしたとき、およびプライバシー同意を撤回したときは、セッションストレージのタブ追跡状態を全て消す
- [x] 既存の DB では migration で 2 列が追加される。旧バックアップ・アーカイブを復元したときも NULL で補われる
- [x] オフライン再送でも 2 列が落ちない
- [x] 2 列は AI への送信内容・Obsidian の Markdown・エクスポートのどこにも含まれない
- [x] PRIVACY.md（public / docs は同じ内容）に遷移記録の節と「同意バージョン」の行がある。`check-privacy.mjs` は同意バージョンと照合する
- [x] `PRIVACY_POLICY_VERSION` は `'2026-09-08'` のまま変えない
- [x] `manifest` の権限は変えない
- [x] `npm run validate`、`npm run build`、`npm run release:check` の privacy 項目が通る

## 詳細設計

### データの定義

| 列 | 型 | 値 | 入らない条件 |
|---|---|---|---|
| `nav_source_url` | TEXT NULL | 同じタブで直前に開いていた http(s) URL（フラグメント除去後）。除外ドメインなら `new URL(src).origin` | 遷移記録が無効 / 直前 URL がない / http(s) ではない / 記録元が `valid-visit` 以外 |
| `search_query` | TEXT NULL | 流入元 URL の検索パラメータを `sanitizeRegex()` でマスクした後の文字列。最大 200 文字 | 上の条件に加え、流入元が検索エンジンのルールに当てはまらない / 検索語が空 |

### 変更・新規ファイル一覧

| # | ファイル | 種別 |
|---|---|---|
| 1 | `src/utils/navUrl.ts` | 新規 |
| 2 | `src/utils/searchQuery.ts` | 新規 |
| 3 | `src/utils/storage/navTrailConsent.ts` | 新規 |
| 4 | `src/utils/storage/types.ts` | 変更（`StorageKeys.NAV_TRAIL_CONSENT`） |
| 5 | `src/utils/storage/privacyConsent.ts` | 変更（撤回時に無効化・定数に WHY コメント） |
| 6 | `src/background/navTrail/navTrailTracker.ts` | 新規 |
| 7 | `src/background/service-worker.ts` | 変更（listener 登録） |
| 8 | `src/background/handlers/recordingHandlers.ts` | 変更（valid-visit でフィールドを付与） |
| 9 | `src/messaging/types.ts` | 変更（`RecordingData`） |
| 10 | `src/background/recordRequestBuilder.ts` | 変更 |
| 11 | `src/background/pipeline/mappers/commonStorageFields.ts` | 変更 |
| 12 | `src/utils/sqlite-types.ts` | 変更 |
| 13 | `src/offscreen/schema.ts` | 変更 |
| 14 | `src/offscreen/browsingLogCodec.ts` | 変更 |
| 15 | `src/offscreen/rowCodec.ts` | 変更 |
| 16 | `src/offscreen/sqliteEngineContext/migrationBackup.ts` | 変更 |
| 17 | `src/background/migration/opfsRecovery.ts` | 変更 |
| 18 | `src/background/pipeline/mappers/regenerateUpdateFields.ts` | 変更（ヘッダコメントのみ） |
| 19 | `src/dashboard/settings/navTrailToggle.ts` | 新規 |
| 20 | `src/dashboard/panels/staticForm/privacySettingsPanel.ts` | 変更（`initNavTrailToggle` 呼び出し） |
| 21 | `src/dashboard/panels/asyncData/researchSessionsPanel.ts` | 変更（`renderRecord` に 2 行追加） |
| 22 | `entrypoints/options/index.html` | 変更（プライバシーパネルにチェックボックス） |
| 23 | `public/_locales/{ja,en}/messages.json` | 変更 |
| 24 | `public/PRIVACY.md` と `docs/PRIVACY.md` | 変更（同じ内容） |
| 25 | `scripts/release-checks/check-privacy.mjs` | 変更 |
| 26 | テスト（新規・変更） | 「テスト戦略」を参照 |
| 27 | `CHANGELOG.md` / `docs/DATA_ANALYTICS_GUIDE.md` | 変更 |

### 1. `src/utils/navUrl.ts`

```ts
/** Returns the URL without its fragment, or null when it is not http(s) or cannot be parsed. */
export function normalizeNavUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
```

`src/utils/` に置く理由: dashboard（04）と background の両方から import するため。ESLint の層境界ルールにより、background ↔ dashboard の相互 import はできない。

### 2. `src/utils/searchQuery.ts`

```ts
export interface SearchEngineRule { readonly host: RegExp; readonly param: string }
export const SEARCH_ENGINE_RULES: readonly SearchEngineRule[] = [
  { host: /(^|\.)google\.[a-z.]+$/, param: 'q' },
  { host: /(^|\.)bing\.com$/, param: 'q' },
  { host: /(^|\.)duckduckgo\.com$/, param: 'q' },
  { host: /^search\.yahoo\.com$/, param: 'p' },
  { host: /^search\.yahoo\.co\.jp$/, param: 'p' },
  { host: /^search\.brave\.com$/, param: 'q' },
  { host: /(^|\.)ecosia\.org$/, param: 'q' },
];
export const MAX_SEARCH_QUERY_CHARS = 200;

export function extractSearchQuery(url: string): string | null
```

`extractSearchQuery` の処理手順:

1. `new URL(url)` で解析する。例外が出たら null を返す。
2. `hostname` を小文字にし、`SEARCH_ENGINE_RULES` の中で最初にマッチするルールを探す。マッチしなければ null を返す。
3. `searchParams.get(rule.param)` で値を取り出す。`URLSearchParams` が `%20` や `+` を自動で復号する。
4. 取り出した値を trim する。null や空文字なら null を返す。
5. `MAX_SEARCH_QUERY_CHARS` 文字で切って返す。コードポイント単位で切るため `Array.from(q).slice(0, MAX).join('')` を使う。

### 3. 機能別同意（`src/utils/storage/navTrailConsent.ts`）

```ts
import { StorageKeys } from './types.js';

export interface NavTrailConsent { enabled: boolean; consentedAt: number | null }
export const NAV_TRAIL_CONSENT_DEFAULT: NavTrailConsent = { enabled: false, consentedAt: null };

export async function getNavTrailConsent(): Promise<NavTrailConsent>
export async function enableNavTrail(now: number): Promise<void>   // set { enabled: true, consentedAt: now }
export async function disableNavTrail(): Promise<void>             // set { enabled: false, consentedAt: null }
export function isNavTrailActive(c: NavTrailConsent): boolean      // c.enabled && c.consentedAt !== null
```

- **読み書きの方法**: `privacyConsent.ts` と同じく `chrome.storage.local.get/set` を直接使う。
- **値の検証**: 読み出した値が次の形でなければ、`NAV_TRAIL_CONSENT_DEFAULT` を返す。
  - オブジェクトである
  - `enabled` が boolean
  - `consentedAt` が number か null
  - 型ガード関数を書き、`unknown` 型は使わない。
- **`types.ts` への追加**: `StorageKeys` に `NAV_TRAIL_CONSENT: 'nav_trail_consent'` を追加する。
  - `DEFAULT_SETTINGS` と `restorableSettings` には**入れない**。
  - 理由: `DEFAULT_SETTINGS` に入れると `settingsExportImport.ts` の `REQUIRED_EXPORT_KEYS` に自動で加わり、既存の 1.1.0 形式のエクスポートが読み込めなくなるため。
  - `ENCRYPTION_SALT` などの内部キーと同じ扱いにする。
  - `Settings` 型のマップに型の追加が必要なら、内部キーの前例に合わせる。
- **ファイル冒頭のコメント（WHY）**: 「端末固有の同意なのでエクスポートにも復元にも含めない」と1行で書く。
- **`privacyConsent.ts` の変更**:
  - `withdrawPrivacyConsent()` で同意を消す処理が成功した直後に `await disableNavTrail()` を呼ぶ。失敗しても撤回自体は成功扱いにするため、try/catch で包み、`console.warn` だけ出す。
  - `PRIVACY_POLICY_VERSION` の直上に1行コメントを加える: `// Bump only when consent scope changes for every user; opt-in features use their own consent (see navTrailConsent.ts).`

### 4. タブ追跡（`src/background/navTrail/navTrailTracker.ts`）

```ts
import { Mutex } from '../../utils/Mutex.js';
import { normalizeNavUrl } from '../../utils/navUrl.js';
import { extractSearchQuery } from '../../utils/searchQuery.js';
import { sanitizeRegex } from '../../utils/piiSanitizer.js';
import { isDomainAllowed } from '../../utils/domainUtils.js';
import { getNavTrailConsent, isNavTrailActive } from '../../utils/storage/navTrailConsent.js';

export const NAV_TRAIL_SESSION_KEY = 'nav_trail_tabs';
export interface TabNavState { current?: string; previous?: string }
type TabNavMap = Record<string, TabNavState>;
export interface NavTrailFields { navSourceUrl?: string; searchQuery?: string }

export async function onTabUrlChanged(tabId: number, url: string): Promise<void>
export async function onTabRemoved(tabId: number): Promise<void>
export async function getNavSource(tabId: number, pageUrl: string): Promise<string | null>
export async function resolveNavTrailFields(tabId: number, pageUrl: string): Promise<NavTrailFields>
export async function clearAllNavTrail(): Promise<void>
export function registerNavTrailConsentWatcher(): void
```

- **状態の置き場所**: `chrome.storage.session` の `nav_trail_tabs` に `TabNavMap` として置く。キーは `String(tabId)`。
  - WHY: Service Worker はいつ停止されてもおかしくないので、メモリに置くと消える。
- **排他制御**: モジュール内に `const mutex = new Mutex()` を1つ置く。読み込み→変更→書き込みを行う関数（`onTabUrlChanged` / `onTabRemoved` / `clearAllNavTrail`）は、`await mutex.acquire(); try { ... } finally { mutex.release(); }` で囲む。
- **`onTabUrlChanged(tabId, url)`**
  1. `isNavTrailActive(await getNavTrailConsent())` が false なら、何もせず return する。
  2. `const next = normalizeNavUrl(url)`。null なら return する。
  3. ロックを取り、map を読み込む。`const s = map[key] ?? {}`。`s.current === next` なら何もしない（同じ URL の再読み込みやフラグメントだけの変更）。
  4. 違っていれば `map[key] = { previous: s.current, current: next }` にして書き込む。`s.current` が undefined なら `previous` も undefined のままにする。
- **`onTabRemoved(tabId)`**: ロックを取り、`map[key]` を削除して書き込む。キーがなければ書き込まない。
- **`getNavSource(tabId, pageUrl)`**: `normalizeNavUrl(pageUrl)` が `map[key]?.current` と一致すれば `map[key].previous ?? null` を返す。一致しなければ null を返す。読み込みだけなのでロックは取らない。
- **`resolveNavTrailFields(tabId, pageUrl)`**
  1. 遷移記録が無効なら `{}` を返す。
  2. `const src = await getNavSource(tabId, pageUrl)`。null なら `{}` を返す。
  3. `navSourceUrl`: `(await isDomainAllowed(src)) ? src : new URL(src).origin`
  4. `const q = extractSearchQuery(src)`。q があれば `const masked = (await sanitizeRegex(q)).text` とし、`masked` が空でなければ `searchQuery = masked` にする。
  5. `pickDefined` と同じ要領で、undefined のキーは含めずに返す。
- **`clearAllNavTrail()`**: ロックを取り、`chrome.storage.session.remove(NAV_TRAIL_SESSION_KEY)` を呼ぶ。
- **`registerNavTrailConsentWatcher()`**: `chrome.storage.onChanged.addListener((changes, area) => { ... })` を登録する。`area === 'local'` かつ `changes['nav_trail_consent']` があり、`newValue` が有効な同意でなければ、`void clearAllNavTrail()` を呼ぶ。有効かどうかは型ガードを通して `isNavTrailActive` で判定する。

### 5. Service Worker への登録（`src/background/service-worker.ts`）

既存の `chrome.tabs.onRemoved / onActivated / onUpdated` の登録（211〜215 行付近）の直後に追加する。既存の `handleTabUpdated` は変更しない。

```ts
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !tab.incognito) void onTabUrlChanged(tabId, changeInfo.url);
});
chrome.tabs.onRemoved.addListener((tabId) => { void onTabRemoved(tabId); });
registerNavTrailConsentWatcher();
```

listener はトップレベルで同期的に登録する（MV3 では Service Worker が再起動したときにイベントを受け取るのに必要）。既存の listener と同じ位置に置く。

### 6. 記録経路（`fallback_reason` を追加したときと同じ手順）

1. **`src/background/handlers/recordingHandlers.ts`**（valid-visit、145〜150 行付近）
   - `buildRecordRequest('valid-visit', { ... })` を呼ぶ前に、次を実行する。
     ```ts
     const navFields = sender.tab?.id !== undefined && sender.tab.url
       ? await resolveNavTrailFields(sender.tab.id, sender.tab.url)
       : {};
     ```
   - `buildRecordRequest` に渡すオブジェクトに `...navFields` を追加する。
   - manual / save / regenerate の経路は変えない（v1 の範囲外）。
2. **`src/messaging/types.ts`**: `RecordingData` に次を追加する。
   - `navSourceUrl?: string | undefined;`
   - `searchQuery?: string | undefined;`
3. **`src/background/recordRequestBuilder.ts`**
   - `buildRecordRequest` の `pickDefined` に `navSourceUrl` と `searchQuery` を加える。
   - `extractOfflinePayload` と `buildOfflineRetryRequest`（107〜144 行付近）で、2 フィールドを保存・復元する。
   - `RecordDiagnosticFields` と `pickRecordDiagnostics` には入れない。これらは診断用の値ではないため。
4. **`src/background/pipeline/mappers/commonStorageFields.ts`**
   - `CommonStorageFields` の interface に `navSourceUrl: string | null;` と `searchQuery: string | null;` を加える。
   - `d` から値を取り出す部分（106〜140 行付近）に次を加える。
     - `navSourceUrl: typeof d.navSourceUrl === 'string' ? d.navSourceUrl : null`
     - `searchQuery` も同じ形で取り出す。
   - `toBrowsingLogRecord`（145〜179 行付近）に次を加える。
     - `nav_source_url: fields.navSourceUrl`
     - `search_query: fields.searchQuery`
   - `toMetadataPatch` には入れない。旧 chrome.storage 側には書かないため。
5. **`src/utils/sqlite-types.ts`**: `BrowsingLogRecord` の `fallback_reason` の後に次を加える。
   - `nav_source_url?: string | null;`
   - `search_query?: string | null;`
6. **`src/offscreen/schema.ts`**
   - `SCHEMA_SQL`: `fallback_reason TEXT,` の後、`UNIQUE(...)` の前に `nav_source_url TEXT,` と `search_query TEXT,` を加える。
   - `COLUMN_NAMES`: 末尾に `'nav_source_url', 'search_query'` を加える（`SCHEMA_SQL` と同じ並び順にすること）。
   - 次の4つにも、`fallback_reason` と同じ形でフィールドを加える。`buildInsertParams` は位置で値を対応させるので、`COLUMN_NAMES` と同じ順にする。
     - `InsertableRecord`
     - `buildInsertParams`
     - `InsertRecordFields`
     - `buildInsertRecordFields`
   - `MIGRATION_COLUMNS`: 末尾に `'nav_source_url TEXT'` と `'search_query TEXT'` を加える。
   - `UPDATABLE_FIELDS`: **加えない**（一度記録したら変えない項目のため）。
7. **`src/offscreen/browsingLogCodec.ts`**: `fallback_reason` の行を手本に、文字列ならその値、そうでなければ null にする行を2つ加える。
8. **`src/offscreen/rowCodec.ts`**
   - `BROWSING_LOG_COLUMNS`（45〜50 行付近）の末尾に2列を加える。dashboard が一覧取得（OPFS 経路）で受け取れるようにするため。
   - `coerceCell` の文字列分岐（72〜83 行付近）に2列を加える。加えないと、既定の `Number()` 変換で NaN になる。
   - `SEARCH_COLUMNS` と、`queryPlan.ts` の FTS / LIKE 検索の SQL は変えない。検索結果には出さない。
9. **`src/offscreen/sqliteEngineContext/migrationBackup.ts`**
   - `LEGACY_MISSING_COLUMNS` を `new Set(['fallback_reason', 'nav_source_url', 'search_query'])` にする。
   - `mapMigrationBackupRow` で2列に null を入れる。
   - 加えないと、旧バックアップの SELECT が失敗しても、そのエラーが表に出ずに握りつぶされる。
10. **`src/background/migration/opfsRecovery.ts`**: `convertFallbackRecord` に次を加える。
    - `nav_source_url: record.nav_source_url ?? null`
    - `search_query: record.search_query ?? null`
11. **`src/background/pipeline/mappers/regenerateUpdateFields.ts`**: ヘッダコメントの「不変項目」の一覧に2列を追記する。コードは変えない。
12. **変えないもの**: `exportEnvelope.EXPORT_COLUMNS`（列は固定しており、`fallback_reason` も入れていない）、FTS、`payloadGuard`（`COLUMN_NAMES` から自動で導出される）、`archiveValidation`（`SCHEMA_SQL` から自動で導出される）。

### 7. 設定 UI

**HTML**: `entrypoints/options/index.html` のプライバシーパネル（`#panel-privacy`）で、「Privacy Consent Status」の `form-group`（1577〜1583 行付近）の直後に置く `<hr class="settings-hr">` のさらに直後に、次を挿入する。

```html
<div class="form-group">
  <label class="checkbox-label">
    <input type="checkbox" id="navTrailEnabled">
    <span data-i18n="navTrailLabel">Record navigation trail (source page and search terms)</span>
  </label>
  <p class="help-text" data-i18n="navTrailDescription">Stores, on this device only, the page you came from and the search terms you used. Used by Research Sessions. Off by default.</p>
  <div id="navTrailStatus" class="status-message" aria-live="polite"></div>
</div>

<hr class="settings-hr">
```

`data-storage-key` は付けない。汎用のスキーマバインドを使うと、同意ダイアログを挟まずに保存されてしまうため。

**新規 `src/dashboard/settings/navTrailToggle.ts`**

```ts
export async function initNavTrailToggle(container: HTMLElement): Promise<void>
```

1. `const input = container.querySelector<HTMLInputElement>('#navTrailEnabled')`。見つからなければ return する。
2. `input.checked = isNavTrailActive(await getNavTrailConsent())`
3. `input.addEventListener('change', async () => { ... })` の中身は次のとおり。
   - `input.checked` が true のとき:
     1. まず `input.checked = false` に戻す。
     2. 次のダイアログを出す。
        ```ts
        const ok = await showConfirmDialog({
          title: getMessageOr('navTrailConsentTitle', 'Enable navigation trail?'),
          message: getMessageOr('navTrailConsentMessage', '...'),
          confirmLabel: getMessageOr('navTrailConsentAccept', 'Enable'),
          cancelLabel: getMessageOr('cancel', 'Cancel'),
        });
        ```
     3. `ok` が true なら `await enableNavTrail(Date.now())` を呼び、`input.checked = true` にする。
   - `input.checked` が false のとき: `await disableNavTrail()` を呼ぶ。
   - 保存に失敗したときは、try/catch で `#navTrailStatus` に `navTrailSaveFailed` を表示し、チェック状態を保存前の値に戻す。

`showConfirmDialog` は `src/dashboard/utils/confirmDialog.js` から、`getMessageOr` は `src/utils/i18n.js` から import する。

**`privacySettingsPanel.ts`**: `mount(container)` の中で、`initMasterPasswordSettings()` の直後に `await initNavTrailToggle(container);` を加える。

さらに、同意撤回の処理で `withdrawPrivacyConsent()` が成功した後、`(container.querySelector('#navTrailEnabled') as HTMLInputElement | null)` があれば `checked = false` にする。撤回処理の本体（`privacyConsent.ts`）がすでに無効化しているので、この処理は画面の表示を合わせるためだけのもの。

### 8. i18n（ja / en）

`description` は英語で書く。

| キー | ja | en |
|---|---|---|
| `navTrailLabel` | 遷移記録（流入元ページと検索語）を記録する | Record navigation trail (source page and search terms) |
| `navTrailDescription` | 直前に開いていたページと、検索エンジンで使った検索語を、この端末の中だけに保存します。リサーチ・セッションで使います。既定はオフです。 | Stores, on this device only, the page you came from and the search terms you used. Used by Research Sessions. Off by default. |
| `navTrailConsentTitle` | 遷移記録を有効にしますか？ | Enable navigation trail? |
| `navTrailConsentMessage` | 有効にすると、同じタブで直前に開いていたページのURL（除外ドメインはドメインのみ）と、検索エンジンの検索語（個人情報はマスク）を記録に加えます。データはこの端末の中だけに保存され、AIやObsidianには送られません。オフにすると以後は記録しません。 | When enabled, each record also stores the URL of the previous page in the same tab (only the domain for excluded sites) and the search terms from search engines (with personal information masked). The data stays on this device and is never sent to AI providers or Obsidian. Turning it off stops further collection. |
| `navTrailConsentAccept` | 有効にする | Enable |
| `navTrailSaveFailed` | 設定を保存できませんでした。 | Could not save the setting. |
| `researchSessions_searchQuery` | 検索: {q} | Search: {q} |
| `researchSessions_source` | 流入元: {host} | From: {host} |

`cancel` は既存のキーを使う。

### 9. リサーチ・セッションパネルでの最小表示（`researchSessionsPanel.ts` の `renderRecord`）

ドメインの `<span>` の後に、次の2つを追加する。

- `record.search_query` があるとき: `<span class="research-sessions-query">` に `msg('researchSessions_searchQuery', { q: record.search_query }, 'Search: {q}')` を入れる。
- `record.nav_source_url` があるとき: `<span class="research-sessions-source">` に `msg('researchSessions_source', { host }, 'From: {host}')` を入れる。
  - `host` は `new URL(record.nav_source_url).hostname`。
  - URL として解析できなければ、この要素は置かない。

値の代入はどちらも `textContent` で行う。CSS では、`.research-sessions-domain` の色指定のセレクタに `.research-sessions-query` と `.research-sessions-source` を追加する。

### 10. プライバシー文書と照合スクリプト

**`public/PRIVACY.md` と `docs/PRIVACY.md`**: 同じ編集を両方に入れ、バイト単位で同一に保つ。

- 3 行目の `**最終更新日: 2026年9月8日 / Last Updated: September 8, 2026**` の日付を、実装した日付に変える。
- その直後（4 行目）に `**同意バージョン: 2026年9月8日 / Consent Version: September 8, 2026**` を追加する。
- 日本語の「#### 自動コンテンツフェッチ（オプトイン方式）」の節の後に、「#### 遷移記録（オプトイン方式）」の節を追加する。書く内容は次のとおり。
  - 保存する2項目
  - 除外ドメインはオリジンのみ保存すること
  - PII マスク
  - 端末の中だけに保存し、AI・Obsidian・エクスポートには含めないこと
  - 既定は OFF で、有効にするときに同意を求めること
  - OFF にすると以後は収集しないこと。記録済みの値は履歴を削除すると消えること
- 英語の「#### Automatic Content Fetching (Opt-In)」の節の後にも、同じ内容で「#### Navigation Trail (Opt-In)」を追加する。
- 日本語の「### データの収集」と英語の「### Data Collection」の項目一覧に、「遷移記録（オプトイン時のみ）」の1行を加える。

**`scripts/release-checks/check-privacy.mjs`**

- `readPrivacyLastUpdated()` を `readPrivacyConsentVersion()` に変える。正規表現は `/Consent Version:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/`。
- `checkPolicyVersionMatch()` の表示文言を、「Last Updated」から「Consent Version」に変える。
- ファイル冒頭コメントの 2. を書き換える: 「PRIVACY_POLICY_VERSION matches the "Consent Version" line (the date users consented to); "Last Updated" may change without forcing re-consent.」
- テストから呼べるように、2つの関数を `export` する。

## 実装手順（Outside-In TDD）

1. main からブランチ `feature/navigation-trail` を切る（02 がマージ済みであること）。
2. 純粋関数から作る。`navUrl.test.ts` と `searchQuery.test.ts` を書いて Red にし、実装して Green にする。
3. `navTrailConsent.test.ts` を書いて Red、実装して Green。`privacyConsent` の撤回テストを追記する。
4. `navTrailTracker.test.ts` を書いて Red、実装して Green。
5. 記録経路を作る。まずスキーマ系の既存テストで固定されている列の一覧を更新し（Red）、`schema.ts` から `rowCodec` までを実装する（Green）。続けて `recordRequestBuilder` と `commonStorageFields` のテストを追加し、実装する。
6. `recordingHandlers` と `service-worker` の配線をつなぐ。
7. UI を作る。`navTrailToggle` のテストを書き、HTML・i18n・`privacySettingsPanel` を実装する。
8. `researchSessionsPanel` の最小表示を追加し、lifecycle テストを追記する。
9. PRIVACY.md（2ファイル）・`check-privacy.mjs` とそのテスト・CHANGELOG・ガイドを更新する。
10. `npm run validate`、`npm run build`、`npm run release:check` を実行する。そのうえで Chrome での手動確認を行う。
    - 遷移記録を ON にする。
    - Google で検索し、記事を開いて記録させる。
    - リサーチ・セッションに「検索: …」と表示されることを確認する。

## テスト戦略

### 単体

1. `src/utils/__tests__/searchQuery.test.ts`
   - Google の `https://www.google.co.jp/search?q=a%20b` から `'a b'` が取れる。
   - Bing・DuckDuckGo・Yahoo（`p`）・Brave・Ecosia からも取れる。
   - 検索結果ではないページは null になる。
   - `q=` が空なら null になる。
   - 201 文字の入力は 200 文字に切られる。
   - 不正な URL は null になる。
   - 大文字の `WWW.GOOGLE.COM` にもマッチする。
2. `src/utils/__tests__/navUrl.test.ts`
   - フラグメントが除かれる。
   - `chrome://`、`file:`、`chrome-extension:`、不正な文字列はすべて null になる。
3. `src/utils/storage/__tests__/navTrailConsent.test.ts`
   - 未保存のときは既定値になる。
   - enable の後は active、disable の後は inactive になる。
   - 形が不正な保存値は既定値として扱われる。
4. `privacyConsent` のテストに追記する: `withdrawPrivacyConsent` の後で `getNavTrailConsent().enabled === false` になる。
5. `src/background/navTrail/__tests__/navTrailTracker.test.ts`
   - `chrome.storage.session` は `testDir/vitest.setup.ts` の global mock を使う。
   - 同意が無効のときは、`onTabUrlChanged` を呼んでも `session.set` が呼ばれない。
   - A から B へ移った後、`getNavSource(tab, B)` は A を返す。
   - 同じ URL が続けて来ても `previous` は変わらない。フラグメント違いも同じ扱いになる。
   - `getNavSource` にページ URL として `current` 以外を渡すと null になる。
   - `onTabRemoved` の後は null になる。
   - 同意を無効にすると（onChanged を発火させる）、`nav_trail_tabs` が消える。
   - `onTabUrlChanged` を 10 回並行に呼んでも、最終状態が最後に呼んだ2つの URL になる（Mutex が効いていることの確認）。
   - `resolveNavTrailFields` を確認する。`isDomainAllowed` と `sanitizeRegex` は `vi.mock` で差し替える。
     - 除外ドメインならオリジンだけが入る。
     - 検索エンジンからの遷移ならマスク後の検索語が入る。
     - 同意が無効なら `{}` を返す。

### 統合（記録経路）

- `recordRequestBuilder` のテスト:
  - `navSourceUrl` と `searchQuery` がリクエストに載る。
  - オフライン再送用の payload に保存し、そこから復元しても残っている。
- `commonStorageFields` のテスト: `nav_source_url` と `search_query` がレコードに写る。値がなければ null になる。
- スキーマ系の既存テストの更新: `src/offscreen/__tests__/` にある次のテストで、固定されている列一覧に2列を加える。
  - `schema-comprehensive`
  - `schema-insertParams`
  - `rowCodec`
  - `payloadGuardSchemaDriven`
  - `archiveValidation`
  - `idb-migration`
  - `archive*`
- migration のテストを追加する:
  - 2列がない旧スキーマで `runMigrations` を実行すると、2列が追加される。2回実行してもエラーにならない。
  - 旧バックアップを読み込むと、2列が null の行ができる。

### UI

- `src/dashboard/settings/__tests__/navTrailToggle.test.ts`（jsdom。`showConfirmDialog` と `navTrailConsent` を `vi.mock` で差し替える）
  - 初期状態が保存値を反映している。
  - ON にしてキャンセルすると OFF のままで、`enableNavTrail` は呼ばれない。
  - ON にして同意すると `enableNavTrail` が呼ばれ、チェックが入る。
  - OFF にすると `disableNavTrail` が呼ばれる。
  - 保存に失敗するとエラーが表示され、チェックが元に戻る。
- `researchSessionsPanel.lifecycle.test.ts` に追記する:
  - `search_query` と `nav_source_url` を持つ行では「Search: …」「From: host」が表示される。
  - 持たない行では表示されない。

### リリースチェック

- `scripts/__tests__/checkPrivacy.test.ts`（新規。既存のテストがあればそこに追記する）: `readPrivacyConsentVersion()` が PRIVACY.md から `'2026-09-08'` を返し、`PRIVACY_POLICY_VERSION` と一致する。

## 落とし穴（実装者向け）

- `COLUMN_NAMES` と `buildInsertParams` は位置で対応させている。順番がずれると別の列に値が入る。`schema-insertParams` のテストで検出できる。
- `rowCodec.coerceCell` の文字列分岐に加え忘れると、値が NaN になる。
- `migrationBackup.LEGACY_MISSING_COLUMNS` に加え忘れると、旧バックアップの読み込みが**黙って**失敗する。
- `DEFAULT_SETTINGS` に同意のキーを入れてはいけない。既存のエクスポートが読み込めなくなる。
- PRIVACY.md は2ファイルとも同じ内容にする。`check-privacy` が差分を検出する。
- `PRIVACY_POLICY_VERSION` を変えると、全ユーザーの記録が止まる。この PBI では絶対に変えない。
- listener は `service-worker.ts` のトップレベルで同期的に登録する。await の後で登録すると、Service Worker が再起動したときにイベントを取りこぼす。
- import には `.js` 拡張子を付ける。`any` と `unknown` は使わない（テストは除く）。定数は名前付きで定義する。

## 見積もり

5 SP（記録経路 2 ＋ 追跡・同意 1.5 ＋ UI・表示 0.5 ＋ プライバシー文書・照合スクリプト 0.5 ＋ テスト仕上げ 0.5）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（プライバシー文書のシナリオは check-privacy のテストで担保する）
- [x] `npm run validate`、`npm run build`、`npm run release:check` が通る
- [ ] Chrome での手動確認が済んでいる（検索 → 記事 → セッション表示）
- [x] セキュリティ観点のレビュー完了（`dev-docs/SECURITY_REVIEW_GUIDE.md` のチェックリストを適用。4 件の指摘をコミット `f207b6dc` で修正: ①検索エンジンのホスト判定が `google.evil.com` にも一致し任意テキストを `search_query` に注入できた（MEDIUM、正規表現を `google\.[a-z]{2,3}(\.[a-z]{2})?$` に絞って回帰テスト追加）、②tab listener の `void` 呼び出しに `.catch()` がなく Mutex のキュー満杯/タイムアウトで未処理 Promise 拒否になっていた（LOW-MEDIUM、既存の `handleTabActivated` と同じ構造化ログで捕捉）、③incognito ガードの説明が主客を逆にしていた（実際の防線は manifest に `incognito` 権限がないこと。LOW）、④暗号化 combined backup には SQLite DB が丸ごと入るため遷移記録も一緒に運ばれることを PRIVACY.md に明記（LOW）。archive/CSV/JSON エクスポート・AI 送信・Obsidian Markdown・FTS・ログに含まれないこと、同意の fail-closed、削除時の行ごと消失、PII サニタイザの網羅、MV3 の top-level listener 登録、`DASHBOARD_SQLITE` の extension-only 性は実測で確認）
- [x] PRIVACY.md（2ファイル）・ガイド・CHANGELOG を更新済み
- [x] `pbi/00-INDEX.md` を更新し、アーカイブ済み
