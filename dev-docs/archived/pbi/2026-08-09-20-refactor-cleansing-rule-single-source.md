# PBI: クレンジングルールの定義を単一の表に集約する

**作成日**: 2026-08-09
**優先度**: 高
**見積もり**: 🔴大（5pt目安）
**副作用**: 🟡軽微（デフォルト値の不一致を是正するため、一部ルールの初期状態が変わりうる）
**種別**: ♻️リファクタリング（refactor）

---

## フェーズ0: 既実装確認（実施済み・2026-08-09）

着手前に以下を確認済み。**未実装**であることを確認した。

```bash
# ルール表に storageKey / i18nKey を持たせる実装はあるか
grep -n "storageKey\|defaultEnabled" src/utils/aiSummaryCleaner/rules.ts
# → defaultEnabled のみ存在。storageKey / i18nKey は無い
```

PBI 2026-08-09-18 で `CLEANSING_RULES`（32行）を新設し、**ルールの実行**は集約済み。
本PBIはその続きで、**ルールの宣言**を集約する。

---

## 背景

アーキテクチャレビュー（2026-08-09、候補01）で、
**「どのクレンジングルールが存在するか」という1つの事実が10層に手書きされている**ことが判明した。

### 実測した層と件数

| # | ファイル | 内容 | 件数 |
|---|---|---|---|
| 1 | `src/utils/aiSummaryCleaner/rules.ts` | `CLEANSING_RULES` 行 | 32 |
| 2 | `src/utils/aiSummaryCleaner/types.ts` | `AiSummaryCleanseOptions` の `xEnabled` | 33 |
| 3 | `src/utils/aiSummaryCleaner/types.ts` | `AiSummaryCleanseResult` の `xRemoved` | 33 |
| 4 | `src/utils/contentExtractor/index.ts:91` | 分割代入のデフォルト | 37 |
| 5 | `src/utils/contentExtractor/index.ts:466-501` | `countAISummaryTargets` への転記 | 32 |
| 6 | `src/content/extractor.ts:86-117` | `config.aiSummaryCleansingX` → `xEnabled` の写像 | 33 |
| 7 | `src/content/extractor.ts:186-224` | `booleanKeys` タプル列 | 46 |
| 8 | `src/content/pageState.ts:70-102` | `CleansingConfig` の型 + 既定値 | 33×2 |
| 9 | `src/utils/storage/types.ts` | `StorageKeys.AI_SUMMARY_CLEANSING_*` | 42 |
| 10 | `src/utils/storage/defaults.ts:101-141` | `DEFAULT_SETTINGS` | 42 |
| 11 | `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` | 型 + get + UI取得の3重 | 33×3 |
| 12 | `src/utils/aiSummaryCleaner/ruleLabels.ts` | 表示ラベルの既定 | 32 |
| 13 | `public/_locales/{ja,en}/messages.json` | i18n キー | 32×2 |

**1つのルールを追加するのに10ファイル・14箇所の編集が必要。** 合計約280行が32個の文字列を表現している。

### 実際に起きている不整合（なぜなぜ分析の結果）

デフォルト値が**3つの独立した表**に書かれ、7ルールで食い違っている。

| ルール | `defaults.ts` | `rules.ts` | `contentExtractor:91` の分割代入 | `pageState.ts` |
|---|---|---|---|---|
| `deep` | **true** | false | false | false |
| `linkDensity` | **true** | false | false | false |
| `jpLayout` | **true** | false | false | false |
| `newsMedia` | **true** | false | false | **true** |
| `ecSite` | **true** | false | false | **true** |
| `qaSite` | **true** | false | false | **true** |
| `videoSite` | **true** | false | false | **true** |

#### なぜ1: なぜ食い違うのか
デフォルト値を書く場所が4つあり、どれが正なのかを決めるルールが無いから。

#### なぜ2: なぜ4つもあるのか
層ごとに「未指定のとき何を使うか」を独立に決める必要があり、
その都度そのファイル内で完結させたから。

#### なぜ3: なぜ気づかれないのか
**通常経路では `defaults.ts` が勝つため、症状が出ない。**
`getSettings()` が `{...DEFAULT_SETTINGS, ...rawSettings}` でマージする
（`settingsStore.ts:253`）ので、dashboard 側は常に定義済みの値を受け取る。

#### なぜ4: では他の3つはいつ読まれるのか
- `contentExtractor:91` の分割代入 — 呼び出し側がキーを省略したとき
- `rules.ts` の `defaultEnabled` — `isRuleEnabled()` が `typeof value === 'boolean'` で
  false を返したとき（＝キー未指定）
- `pageState.ts` — **content script が `chrome.storage.local.get(['settings'])` を
  直接読んでおり（`extractor.ts:174`）、`DEFAULT_SETTINGS` のマージを通らない。**
  該当キーが storage に無ければ `pageState.ts` の既定値がそのまま使われる。

#### なぜ5（根本）
**「そのルールの既定値は何か」という1つの事実に対して、
所有者（single source of truth）が決まっていないから。**
`rules.ts` を作った際、実行だけを移し宣言を残したため、
表は「32個ある」ことは知っているが「それぞれの既定値が何か」については
他の3つと対等な一意見にとどまっている。

