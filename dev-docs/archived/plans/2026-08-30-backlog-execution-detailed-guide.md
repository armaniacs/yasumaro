# 詳細実装ガイド — 積み残し全体実行計画 補足

> 親計画: `dev-docs/plans/2026-08-30-backlog-execution-plan.md`
> ブランチ: `plan/0830-backlog-execution`
> 対象: 16 PBI + 再スキャン5件、Wave 0-4、保留2件

本ガイドはマスタープランの各 Wave を **具体的な手順・コード例・設定項目・成果物** まで落とし込んだ実行マニュアル。

---

## 0. 共通前提・環境セットアップ

### 0.1 ブランチ運用

```bash
git checkout main && git pull origin main
git checkout -b fix/trust-boundary-consistency main   # Wave1A 例
# 実装 → commit → push → PR → main マージ
# 次 Wave は都度 main から切り直す
```

### 0.2 検証ゲート（全 Wave 共通）

```jsonc
// package.json scripts
"validate": "npm run type-check && npm run test:coverage && npm run lint",
"type-check": "tsc --noEmit",
"test:coverage": "vitest run --coverage",
"build": "wxt build"
```

各コミットで `npm run type-check`、各 PR で `npm run validate` と `npm run build` を必須。E2E 追加時は `npm run test:e2e`。

### 0.3 TDD サイクル（t_wada Outside-In）

1. **Red**: BDD シナリオをテストとして先に書き、現行コードで失敗することを確認
2. **Green**: 最小実装でテストをパス
3. **Refactor**: 重複除去・命名改善、テストは Green 維持

---

## Wave 0: 再スキャン＆アーカイブ判定（0.5日）

### 目的

`pbi/` に残置の 5 件（29-04/08/13/14/19）が VulnHunter 再スキャンで解消済みか判定し、解消なら即アーカイブ。

### 手順

```bash
# 1. 再現テストの GREEN→RED 確認（例: 29-04 のインターリーブ消失）
npx vitest run src/utils/__tests__/keySerializer.test.ts src/background/__tests__/optimisticLock.test.ts
# 2. VulnHunter 再スキャン（ローカル or CI）
npx tsc --noEmit && npm run validate
# 3. 解消確認後、アーカイブ
git mv pbi/2026-08-29-04-fix-storage-rmw-serialization.md dev-docs/archived/pbi/
git mv pbi/2026-08-29-08-fix-resource-boundary-caps.md dev-docs/archived/pbi/
git mv pbi/2026-08-29-14-fix-security-hardening-code-quality.md dev-docs/archived/pbi/
git mv pbi/2026-08-29-19-fix-cspvalidator-self-allow.md dev-docs/archived/pbi/
# 29-13 は 29-12 完了後まで保留
# 4. INDEX 更新
# pbi/00-INDEX.md から該当行削除、アーカイブ履歴に1行追記
```

### 成果物

- `dev-docs/archived/pbi/` に 4 ファイル移動
- `pbi/00-INDEX.md` 更新コミット
- 再スキャンレポート（`dev-docs/archived/plans/` に任意保存）

---

## Wave 1: セキュリティ単独 + クレンジング Enabler 並列（3日）

### Track A: 29-06 信頼境界一貫性（2pt・高リスク・単独ブランチ）

**ブランチ**: `fix/trust-boundary-consistency`

#### 1. `src/content/loader.ts` — e2e 分岐の await 化

現行（脆弱）:

```ts
if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
  const cacheCheck = await checkDomainAllowedFromCache(url);
  if (cacheCheck.useCache && !cacheCheck.allowed) return;
  await import(chrome.runtime.getURL('content-extractor.js'));
  return;
}
```

修正後（BDD: コールドキャッシュでも SW 検証を待つ）:

```ts
if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
  const cacheCheck = await checkDomainAllowedFromCache(url);
  if (cacheCheck.useCache) {
    if (!cacheCheck.allowed) return;
    await import(chrome.runtime.getURL('content-extractor.js'));
    return;
  }
  // useCache === false → SW にフォールバック（通常ブランチと同一）
  const response = await chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
  if (!response?.allowed) return;
  await import(chrome.runtime.getURL('content-extractor.js'));
  return;
}
```

#### 2. `src/background/offlineQueueProcessor.ts` — force 解除

```ts
// Before
await deps.recordingPipeline.record({ ...payload, force: true, skipDuplicateCheck: true });

// After — 2ゲートを再評価
await deps.recordingPipeline.record({
  ...payload,
  force: false, // 明示的にゲートを通す
  skipDuplicateCheck: payload.skipDuplicateCheck ?? false,
  recordType: 'manual',
});
```

