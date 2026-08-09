# PBI: クレンジングルール一覧を単一のルール表に集約する

**作成日**: 2026-08-09
**優先度**: 高
**見積もり**: 🔴大（5pt目安）
**副作用**: 🔴あり（履歴画面のクレンジング件数・理由の表示が変わる）
**種別**: ♻️リファクタリング（refactor）＋🐛バグ修正（fix）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補01+03）で、AI要約クレンジングの
**ルール一覧が複数箇所に別々に書かれており、既に食い違っている**ことが判明した。

`/grilling` による設計対話（質問1〜6, 10）を経て方針を決定済み。

### 事実: 同じ「32ルール」が層ごとに違う数で書かれている

| 層 | ファイル | ルール数 |
|---|---|---|
| オプション型 | `types.ts` `AiSummaryCleanseOptions` | 32 |
| 結果型 | `types.ts` `AiSummaryCleanseResult` | 35（optional） |
| 削除の実行 | `aiSummaryCleaner/index.ts` | 32（1ルールにつき5箇所ずつ記述） |
| カウント | `aiSummaryCleaner/countTargets.ts` | **18** |
| 理由生成A | `contentExtractor/index.ts:60-77` | **6** |
| 理由生成B | `contentExtractor/index.ts:521-556` | **26** |
| 表示ラベル | `historyEntryRow.ts:228-234` + i18n | **6** |

（設定層 `StorageKeys` / HTML も同じ一覧を持つが、本 PBI の対象外。決定3を参照）

### 実害1: count が15ルールを黙って捨てている

`contentExtractor/index.ts:483-518` は **32個すべて**のオプションを
`countAISummaryTargets` に渡すが、`countTargets.ts` は **17個しか分解しない**。
余剰プロパティは TypeScript の構造的型付けによりエラーにならず、**黙って捨てられる**。

検証（集合差分）:

```
cleanseAISummaryContent  → 33 options destructured
countAISummaryTargets    → 18 options destructured
落ちている15ルール: author, bodyProtection, emptyElem, enhancedHidden, fixed,
                    jpNavigation, linkPara, pagination, platform, popup,
                    recommend, shortSeq, snsPromo, symbolLine, textDensity
```

このうち **`recommendEnabled` と `popupEnabled` は既定値が `true`**
（`index.ts:90, 93`）。したがって**設定を変更していない全利用者で、
プレビュー件数が過少表示されている**。

### 実害2: 死んだ `if` が15個ある

`contentExtractor/index.ts:524-549` の理由生成は26ルールを判定するが、
count されない15ルールぶんの `if` は**永久に偽**。

### 実害3: 逆方向のドリフト（6ルール）

`countTargets.ts` が数える18ルールのうち、
`affiliate` / `ecSite` / `newsMedia` / `qaSite` / `speechBubble` / `videoSite`
の6件は理由生成側に `if` が無く、**数えても理由にならない**。

### 実害4: count と strip はセレクタ実装が異なる（既存18ルールでも一致しない）

広告ルールの例:

- `stripAdElements`（`stripCore.ts:69-101`）: `[data-ad]`, `ins.adsbygoogle`, `AD_SELECTOR`
- count の ads 分岐（`countTargets.ts:80-102`）: `[class*=]` と `[id*=]` を
  `AD_CLASS_PATTERNS` でループ。**data 属性を見ず、strip が見ない id を見る**

さらに `countTargets.ts` は `markBodyElements` / `isBodyProtected` を
**一切呼ばない**。strip 側は `safeRemoveElement`（`helpers.ts:15-21`）で
本文保護要素をスキップし、その場合カウントしない。

計測結果（`countStrategy.bench.test.ts`、同一17ルール・同一DOM）:

| | 件数 |
|---|---|
| `countAISummaryTargets` | 25 |
| `cleanseAISummaryContent`（保護ON） | 14 |
| `cleanseAISummaryContent`（保護OFF） | 14 |

**同じルール指定で 25 対 14。二重実装が実際にドリフトしている。**

> 【訂正】レビュー報告時、この差の主因を「count が本文保護を無視しているため」と
> 説明したが、計測により保護 ON/OFF で strip の結果は変わらないことが判明した。
> 主因はセレクタ実装の相違（data属性/id属性の扱い）である。
> 「二重実装がドリフトしている」という診断自体は正しい。