### 重要: 一部の食い違いは「意図的」である

**`defaults.ts` の `true` は誤りではない。** マイグレーションと対になっている。

`src/utils/migration.ts`:
- `migrateJpLayoutDefault()` (221行) — 既存ユーザーには `jp_layout: false` を明示的に書き込む
- `migrateCategoryBDefault()` (264行) — 既存ユーザーには Category B 4件に `false` を書き込む

つまり設計意図は「**新規ユーザーは true、既存ユーザーは false**」であり、
`defaults.ts` の `true` は新規ユーザー向けの正しい値。

一方 `rules.ts` / 分割代入の `false` は「キー未指定時のフォールバック」で、
これは**マイグレーション済みの既存ユーザーと同じ挙動**になる。

> **したがって本PBIは「どちらかに揃える」作業ではない。**
> 「新規ユーザー既定値」と「キー未指定時フォールバック」という
> **2つの異なる概念が同じ名前で書かれている**ことを分離し、
> それぞれに所有者を与える作業である。

### マイグレーション未整備の4ルール

`deep` / `linkDensity` / `enhancedHidden` / `emptyElem` には**マイグレーションが無い**。

```bash
grep -n "cleansing_deep\|cleansing_link_density\|cleansing_enhanced_hidden\|cleansing_empty_elem" src/utils/migration.ts
# → 該当なし
```

このうち `deep` と `linkDensity` は `defaults.ts` が `true`。
**既存ユーザーがこのキーを一度も保存していない場合、
拡張機能の更新だけで挙動が変わりうる。**（本PBIの調査で判明した副次的な発見）

---

## ユーザーストーリー

**開発者**として、**クレンジングルールを1箇所の宣言だけで追加・変更できる状態**がほしい、
なぜなら**現状は10ファイル14箇所の同期が必要で、実際に7ルールで既定値が食い違っており、
新規ルール追加時に同じ事故が再発するから**。

## ビジネス価値

- **不具合の予防**: 「どのルールが有効か」の食い違いは、
  利用者から見ると「設定したのに効かない / 設定していないのに効く」として現れる。
- **変更コストの低減**: ルール追加が14箇所→1箇所。ルールは今後も増える見込み（過去にCategory A/Bで9件追加）。
- **測定方法**: 新規ルール1件の追加に要する変更ファイル数（10 → 1〜2）。

---

## BDD受け入れシナリオ

```gherkin
Scenario: ルール定義が単一の表から導出される
  Given CLEANSING_RULES に32件のルールが宣言されている
  When 各層（設定既定値・storage キー・オプション型・ラベル）を参照する
  Then すべて CLEANSING_RULES から導出されており、手書きの一覧が存在しない

Scenario: 新規ルールの追加が1箇所で済む
  Given 開発者が33件目のルールを追加したい
  When CLEANSING_RULES に1行追加する
  Then storage キー・既定値・オプション型・ラベルキーがすべて自動的に揃う
  And i18n メッセージの追加漏れのみが型エラーまたはテスト失敗として検出される

Scenario: 既存ユーザーの挙動が変わらない
  Given 既存ユーザーが jpLayout を明示設定せずに使っている
  And マイグレーションにより jp_layout=false が書き込まれている
  When 本リファクタリング後に拡張機能を起動する
  Then jpLayout は false のままである

Scenario: 新規ユーザーの既定値が維持される
  Given storage が空の新規インストールである
  When 設定を読み込む
  Then jpLayout と Category B 4件は true である

Scenario: 既定値の不一致が検出される
  Given ルール表と各層の既定値を比較するテストがある
  When いずれかの層が表と異なる既定値を持つ
  Then テストが失敗する
```

---

## 受け入れ基準

- [ ] `CLEANSING_RULES` の各行が `key` / `defaultEnabled` / `storageKey` / `i18nKey` を持つ
- [ ] 「新規ユーザー既定値」と「キー未指定時フォールバック」が**別概念として命名**されている
- [ ] `DEFAULT_SETTINGS` のクレンジング42件が `CLEANSING_RULES` から導出される
- [ ] `content/extractor.ts` の `booleanKeys` 46行が表から導出される
- [ ] `pageState.ts` の `CleansingConfig` 既定値が表から導出される
- [ ] `contentExtractor/index.ts:91` の37名分割代入が解消されている
- [ ] `contentExtractor/index.ts:466-501` の32件転記が解消されている
- [ ] `aiSummaryCleansingSettingsV2.ts` の3重定義が表から導出される
- [ ] 上記7ルールの既定値不一致が解消され、**回帰テストで固定**されている
- [ ] 既存ユーザー・新規ユーザーの挙動が変わらないことをテストで保証している
- [ ] `npm run validate` が通る

---

## テスト戦略（t_wadaスタイル / Outside-In）

### E2Eテスト（最小限）
- 設定画面でルールをONにして保存 → 再読込 → ONのまま（既存E2Eで担保されていれば追加不要）

