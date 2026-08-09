# PBI-20: クレンジングルール定義の単一ソース化 実装計画

> **Source PBI:** `pbi/2026-08-09-20-refactor-cleansing-rule-single-source.md`（フェーズ0調査済み・2026-08-09）
> **前提PBI:** 2026-08-09-18（`CLEANSING_RULES` 新設）完了済み

**Goal:** クレンジングルールの宣言を `CLEANSING_RULES` 1箇所に集約し、
10層に散在する約280行の手書き定義を導出に置き換える。

**Tech Stack:** TypeScript (nodeNext ESM), Vitest, jsdom

**所要目安:** 5pt（Step 1〜3 で約2pt、Step 4〜7 で約3pt）

---

## 最重要の前提知識（着手前に必ず読むこと）

### 「デフォルト値」という言葉が2つの別概念を指している

この PBI で最も間違えやすい点。**混同すると既存ユーザーの設定が壊れる。**

| 概念 | 現在の置き場所 | 意味 | 例 |
|---|---|---|---|
| **A. 新規ユーザー既定値** | `storage/defaults.ts` | storage が空の新規インストールに適用する値 | `jpLayout: true` |
| **B. キー未指定時フォールバック** | `rules.ts` の `defaultEnabled`<br>`contentExtractor:91` の分割代入<br>`pageState.ts` | 呼び出し側が値を渡さなかったときの値 | `jpLayout: false` |

**A と B が違うのは正しい。** マイグレーション（`migration.ts:221, 264`）が
「既存ユーザーには明示的に false を書き込む」設計だから。

```
新規ユーザー: storage 空 → DEFAULT_SETTINGS の true が適用される
既存ユーザー: マイグレーションが false を書き込む → false が適用される
キー未指定 : B のフォールバック false が使われる（＝既存ユーザーと同じ挙動）
```

→ **本計画では A を `newUserDefault`、B を `fallbackWhenUnset` という別名で表に持たせる。**
どちらかに「揃える」のは誤り。

### 現在の不一致一覧（Step 0 で自分の目で確認すること）

| ルール | A: `defaults.ts` | B: `rules.ts` | マイグレーション |
|---|---|---|---|
| `deep` | true | false | **無し** ← 要注意 |
| `linkDensity` | true | false | **無し** ← 要注意 |
| `jpLayout` | true | false | あり |
| `newsMedia` / `ecSite` / `qaSite` / `videoSite` | true | false | あり |
| `enhancedHidden` / `emptyElem` | false | false | 無し（一致） |

`deep` と `linkDensity` は「A=true なのにマイグレーションが無い」状態。
**本PBIでは挙動を変えない**（現状を表に写し取るだけ）。是正は別PBIとする。

---

## Step 0: 現状確認（実装ではない・必須）

- [ ] 以下を実行し、出力を目視する

```bash
cd /Users/yaar/Playground/obsidian-smart-history

# A の値
grep -n "AI_SUMMARY_CLEANSING_DEEP\]\|AI_SUMMARY_CLEANSING_LINK_DENSITY\]\|AI_SUMMARY_CLEANSING_JP_LAYOUT\]\|AI_SUMMARY_CLEANSING_NEWS_MEDIA\]" src/utils/storage/defaults.ts

# B の値
grep -n "key: 'deep'\|key: 'linkDensity'\|key: 'jpLayout'\|key: 'newsMedia'" src/utils/aiSummaryCleaner/rules.ts

# マイグレーションの一覧
grep -n "^export async function migrate" src/utils/migration.ts
```

- [ ] `src/utils/aiSummaryCleaner/rules.ts` を通読し、32行の表の形を把握する
- [ ] `src/utils/storage/types.ts` の `AI_SUMMARY_CLEANSING_*` 42件を確認する

---

## Step 1: 不一致を可視化するテストを書く（Red）

**目的:** 現状の7件の不一致をテストで見えるようにする。この時点では**失敗してよい**。

- [ ] `src/utils/aiSummaryCleaner/__tests__/ruleDefaultsConsistency.test.ts` を新規作成