`checkDomainFilterStep` と `checkPrivacyHeadersStep` が再実行されることを統合テストで担保。

#### 3. `confirm_token` 廃止とパーアクション発行

`src/background/handlers/dashboardSqlite/readOnlyHandler.ts`:

```ts
// Before
case 'confirm_token':
  return { token: await confirmTokenManager.createToken() };

// After — 削除（読み取りサブタイプ自体を廃止）
// dashboardSqliteService.ts 側で破壊的操作の直前に発行
```

`src/dashboard/dashboardSqliteService.ts`:

```ts
async function deleteWithConfirm(id: string) {
  const token = await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', op: 'create_confirm_token', action: 'delete', id });
  // token は単回使用・短TTL（例: 60秒）
  return chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', op: 'delete', id, token });
}
```

`confirmTokenManager.ts` は `chrome.storage.session` のみにし、TTL 60秒・単回使用を強制。

#### 4. `src/popup/recordCurrentPage/tabContentFetcher.ts` — 権限ラダー

```ts
async function fetchWithPermissionFallback(tabId: number): Promise<string> {
  try { return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT' }); } catch {}
  // Level 1: activeTab は既に試行済み、Level 2: per-origin
  if (await permissionManager.requestPermission({ origins: [new URL(tab.url).origin + '/*'] })) {
    return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT' });
  }
  // Level 3: <all_urls> は設定オプトインでのみ
  const { allowAllUrlsOptIn } = await chrome.storage.local.get('allowAllUrlsOptIn');
  if (allowAllUrlsOptIn && await permissionManager.requestPermission({ origins: ['<all_urls>'] })) {
    return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT' });
  }
  throw new Error('Permission denied');
}
```

#### テスト

- `src/content/__tests__/loader.trustBoundary.test.ts` — コールドキャッシュで SW round-trip を await することを Fake Port で検証
- `src/background/__tests__/offlineQueueProcessor.test.ts` — blocked.example が再送でスキップされる
- `src/popup/__tests__/tabContentFetcher.permissionLadder.test.ts`

#### 成果物

- 4 ファイル修正 + 3 テストファイル追加/更新
- `npm run validate` green、e2e 回帰なし

---

### Track B-1: 30-12 多言語パターン拡充（1日）

**触接**: `src/utils/aiSummaryCleaner/patterns.ts` のみ — 完全独立

```ts
// 追加例: フランス語・ドイツ語・中国語の広告/ソーシャル定型句
export const I18N_AD_PATTERNS = [
  /publicité/i, /annonce/i,           // fr
  /Werbung/i, /Anzeige/i,              // de
  /广告/, /推广/,                        // zh
];
export const I18N_SOCIAL_PATTERNS = [
  /Partager/i, /Suivre/i,              // fr
  /Teilen/i, /Folgen/i,                 // de
];
```

`stripCore.ts` / `stripExtended.ts` で `I18N_*` を `buildClassIdSelectors` に追加ではなく、**テキストマッチ**として `helpers.ts` の `isLikelyAd` 系に統合し、クラス誤爆を避ける。

テスト: `patterns.test.ts` に多言語ケース 10 件追加。

---

### Track B-2: 30-04 1パス集約ベンチマーク（1日・investigate）

```bash
# 新設
scripts/benchmark-cleansing.mjs
# 出力
dev-docs/benchmark-cleansing-2026-08-30.md
```

```js
// benchmark-cleansing.mjs 骨子
import { JSDOM } from 'jsdom';
const dom = new JSDOM(largeHtml);
const root = dom.window.document.body;
console.time('74x querySelectorAll');
for (let i=0;i<74;i++) root.querySelectorAll('[class*="ad-"]');
console.timeEnd('74x querySelectorAll');
console.time('1-pass TreeWalker');
// 1回の TreeWalker で全パターン判定
console.timeEnd('1-pass TreeWalker');
```

**成果物**: 計測レポート（例: 74回 12ms → 1パス 2ms で 6倍改善なら 30-05 Go、1.2倍なら No-Go）。`dev-docs/` に保存し PR に添付。

---

### Track B-3: 30-06 プリセット（3日・UI 中心）

**新設**: `src/utils/aiSummaryCleaner/presets.ts`

```ts
export type PresetId = 'minimal' | 'balanced' | 'aggressive' | 'custom';
export const PRESETS: Record<PresetId, Partial<CleansingConfig>> = {
  minimal: { adEnabled: true, socialEnabled: false, deepEnabled: false },
  balanced: { adEnabled: true, socialEnabled: true, deepEnabled: false, newsEnabled: true },
  aggressive: { adEnabled: true, socialEnabled: true, deepEnabled: true, newsEnabled: true, ecEnabled: true },
  custom: {},
};
```