### 統合テスト（中程度）
1. **新規ユーザー経路**: storage 空 → `getSettings()` → `jpLayout` と Category B が `true`
2. **既存ユーザー経路**: マイグレーション実行後 → `jpLayout=false` が維持される
3. **content script 経路**: `chrome.storage.local.get(['settings'])` が部分的な値しか返さない場合でも、
   `pageState` の既定値が表と一致する

### 単体テスト（多数）
1. **導出の網羅性**: `DEFAULT_SETTINGS` にすべてのルールの storageKey が存在する
2. **導出の一致**: 各層の既定値が `CLEANSING_RULES` と一致する（**現在の7件の不一致を検出するテスト**）
3. **i18n の網羅**: 全ルールの i18nKey が ja/en 両方に存在する
4. **境界**: ルール表が空でも例外にならない
5. **既存の32ルール実行テスト**（`rules.test.ts`）が壊れていない

### Outside-In の進め方
1. まず「既定値の一致」テストを書く → **7件失敗することを確認**（現状の可視化）
2. 表に `storageKey` / `defaultEnabled` を追加 → テストを通す
3. 各層を導出に置換 → その都度 `npm run validate`

---

## 実装アプローチ

**段階的に進める（一括変更は禁止）。** 各段階で `npm run validate` を通す。

詳細な手順は実装計画を参照:
`dev-docs/plans/2026-08-09-pbi20-cleansing-rule-single-source-plan.md`

---

## 見積もり

🔴大（5pt目安）— 10ファイル・約280行に影響。ただし段階分割可能。

---

## 技術的考慮事項

### 依存関係
- **前提**: PBI 2026-08-09-18（`CLEANSING_RULES` 新設）が完了済み — 済
- 他PBIとの競合なし

### テスタビリティ
`CLEANSING_RULES` は純粋なデータのため、導出結果の検証はすべて単体テストで可能。
chrome API のモックが必要なのはマイグレーション経路のテストのみ。

### 非機能要件
- **性能**: 導出は起動時1回。ルール32件のループはコストにならない
- **後方互換**: storage のキー名は**変更しない**（変更するとユーザー設定が失われる）

---

## 実装者向け注記

### 着手前に必ず実行

```bash
# 1. 現在の不一致を自分の目で確認する
grep -n "AI_SUMMARY_CLEANSING_DEEP\]\|AI_SUMMARY_CLEANSING_LINK_DENSITY\]" src/utils/storage/defaults.ts
grep -n "key: 'deep'\|key: 'linkDensity'" src/utils/aiSummaryCleaner/rules.ts
# → defaults.ts は true、rules.ts は false であることを確認

# 2. マイグレーションの存在を確認する
grep -n "^export async function migrate" src/utils/migration.ts
```

### 最大の落とし穴: 「揃える」と壊れる

**`rules.ts` の `false` に合わせて `defaults.ts` を `false` に変えてはいけない。**
新規ユーザーの Category A/B 既定値が失われる（マイグレーションの設計意図と矛盾する）。

**逆に `defaults.ts` の `true` に合わせて `rules.ts` を `true` にしてもいけない。**
`isRuleEnabled()` のフォールバックが変わり、
キー未指定でルールを呼ぶ既存テストとカウント処理の挙動が変わる。

→ **2つは別概念なので、別のフィールド名で両方を表に持たせる**のが正解。

### 落とし穴: content script は DEFAULT_SETTINGS を通らない

`src/content/extractor.ts:174` は `chrome.storage.local.get(['settings'])` を直接読む。
`getSettings()` を経由しないため `DEFAULT_SETTINGS` のマージが効かない。
`pageState.ts` の既定値を消して「表から取ればよい」と単純化すると、
**content script だけ別の既定値になる**。表から導出する際もこの経路を通す必要がある。

### 落とし穴: `nav` ルールは2関数の合計

```typescript
{ key: 'nav', defaultEnabled: true, strip: (el) => stripNavElements(el) + stripLegalTextNodes(el) },
```
`nav` だけ2つの strip 関数の合計値。1対1対応を前提にすると壊れる。

### 落とし穴: `xRemoved` フィールドは削除しない

`types.ts` の `xRemoved` 33件は `removed` マップの射影として残されている
（PBI-18のコメント参照）。読み手が名前でアクセスしているため、
「導出できるから消す」と広範囲が壊れる。**射影は維持する。**

### 落とし穴: storage キー名は変更禁止

`ai_summary_cleansing_jp_layout` などのキー名を変えると、
既存ユーザーの設定が全て初期値に戻る。表に `storageKey` を持たせる際は
**既存の文字列をそのまま書き写す**こと。

---

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既定値の一致テストが追加され、意図的な差分は明示的に記述されている
- [ ] `npm run validate` が通る
- [ ] `npm run build` が通る
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（既定値の是正がある場合は利用者向けに明記）

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補01）
- 先行PBI: 2026-08-09-18（クレンジングルール表の新設）— **本PBIの前提**
- `src/utils/migration.ts` の3マイグレーション（設計意図の根拠）
