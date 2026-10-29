# 想起検索の評価コーパスと再現手順 / Recall Evaluation Guide

[日本語](#日本語) | [English](#english)

拡張機能内の想起（検索と類似まとめ）がどの程度の再現率で記事を取り戻せるかを、固定コーパス上で数値比較するためのガイド。実装は `src/dashboard/evalCorpus.ts`（コーパス）と `src/dashboard/recallEval.ts`（測定ハーネス）。

- 対象 PBI: `pbi/2026-10-22-03-feat-meta-summary-semantic-recall.md`
- 関連: [`dev-docs/PERFORMANCE_GUIDE.md`](../dev-docs/PERFORMANCE_GUIDE.md)

---

## 日本語

### 評価コーパスの構成

`src/dashboard/evalCorpus.ts` に 15 文書と 4 問を凍結している。文書テキストは日本語と英語が混在し、FTS5 trigram の MATCH 経路と trigram ベクトル経路のどちらにも言語内の重なりが見える構成にしてある。

| 区分 | 件数 | 内容 |
|------|------|------|
| 主題文書 | 12 | WASM embedding / カレーのレシピ / 週次レビュー / 型安全性とテスト / 冪等な再開の 5 主題（id 1-12） |
| 近似的外れ文書 | 3 | id 13-15。主題語を含むが問いに答えない文書。関連判定は非関連（語彙的一致と話題関連を分ける IR の標準的な外れ文書） |

4 問は日本語クエリで、各問に関連文書の id 集合（relevantIds）を一緒に凍結している。

| クエリ id | クエリ | 関連文書 |
|-----------|--------|---------|
| q-wasm | WASM embedding ブラウザ | 1, 2, 3 |
| q-curry | カレー ジャガイモ レシピ | 4, 5, 6 |
| q-review | 週次レビュー ダイジェスト | 7, 8 |
| q-resume | 冪等 バッチ 再開 | 11, 12 |

### 測定手順（evaluateRecallAt3）

`src/dashboard/recallEval.ts` の `evaluateRecallAt3()` が純粋関数として測定する。手順は次のとおり。

1. FTS 単体側: クエリと各文書（題+要約）を文字 1-3 gram 集合にして重なり数で順位付けする。実 FTS5 trigram MATCH の依存なし近似で、トークン完全一致だと無区切りの日本語で 0 点になるためこの形にしてある
2. ハイブリッド側: 同じ FTS 順位表に文字 gram ベクトルの cosine を RRF で融合する（`src/dashboard/hybridRecallRank.ts` の `fuseFtsVectorRanks`、既定は fts 0.6 / vec 0.4 / k 60）
3. 各問ごとに recall@3 と MRR を出し、4 問で平均する
4. `hybridHolds`（ハイブリッドが FTS 単体を下回らない非退行判定）を返す

同じコーパスと同じ問いは常に同じ報告を返す（決定論的・ネットワーク不要・外部 API 呼び出しなし）。

### 実測値（2026-10-25 測定）

| 指標 | FTS 単体 | ハイブリッド |
|------|---------|-------------|
| recall@3（4 問平均） | 1.0 | 1.0 |
| MRR（4 問平均） | 0.576 | 0.576 |

クエリ別の MRR は q-wasm 0.611 / q-curry 0.611 / q-review 0.417 / q-resume 0.667（両側とも同値）。

- 15 文書級の小コーパスでは融合は FTS 順とほぼ同一になり、recall@3 と MRR は同点になる
- 非退行（hybridHolds）は成立する。ハイブリッドが FTS 単体より劣ることはない
- 受入基準「日本語クエリでハイブリッドが FTS 単体より再現率で上回る」の厳密超過は未達。これは正直な開きとして残してあり、重みの再調整は大規模判定コーパス待ち

### 再現コマンド

固定コーパスの検証は単体テストが担う。

```bash
npx vitest run src/dashboard/__tests__/recallEval.test.ts
```

3 テストが走る。

1. コーパス凍結: 15 文書（12 主題+3 外れ）と 4 問と関連判定が固定されていること
2. 決定論性: `evaluateRecallAt3()` が 2 回走らせても同一の報告を返すこと
3. 非退行: hybridHolds が true で、ハイブリッドが各問で FTS 単体の recall@3 と MRR を下回らないこと

上表の実測値そのものは `evaluateRecallAt3()` の返す報告（queries 配列の各問の recall@3 と MRR、4 つの mean 値）から読める。

### コーパス変更の作法

コーパスを変更した場合は、関連判定（relevantIds）も同時に凍結し直す。判定を変えずに文書だけ増やすと、FTS 単体とハイブリッドの比較が同じ判定上で行われなくなる。文書の追加は近似的外れ（主題語を含み問いに答えない）を 1 枚足して判定を非関連に固定するのが、語彙一致と話題関連を分けるもっとも安い方法。

---

## English

### Corpus layout

`src/dashboard/evalCorpus.ts` freezes 15 documents and 4 queries. Document text mixes Japanese and English so both the FTS5 trigram MATCH path and the trigram-vector path see in-language overlap.

| Segment | Count | Content |
|---------|-------|---------|
| Topical documents | 12 | Five topics: WASM embedding, curry recipes, weekly review, type-safety testing, idempotent batch resume (ids 1-12) |
| Near-miss distractors | 3 | ids 13-15. They share topic words but answer a different question; judged non-relevant (the standard IR way to separate lexical overlap from topical relevance) |

The 4 queries are Japanese, each with a frozen relevant id set (relevantIds).

| Query id | Query | Relevant ids |
|----------|-------|--------------|
| q-wasm | WASM embedding ブラウザ | 1, 2, 3 |
| q-curry | カレー ジャガイモ レシピ | 4, 5, 6 |
| q-review | 週次レビュー ダイジェスト | 7, 8 |
| q-resume | 冪等 バッチ 再開 | 11, 12 |

### Measurement procedure (evaluateRecallAt3)

`evaluateRecallAt3()` in `src/dashboard/recallEval.ts` measures as a pure function.

1. FTS-only side: ranks by character 1-3 gram set overlap between the query and each document (title+summary) ― the closest dependency-free approximation of the production FTS5 trigram MATCH (token-exact overlap would score 0 on unspaced Japanese)
2. Hybrid side: fuses the same FTS rank table with character-gram-vector cosine through RRF (`fuseFtsVectorRanks` in `src/dashboard/hybridRecallRank.ts`, defaults fts 0.6 / vec 0.4 / k 60)
3. Produces recall@3 and MRR per query, then averages over the 4 queries
4. Returns `hybridHolds`, the non-regression verdict that fusion never scores below FTS-only

The same corpus and queries always yield the same report (deterministic, offline, no external API call).

### Measured values (measured 2026-10-25)

| Metric | FTS-only | Hybrid |
|--------|----------|--------|
| recall@3 (mean of 4 queries) | 1.0 | 1.0 |
| MRR (mean of 4 queries) | 0.576 | 0.576 |

Per-query MRR: q-wasm 0.611 / q-curry 0.611 / q-review 0.417 / q-resume 0.667 (identical on both sides).

- On a 15-document corpus the fusion lands nearly on the FTS order, so recall@3 and MRR tie
- Non-regression (hybridHolds) holds: the hybrid never scores below the FTS baseline
- The acceptance criterion "hybrid beats FTS-only on recall for Japanese queries" is strictly unmet. That gap is recorded honestly; re-tuning the weights waits for a larger judgment corpus

### Reproduction command

```bash
npx vitest run src/dashboard/__tests__/recallEval.test.ts
```

Three tests run: corpus freeze (15 documents, 4 queries, frozen judgments), determinism (two runs return the same report), and non-regression (hybridHolds true, the hybrid never below the FTS-only recall@3 and MRR per query). The table values above come straight from the report `evaluateRecallAt3()` returns (per-query recall@3 and MRR, plus the 4 mean fields).

### Corpus change practice

Whenever the corpus changes, re-freeze the relevance judgments (relevantIds) at the same time. Adding documents without re-judging splits the comparison across different judgments. The cheapest way to add a document is one more near-miss distractor (topic words included, question unanswered) judged non-relevant ― that is what separates lexical overlap from topical relevance.