**UI**: `entrypoints/options/index.html` に `<select id="cleansing-preset">` を追加

```html
<select id="cleansing-preset" data-i18n="cleansingPresetLabel">
  <option value="minimal">Minimal</option>
  <option value="balanced">Balanced</option>
  <option value="aggressive">Aggressive</option>
  <option value="custom">Custom</option>
</select>
```

**ロジック**: `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` で `onPresetChange` → `applyPreset(presetId)` → 32トグルを一括更新 → `chrome.storage.local.set`。`custom` は手動変更時に自動遷移。

**設定項目**: `StorageKeys.CLEANSING_PRESET = 'cleansing_preset'`（`src/utils/storage/types.ts` に追加）。

テスト: Playwright `tests/e2e/cleansing-presets.spec.ts` で 保存→リロード→トグル状態検証。

---

### Track B-4: 30-09 コーパス CI 土台（1日で土台のみ）

```bash
test/corpus/
  watanavi.html
  cookpad.html
  qiita.html
  # ... 10サイト
scripts/check-cleansing-corpus.mjs
```

```js
// check-cleansing-corpus.mjs 骨子
import { cleanseAISummaryContent } from '../src/utils/aiSummaryCleaner/index.js';
for (const file of corpusFiles) {
  const html = readFileSync(file, 'utf8');
  const dom = new JSDOM(html);
  const before = dom.window.document.body.textContent.length;
  cleanseAISummaryContent(dom.window.document.body);
  const after = dom.window.document.body.textContent.length;
  // 誤爆検出: 本文保護された要素が削除されていないか
  assert(!dom.window.document.querySelector('[data-ow-body-protected]') === null || after > before * 0.5);
}
```

`package.json`:

```json
{ "scripts": { "check:cleansing-corpus": "node scripts/check-cleansing-corpus.mjs" } }
```

CI: `validate` に `check:cleansing-corpus` を統合（失敗で CI red）。

**成果物**: 10 HTML + スクリプト + CI 配線。以降の 01/02/12 の回帰ネット。

---

## Wave 2: クレンジング中核 + Crypto SSOT（5日）

### 30-02 セマンティック分類（2日）

**Before** (`helpers.ts:buildClassIdSelectors`):

```ts
export function buildClassIdSelectors(patterns: string[]): string {
  return patterns.map(p => `[class*="${escapeCssSelector(p.toLowerCase())}"]`).join(', ');
}
// 問題: 'ad-' が 'address' にヒット
```

**After**:

```ts
export function isLikelyAdSemantic(elem: Element): boolean {
  const cls = getLowerClassName(elem);
  const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/; // 単語境界
  if (AD_WORD_RE.test(cls)) return true;
  if (elem.getAttribute('role') === 'complementary' && /sponsor|ad/i.test(elem.textContent||'')) return true;
  if (elem.getAttribute('aria-label')?.toLowerCase().includes('advertisement')) return true;
  return false;
}
// stripCore.ts では querySelectorAll ではなく TreeWalker + isLikelyAdSemantic で判定
```

`patterns.ts` の `SOCIAL_CLASS_PATTERNS` から `'x-'` を除去し、`isLikelySocial` を同様に決定木化。

テスト: `helpers.test.ts` に `address-book` / `admin-panel` / `x-data` が削除されないケースを追加。

### 30-01 Readability スコア置換（3日）

**Before** (`readabilityScore.ts` 40行ヒューリスティック):

```ts
export function calculateReadabilityScore(el: Element): number {
  let score = text.length/10 + p.length*25 + h.length*50 + classBonus - linkPenalty;
  return score;
}
```

**After** (Mozilla Readability 相当):

```ts
export function calculateReadabilityScore(el: Element): number {
  // Readability.js のスコアリングを軽量化移植
  // 1. テキスト密度 = textLength / (pCount + 1)
  // 2. リンク密度 = linkTextLength / textLength（0.5以上で 0.5倍）
  // 3. 親要素へのスコア伝播: 子のスコア * 0.5 を親に加算
  // 4. クラスボーナス: positivePatterns は +25、negative は -25 に縮小
  // しきい値 200 は維持し、短文でも本文保護されることをテストで保証
}
```

`bodyProtection.ts` の `markBodyElements` は変更なし（呼び出すスコア関数だけ差し替え）。

テスト: 短文600字+見出し1つで `data-ow-body-protected` が付与されることを検証。1000要素DOMで 2倍以内性能を計測。

### 29-12 Crypto SSOT（3pt・高リスク・単独ブランチ `fix/crypto-policy-ssot`）