### 根本原因

**「どのルールが存在するか」という1つの事実が、7層に別々に書かれているから。**

ルールを1つ増やすには `index.ts` 内だけで5箇所（オプション分解 / カウンタ変数 /
ディスパッチ `if` / ログ breakdown / return オブジェクト）、
さらに `countTargets.ts`・理由生成2箇所・`labelMap`・i18n を編集する必要がある。
どれか1つを忘れても**型エラーにもテスト失敗にもならない**。

---

## 決定事項（/grilling で合意済み）

| # | 論点 | 決定 |
|---|---|---|
| 1 | どの数を正とするか | **cleanse の32を正**とし、count と reason を32に揃える |
| 2 | count / reason の存在意義 | **表示価値を認め維持**する（廃止しない） |
| 3 | ルール表の担当範囲 | **データ処理層のみ**。設定層（StorageKeys/HTML/設定UI）は据え置き |
| 4 | count の実装方法 | **`count = strip(クローン)`** で導出。`countTargets.ts` は削除 |
| 5 | 性能コスト | **1.7倍を受容**（計測済み。下記参照） |
| 6 | 新規ラベル | **26件×2言語=52件**を新規作成。実装着手時に訳案を一覧提示 |
| 10 | PBI 粒度 | 候補01と03は**不可分**（決定4により結果が自然にキー付きになるため）。1 PBI にまとめる |

### 決定4の根拠（計測）

`countStrategy.bench.test.ts` による事前計測（jsdom、中央値7回）:

| 段落数 | ノード数 | 現行 count | strip(clone) | クローン単体 | 比 |
|---|---|---|---|---|---|
| 50 | 88 | 29.6ms | 43.5ms | 0.43ms | 1.47x |
| 200 | 238 | 60.4ms | 101.1ms | 0.84ms | 1.67x |
| 800 | 838 | 203.4ms | 341.8ms | 2.28ms | **1.68x** |

- 比率はページサイズによらず **1.7倍前後で安定**（線形）
- クローン自体のコストは全体の **0.7%** に過ぎない。増加分は strip が DOM 変更を伴うため
- jsdom の絶対値は実機の指標にならない。実 Chrome では1桁以上速い
- この経路は**ページ記録時に1回**、直後の AI API 呼び出し（数百ms〜数秒）の前に走るだけ

> 【訂正】設計対話の初期に「count は body を32回走査するのでクローン1回の方が
> むしろ軽い可能性がある」と述べたが、計測により **1.7倍遅い**ことが判明した。
> クローンが軽いという予測は正しかったが、結論は逆だった。

---

## 目的

ルール一覧を**単一のルール表（値）**に集約し、
「ルールを1つ追加する」を**表に1行足す**操作にする。
count は strip から導出することで、両者の食い違いを**構造的に不可能**にする。

---

## 対象範囲

### 変更するファイル

| ファイル | 変更内容 |
|---|---|
| `src/utils/aiSummaryCleaner/rules.ts` | **新規**。`CLEANSING_RULES` 表 |
| `src/utils/aiSummaryCleaner/index.ts` | 表を走査する形に。5重記述を解消 |
| `src/utils/aiSummaryCleaner/countTargets.ts` | **削除**（497行） |
| `src/utils/aiSummaryCleaner/types.ts` | 結果型をキー付きマップに |
| `src/utils/contentExtractor/index.ts` | 理由生成2箇所（6個/26個の `if`）を表走査に |
| `src/dashboard/historyEntryRow.ts` | `labelMap` を表から導出 |
| `src/utils/commonTypes.ts` | `AiSummaryCleansedReason` を32ルール対応に拡張 |
| `public/_locales/{ja,en}/messages.json` | 各26件のラベル追加 |

### 対象外（決定3）