```typescript
import { describe, it, expect } from 'vitest';
import { CLEANSING_RULES } from '../rules.js';
import { DEFAULT_SETTINGS } from '../../storage/defaults.js';

describe('CLEANSING_RULES と各層の整合性', () => {
  it('全ルールが storageKey を持ち、DEFAULT_SETTINGS に存在する', () => {
    for (const rule of CLEANSING_RULES) {
      expect(DEFAULT_SETTINGS).toHaveProperty(rule.storageKey);
    }
  });

  it('新規ユーザー既定値が DEFAULT_SETTINGS と一致する', () => {
    for (const rule of CLEANSING_RULES) {
      expect(DEFAULT_SETTINGS[rule.storageKey]).toBe(rule.newUserDefault);
    }
  });
});
```

- [ ] `npx vitest run src/utils/aiSummaryCleaner/__tests__/ruleDefaultsConsistency.test.ts`
- [ ] **型エラーで落ちることを確認**（`storageKey` / `newUserDefault` が未定義のため）。これが Red。

---

## Step 2: 表に列を追加する（Green の準備）

- [ ] `src/utils/aiSummaryCleaner/rules.ts` の `CleansingRule` を拡張

```typescript
export interface CleansingRule {
    key: string;
    /**
     * Value applied to a fresh install (storage empty).
     *
     * Differs from `fallbackWhenUnset` for rules whose rollout was staged:
     * migration.ts writes `false` for existing users so their behaviour does
     * not change on update, while new users get `true`. Keep both.
     */
    newUserDefault: boolean;
    /** Value used when a caller omits the flag entirely. */
    fallbackWhenUnset: boolean;
    /** chrome.storage key. MUST match the existing string exactly. */
    storageKey: string;
    /** i18n message key for the display label. */
    i18nKey: string;
    strip: (element: Element, thresholds: CleansingThresholds) => number;
}
```

- [ ] 既存の `defaultEnabled` を `fallbackWhenUnset` にリネームする
- [ ] 32行すべてに `newUserDefault` / `storageKey` / `i18nKey` を追加する

**値の写し取り元（勝手に決めないこと）:**

| 追加する列 | 写し取り元 |
|---|---|
| `newUserDefault` | `src/utils/storage/defaults.ts` の対応する値 |
| `fallbackWhenUnset` | 既存の `defaultEnabled` の値をそのまま |
| `storageKey` | `src/utils/storage/types.ts` の `StorageKeys.AI_SUMMARY_CLEANSING_*` の**文字列値** |
| `i18nKey` | `src/utils/aiSummaryCleaner/ruleLabels.ts` の `ruleMessageKey()` が生成する形式 |

- [ ] `isRuleEnabled()` を `fallbackWhenUnset` を見るよう修正

```typescript
export function isRuleEnabled(rule: CleansingRule, options: AiSummaryCleanseOptions): boolean {
    const value = (options as Record<string, unknown>)[`${rule.key}Enabled`];
    return typeof value === 'boolean' ? value : rule.fallbackWhenUnset;
}
```

- [ ] `npm run type-check`
- [ ] Step 1 のテストを再実行 → **通ること**を確認（Green）
- [ ] `npx vitest run src/utils/aiSummaryCleaner` → 既存の rules.test.ts が壊れていないこと
- [ ] **ここでコミット**: `refactor(cleanser): ルール表に storageKey と2種のデフォルトを追加する`

---

## Step 3: `DEFAULT_SETTINGS` を表から導出する

- [ ] `src/utils/storage/defaults.ts` のクレンジング42件のうち、
      **ルールに対応する32件**を導出に置き換える

```typescript
import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';

const CLEANSING_RULE_DEFAULTS = Object.fromEntries(
    CLEANSING_RULES.map(r => [r.storageKey, r.newUserDefault]),
);

export const DEFAULT_SETTINGS = {
    // ...既存の非クレンジング設定...
    ...CLEANSING_RULE_DEFAULTS,
    // 閾値・fallback比率などルール以外の10件はそのまま残す
    [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED]: true,
    [StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD]: 70,
    // ...
};
```

**注意:** 42件のうち10件は**ルールではない**（`ENABLED` / 各種閾値 / `CUSTOM_PATTERNS` /
`FALLBACK_RATIO` / `FALLBACK_MIN_BYTES` / `BODY_PROTECTION_*`）。これらは導出対象外。

- [ ] **循環importに注意**: `defaults.ts` → `rules.ts` → (strip関数群) の向きになる。
      `rules.ts` が `storage` を import していないことを確認する

```bash
grep -n "import" src/utils/aiSummaryCleaner/rules.ts | grep -i storage
# → 出力が無ければOK
```