**新設**: `src/utils/crypto/cryptoParams.ts`

```ts
export const CRYPTO_PARAMS = {
  PBKDF2_ITERATIONS: 600_000,
  ENVELOPE_VERSION: 2,
  HMAC_KEY_LENGTH: 256,
} as const;
export function validatePasswordPolicy(pw: string): { ok: boolean; reason?: string } {
  // 旧 masterPassword.ts:78-86 の弱い length>=8 を、encryptionSession.ts:262-274 の strict に一本化
  // 文字種3種以上・強度スコア閾値など
}
```

**付け替え**（3経路を SSOT 参照に）:

```ts
// src/utils/crypto/primitives.ts
import { CRYPTO_PARAMS } from './cryptoParams.js';
const PBKDF2_ITERATIONS = CRYPTO_PARAMS.PBKDF2_ITERATIONS; // 100k → 600k

// src/utils/settingsExportImport.ts:110,168
import { CRYPTO_PARAMS } from './crypto/cryptoParams.js';
const iterations = CRYPTO_PARAMS.PBKDF2_ITERATIONS;

// src/utils/masterPassword.ts:213,218
import { validatePasswordPolicy } from './crypto/cryptoParams.js';
```

**KEK session-only 化** (`hmacKeyStore.ts:96-138`):

```ts
// Before: local + session の両方に保存
await Promise.all([chrome.storage.session.set({[KEY]: b64}), chrome.storage.local.set({[KEY]: b64})]);
// After: session のみ。local への書き込みを削除
await chrome.storage.session.set({ [HMAC_WRAPPING_KEY_SESSION]: keyBase64 });
// リカバリは deriveHmacWrappingKey(password, salt) を master password 経由で
```

**RateLimit 永続化** (`RateLimitService.ts`):

```ts
// Before: session のみ
const sessionStorage = await this.storage.session.get([...]);
// After: local にも永続化（NTP skew 対策で Math.max で読み出し済みのパターンを維持）
// checkRateLimit 内で failedAttempts を local にも書き込み
await this.storage.local.set({ [STORAGE_KEYS.FAILED_ATTEMPTS]: attempts + 1 });
```

**HMAC 先行化統合** (`settingsExportImport.ts`):

```ts
// 新形式: ciphertext 全体に HMAC
export interface ExportEnvelopeV2 { version: 2; ciphertext: string; iv: string; hmac: string; iterations: number; }
// import フロー: file.size cap(10MB) → typed-array decode → HMAC検証 → KDF(600k) → 復号
if (envelope.version === 2) {
  await verifyHmac(envelope.ciphertext, envelope.hmac, key);
  const plaintext = await decrypt(envelope.ciphertext, key);
} else {
  // 旧形式: 互換読み込みのみ
  const plaintext = await decryptLegacy(envelope);
}
```

**設定項目**:

- `CRYPTO_PARAMS.PBKDF2_ITERATIONS` を SSOT 化、3経路で同一値を使用
- `CHANGELOG.md` と `public/PRIVACY.md` / `docs/PRIVACY.md` に新形式の説明を同期

テスト: `cryptoParamsSSOT.test.ts`（SSOT 参照網羅・旧形式互換）、`rateLimitPersistence.test.ts`（session clear 後もカウンタ継続）。

---

## Wave 3: 観測性・透明性・SPA・Shadow DOM（5日）

### 30-14 観測性ファネル（2日）

`src/utils/contentExtractor/types.ts`:

```ts
export interface ExtractResult {
  // 既存...
  removedByReason?: Map<string, number>; // 例: 'ad'->12, 'social'->3
  funnel?: { pageBytes: number; candidateBytes: number; cleansedBytes: number; };
}
```

`src/utils/contentExtractor/cleansedReason.ts` 新設:

```ts
export function recordRemoval(reason: string) { /* Map にカウント */ }
```

`src/dashboard/cleansingStatsView.ts` でファネルを可視化（`pageBytes → candidateBytes → cleansedBytes` の 3段階バー）。

### 30-11 二重ペイロード（3日・14の後）

```ts
export interface ExtractResult {
  content: string; // cleansed
  originalContent?: string; // 二重ペイロード: 元テキストも保持
  dualPayloadEnabled?: boolean;
}
```

`src/utils/contentExtractor/index.ts` で `originalContent` を保存しつつ `content` をクレンジング。ダッシュボードで `cleansed` / `original` をタブ切替表示。`cleansingStatsView.ts` で差分のハイライト。

### 30-13 SPA 動的コンテンツ（3日・独立）

`src/content/contentKernel.ts`:

```ts
let observer: MutationObserver | null = null;
export function watchDynamicContent(root: Element, onChange: () => void) {
  observer = new MutationObserver(debounce(() => {
    if (isBodyProtected(root)) return;
    onChange();
  }, 500));
  observer.observe(root, { childList: true, subtree: true });
}
```

`extractor.ts` で `watchDynamicContent` を呼び、遅延読み込みされた本文を再抽出。

### 30-03 Shadow DOM / iframe 走査（3日・独立）

`src/utils/aiSummaryCleaner/helpers.ts`:

```ts
export function querySelectorAllDeep(root: Element | ShadowRoot, selector: string): Element[] {
  const results: Element[] = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) results.push(...querySelectorAllDeep(el.shadowRoot, selector));
    if (el.tagName === 'IFRAME') {
      try { const doc = (el as HTMLIFrameElement).contentDocument; if (doc) results.push(...querySelectorAllDeep(doc.body, selector)); } catch {}
    }
  }
  return results;
}
```

各 `strip*` 関数を `querySelectorAll` → `querySelectorAllDeep` に置換。`bodyProtection.ts` も同様。

テスト: `helpers.test.ts` に shadowRoot を持つ jsdom ケース追加。

---

## Wave 4: 高 Effort・低 RICE（任意・需要に応じて）

### 30-07 ドメイン別オーバーライド（5日）

`src/utils/storage/types.ts`:

```ts
export interface DomainCleansingOverride {
  domain: string;
  overrides: Partial<CleansingConfig>; // 例: example.com では deepEnabled=true
}
export const STORAGE_KEYS = { DOMAIN_CLEANSING_OVERRIDES: 'domain_cleansing_overrides' };
```

`entrypoints/popup/index.html` にドメイン別トグル UI、`contentKernel.ts` で `domain` に応じた config マージ。

### 30-08 フィードバックループ（5日）

`src/dashboard/feedbackView.ts` 新設:

```ts
// ポップアップに「誤削除を報告」ボタン → { url, html, removedByReason } を storage.local に保存
// ダッシュボードで一覧表示し、パターン改善のインプットに
```

`src/utils/storage/types.ts` に `FEEDBACK_QUEUE = 'cleansing_feedback_queue'`。

---

## 保留2件の再評価基準

| PBI | 再評価トリガー | Go 条件 | No-Go 時の扱い |
|-----|---------------|---------|----------------|
| 30-05 Offscreen 委譲 | 30-04 計測結果 | 1パス集約でもメインスレッド占有が 50ms 超なら Go | 見送り（パフォーマンス影響が軽微なら不要） |
| 30-10 Whitelist 自動生成 | スパイク（1日） | LLM が 10ドメイン中 7 ドメインで正しい adapter を生成 | 見送り（手動 adapter で十分） |

---

## 設定項目一覧（StorageKeys / package.json / manifest）

| 区分 | キー/項目 | 値/型 | 追加元 |
|------|-----------|-------|--------|
| Storage | `cleansing_preset` | `PresetId` | 30-06 |
| Storage | `domain_cleansing_overrides` | `DomainCleansingOverride[]` | 30-07 |
| Storage | `cleansing_feedback_queue` | `FeedbackEntry[]` | 30-08 |
| Storage | `hmac-wrapping-key` | session-only に変更 | 29-12 |
| Storage | `passwordFailedAttempts` | local 永続化 | 29-12 |
| package.json | `check:cleansing-corpus` | `node scripts/check-cleansing-corpus.mjs` | 30-09 |
| package.json | `benchmark:cleansing` | `node scripts/benchmark-cleansing.mjs` | 30-04 |
| manifest | 変更なし | — | 全 Wave |

---

## 成果物チェックリスト（DoD）

各 PBI 完了時に以下を満たす:

- [ ] BDD シナリオがテストとして実装され `npm run validate` で green
- [ ] `npm run type-check` green
- [ ] `npm run build` で `dist/chromium-mv3` 生成
- [ ] E2E 回帰なし（追加時は `npm run test:e2e` で 6ケース green）
- [ ] `pbi/00-INDEX.md` から行削除 → `dev-docs/archived/pbi/` へ `git mv` → アーカイブ履歴追記
- [ ] 対応する plan があれば `dev-docs/archived/plans/` へ `git mv`
- [ ] 29系はセキュリティレビュー完了

---

## 次のアクション

1. `plan/0830-backlog-execution` を main にマージ（計画書2本）
2. Wave 0 を即実行（`chore/archive-vulnhunt-remaining` ブランチ）
3. Wave 1 を2トラック並列で着手（`fix/trust-boundary-consistency` と `feat/cleansing-wave1-enablers`）