- `StorageKeys` の `AI_SUMMARY_CLEANSING_*`（84件）
- `entrypoints/options/index.html` のチェックボックス（63件）
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts`（82件）

**理由**: 設定層は「利用者が何をONにしたか」という別の関心事。
ここまで巻き込むと表が2つの責務を持ち、複雑さが逆に分散する（削除テストが失敗する）。

---

## 受け入れ条件

- [ ] `CLEANSING_RULES` に32ルールが1行ずつ定義されている
- [ ] `cleanseAISummaryContent` が表を走査して実行する（5重記述が消えている）
- [ ] count が `strip(クローン)` で導出され、`countTargets.ts` が削除されている
- [ ] 同一オプション指定で count と cleanse の件数が**一致**する（回帰テストで固定）
- [ ] 理由生成が32ルールに対応し、死んだ `if` が存在しない
- [ ] `affiliate` / `ecSite` / `newsMedia` / `qaSite` / `speechBubble` / `videoSite`
      が理由として表示され得る
- [ ] ja/en 各26件のラベルが追加され、英字キーがUIに露出しない
- [ ] `npm run validate` が通る
- [ ] `countStrategy.bench.test.ts` が削除されている（役目を終えたため）

---

## テスト方針

### 新規に必要なテスト

1. **表の網羅性**: `CLEANSING_RULES` の件数が32であること、
   キーが `AiSummaryCleanseOptions` のルール系キーと**過不足なく一致**すること
2. **count と strip の一致**: 同一オプション・同一DOMで両者の総数が一致すること
   （これが本 PBI の中核。二重実装の再発を検知する）
3. **ラベル網羅**: 32ルールすべてに i18n メッセージキーが存在すること
4. **既定値の反映**: `recommend` / `popup` が既定 ON でカウントされること
   （実害1の回帰防止）

### 既存テストへの影響

対象8ファイル。うち `countTargets*.test.ts` 系3ファイルは
`countAISummaryTargets` を直接呼ぶため、**移行が必要**。
削除ではなく、strip 由来の count に対する検証として書き換える
（カバレッジを落とさないこと）。

```
src/utils/__tests__/aiSummaryCleaner.test.ts
src/utils/contentExtractor/__tests__/index.test.ts
src/utils/aiSummaryCleaner/__tests__/index.test.ts
src/utils/aiSummaryCleaner/__tests__/countTargets.test.ts      ← 移行
src/utils/aiSummaryCleaner/__tests__/countTargets-r2.test.ts   ← 移行
src/utils/aiSummaryCleaner/__tests__/countTargets-r3.test.ts   ← 移行
src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
src/utils/aiSummaryCleaner/__tests__/countStrategy.bench.test.ts ← 削除
```

---

## リスクと注意点

### 1. 利用者から見える数字が変わる（副作用 🔴）

- **増加方向**: 15ルールが新たにカウントされる（既定 ON の2件を含む）
- **減少方向**: strip 由来になるため、本文保護された要素が除外される

**実装後の実測**: 既定設定・代表的なページ構造で **4件 → 6件**。
新たに `recommend` と `popup` が計上され、予測どおり**増加が支配的**だった。

```
rules firing: {"alt":1,"ads":1,"nav":1,"social":1,"recommend":1,"popup":1}
total (new, incl. recommend/popup): 6
total (old 5 default rules only)  : 4
```

CHANGELOG に「クレンジング件数の表示がより正確になった」旨を明記すること。

### 2. 永続型の拡張

`AiSummaryCleansedReason`（現在8値）を32ルール対応に拡張する。
既存データには旧来の値のみが入っているが、
`historyEntryRow.ts:242` の `labelMap[r] || r` により読み出しは壊れない。

なお現状**すでに** `removedTypes[0] as ExtractResult['aiSummaryCleansedReason']`
というキャストで `'jsonLd'` 等の union 外の値が書かれている（`index.ts:552`）。
本 PBI はこれを型として正当化する。

### 3. 性能

決定5のとおり1.7倍を受容。実機での確認は E2E で実装後に行う
（jsdom の絶対値は指標にならないため）。

### 4. 非対象ルールの扱い

`bodyProtectionEnabled` はルールではなく**保護機構**であり、
`CLEANSING_RULES` には含めない。同様に閾値系
（`linkRatioThreshold` / `shortTextThreshold` / `shortSeqCount` /
`linkParaThreshold` / `customPatterns` / `fallbackRatio` / `fallbackMinBytes`）も
ルールではなくパラメータ。

一部の strip 関数は閾値を引数に取る（`stripTextDensityElements(element, threshold)` 等、
4関数）。表はこれを表現できる形にすること。

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補01・03）
- 設計対話: `/grilling` 質問1〜6, 10
- 後続 PBI: 2026-08-09-19（SQLite 読み取り系の Result 貫通、候補02+04）— **独立、順序は本 PBI が先**