- [ ] `npm run validate`
- [ ] **コミット**: `refactor(storage): DEFAULT_SETTINGS のクレンジング既定値を表から導出する`

---

## Step 4: `content/extractor.ts` の46行タプル列を導出に置換

- [ ] `src/content/extractor.ts:186-224` の `booleanKeys` を確認
- [ ] クレンジングルール分（32件）を導出に置き換える

```typescript
const cleansingRuleKeys: Array<[StorageKey, keyof CleansingConfig]> =
    CLEANSING_RULES.map(r => [
        r.storageKey as StorageKey,
        `aiSummaryCleansing${capitalize(r.key)}` as keyof CleansingConfig,
    ]);

const booleanKeys: Array<[StorageKey, keyof CleansingConfig]> = [
    [StorageKeys.CONTENT_STRIP_HARD_ENABLED, 'contentStripHardEnabled'],
    [StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED, 'contentStripKeywordEnabled'],
    [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED, 'aiSummaryCleansingEnabled'],
    ...cleansingRuleKeys,
    [StorageKeys.WHITELIST_EXTRACTION_ENABLED, 'whitelistExtractionEnabled'],
    [StorageKeys.CONTENT_DEDUP_ENABLED, 'contentDedupEnabled'],
];
```

- [ ] **落とし穴**: `capitalize` の結果が既存プロパティ名と一致するか必ず確認する。
      例外がある可能性が高いので、まず対応表を作って照合する:

```bash
# 既存のプロパティ名一覧
grep -oE "'aiSummaryCleansing[A-Za-z]+'" src/content/extractor.ts | sort -u
# ルールキー一覧
grep -oE "key: '[a-zA-Z]+'" src/utils/aiSummaryCleaner/rules.ts | sed "s/key: //"
```

一致しないものがあれば、表に `configProp` 列を追加して明示する（推測で変換しない）。

- [ ] **content script のバンドルサイズに注意**: `rules.ts` は strip 関数群を import している。
      content script が `rules.ts` を丸ごと取り込むとバンドルが増える。
      **キーだけが必要なら、strip 関数を含まない軽量な定義ファイルへの分離を検討する**
      （例: `ruleKeys.ts` に key/storageKey/デフォルトのみを置き、`rules.ts` がそれを import する）。

- [ ] `npm run build` でバンドルサイズを確認
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(content): クレンジング設定キー列をルール表から導出する`

---

## Step 5: `pageState.ts` の既定値を導出に置換

- [ ] `src/content/pageState.ts:70-102` の `CleansingConfig` 既定値を導出に置き換える
- [ ] **どちらの概念を使うか**: content script は `DEFAULT_SETTINGS` を通らないため、
      **`fallbackWhenUnset` ではなく `newUserDefault` を使う**のが現状に近い…
      **と決めつけず、現在の値を確認して合わせること**

現状（調査結果）:
| ルール | `pageState.ts` の現在値 | 一致するのは |
|---|---|---|
| `deep` / `linkDensity` / `jpLayout` | false | `fallbackWhenUnset` |
| `newsMedia` / `ecSite` / `qaSite` / `videoSite` | true | `newUserDefault` |

**混在している。** 本PBIでは**挙動を変えない**方針なので、
表に `contentScriptDefault` 列を足して現在値を写し取るか、
あるいは「なぜ混在しているか」を調べて統一する。

> **判断が必要な箇所。** 統一する場合は挙動変更になるため、
> CHANGELOG に記載し、シニアに相談すること。
> 迷ったら「現在値を写し取る」（＝挙動不変）を選ぶ。

- [ ] `npm run validate`
- [ ] **コミット**

---

## Step 6: `contentExtractor/index.ts` の分割代入と転記を解消

- [ ] `index.ts:91` の37名分割代入を、options オブジェクトをそのまま渡す形に変更

```typescript
// Before: 37個の名前を展開して個別に渡す
const { altEnabled = true, metadataEnabled = true, /* ...35個... */ } = aiSummaryCleanseOptions;

// After: ルール由来のフラグは展開せず、そのまま渡す
const { aiSummaryCleanseEnabled = false, linkRatioThreshold = 70, shortTextThreshold = 30,
        shortSeqCount = 5, linkParaThreshold = 50, customPatterns = [],
        fallbackRatio = 0.20, fallbackMinBytes = 300 } = aiSummaryCleanseOptions;
// ルールのxEnabledは isRuleEnabled() が options から直接読むので展開不要
```

- [ ] `index.ts:466-501` の `countAISummaryTargets` への32件転記を削除し、
      `aiSummaryCleanseOptions` をそのまま渡す

```typescript
const aiSummaryCountResult = countAISummaryTargets(document.body, aiSummaryCleanseOptions);
```

- [ ] **落とし穴**: 現在の分割代入は「デフォルト値の適用」も兼ねている。
      展開をやめると `isRuleEnabled()` の `fallbackWhenUnset` が効くようになる。
      **Step 2 で `fallbackWhenUnset` に既存の `defaultEnabled` を写しているので値は同じ**だが、
      必ずテストで確認すること。

- [ ] `npx vitest run src/utils/contentExtractor src/utils/aiSummaryCleaner`
- [ ] `npm run validate`
- [ ] **コミット**

---

## Step 7: `aiSummaryCleansingSettingsV2.ts` の3重定義を導出に置換

- [ ] 型定義（12-62行）・`getAiSummaryCleansingSettings()`（68-118行）・
      UI取得（355-386行付近）の3箇所を導出に置き換える

```typescript
export type AiSummaryCleansingSettings = {
    [K in CleansingRuleKey as `${K}Enabled`]: boolean;
} & {
    enabled: boolean;
    linkRatioThreshold: number;
    // ...閾値系...
};

export async function getAiSummaryCleansingSettings(): Promise<AiSummaryCleansingSettings> {
    const settings = await getSettings();
    const ruleFlags = Object.fromEntries(
        CLEANSING_RULES.map(r => [
            `${r.key}Enabled`,
            settings[r.storageKey] ?? r.newUserDefault,
        ]),
    );
    return { ...ruleFlags, enabled: ..., /* 閾値系 */ } as AiSummaryCleansingSettings;
}
```

- [ ] **落とし穴**: UI取得部（`document.getElementById('ai-summary-cleansing-xxx')`）の
      **HTML id は kebab-case**、ルールキーは camelCase。変換規則を表に持たせるか確認する

```bash
grep -oE "id=\"ai-summary-cleansing-[a-z-]+\"" entrypoints/options/index.html | sort -u
```

- [ ] `npm run validate`
- [ ] **コミット**

---

## Step 8: i18n 網羅テストと仕上げ

- [ ] 全ルールの i18nKey が ja/en 両方に存在するテストを追加

```typescript
it('全ルールのラベルが ja/en に存在する', async () => {
  const ja = JSON.parse(await readFile('public/_locales/ja/messages.json', 'utf-8'));
  const en = JSON.parse(await readFile('public/_locales/en/messages.json', 'utf-8'));
  for (const rule of CLEANSING_RULES) {
    expect(ja).toHaveProperty(rule.i18nKey);
    expect(en).toHaveProperty(rule.i18nKey);
  }
});
```

- [ ] **落とし穴**: `messages.json` には**重複キーが6件存在する**（PBI-18 の調査で判明）。
      `JSON.parse` は後勝ちで読むため、テストは通るが編集時は注意。
      **`json.dump` 相当の書き戻しは絶対に行わない**（重複キーが消え差分が壊れる）。

- [ ] `npm run validate`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] CHANGELOG.md に記載

---

## 完了確認チェックリスト

- [ ] `grep -c "Enabled?: boolean;" src/utils/aiSummaryCleaner/types.ts` が減っている
- [ ] `src/content/extractor.ts` の `booleanKeys` に個別ルール行が無い
- [ ] `src/utils/storage/defaults.ts` にルール32件の個別行が無い
- [ ] 新規テスト（整合性・i18n網羅）がパスする
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` すべて成功

---

## 困ったときの判断基準

| 状況 | 判断 |
|---|---|
| A と B のどちらを使うか迷った | **現在の挙動を変えない方**を選ぶ。迷いを PBI にコメントで残す |
| キー名の変換規則が一致しない | 推測で変換せず、表に明示的な列（`configProp` 等）を足す |
| バンドルサイズが増えた | 軽量な `ruleKeys.ts` に分離する（Step 4 参照） |
| 既存テストが落ちた | **テストが仕様を書いているのか、バグを固定しているのか**を先に判断する。PBI-18 で後者の前例あり |
| 挙動を変える判断が必要 | 本PBIの範囲外。別PBIに切り出してシニアに相談する |
