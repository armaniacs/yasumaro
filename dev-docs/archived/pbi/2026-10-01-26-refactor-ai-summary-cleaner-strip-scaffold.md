# PBI: aiSummaryCleaner の非 selector strip 足場抽出

優先度: 19 / RICE 4.8
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「ハンドラ足場のコピー群」）
依存: なし（他 PBI とファイル重複なし）

## ユーザーストーリー

本文の抽出精度を調整する開発者として、selector 以外の strip 関数の共通骨格を 1 つにまとめてほしい、なぜなら 8 つの strip 関数が同じ「候補収集 → 重複除去 → safe 削除 → 件数カウント」のループを手書きしており、除去件数の数え方や本文保護の入れ方ひとつ直すたびに 8 箇所の修正が必要になるから。selector .rows は既に 1 エンジンへ統合済みだが、その統合（PBI 06）が対象外にした非 selector 側だけが残っている。

## 背景（現状）

同一骨格（`let removedCount = 0` / `const elementsToRemove: Element[] = []` / `const counted = new Set<Element>()` / `for (const elem of elementsToRemove) { if (safeRemoveElement(elem)) removedCount++; }` / `return removedCount;`）が 8 箇所にある。

- `src/utils/aiSummaryCleaner/stripCore.ts:42-73`（`stripLegalTextNodes`）
- `src/utils/aiSummaryCleaner/stripCore.ts:80-112`（`stripHighLinkDensityElements`、リンク密度計算は `:96-100`）
- `src/utils/aiSummaryCleaner/stripExtended.ts:59-111`（`stripFixedElements`、6 つの query ブロック各々に dedupe ガード）
- `src/utils/aiSummaryCleaner/stripExtended.ts:133-161`（`stripTextDensityElements`、リンク密度計算 `:146-151` は `stripCore.ts:96-100` と重複）
- `src/utils/aiSummaryCleaner/stripExtended.ts:170-210`（`stripShortSequenceElements`）
- `src/utils/aiSummaryCleaner/stripExtended.ts:217-237`（`stripSymbolLineElements`）
- `src/utils/aiSummaryCleaner/stripExtended.ts:245-307`（`stripLinkOnlyParagraphs`）
- `src/utils/aiSummaryCleaner/stripExtended.ts:316-361`（`stripAffiliateElements`）
-  selector 形の strip のみ `src/utils/aiSummaryCleaner/selectorRules.ts:172-209`（`stripBySelectors`）でエンジン化済み

## BDD シナリオ

```gherkin
Scenario: 除去件数が全 strip で同じ定義になる
  Given safe 削除が失敗する要素と成功する要素が混在する候補集合
  When 各 strip 関数を実行する
  Then 返却される件数は 8 関数すべてで同一の定義になる

Scenario: リンク密度の判定が 1 実装になる
  Given 同じ要素集合に対してリンク密度を測る 2 つの経路がある
  When 両経路の判定結果を比較する
  Then 判定結果が両経路で同一である
```

## 実装宣言

- 挙動維持: 抽出結果・除去件数・順序は不変（ADR-017 の parity を維持）
- 候補生成（クエリや条件の判定）は各 strip に残し、「重複除去 → safe 削除 → 件数」の後処理だけを共通化する
- リンク密度計算は 1 つの純関数に集約し、候補タグと最小文字数の差分だけを引数で受ける

## 受け入れ基準

- [x] 8 つの非 selector strip が共通の後処理骨格を通る
- [x] リンク密度の計算が 1 実装になる
- [x] 各 strip の抽出結果が現状と同一（既存 parity テストが変更なしで green）
- [x] selector 経路（`stripBySelectors`）の挙動不変

## テスト戦略

- 既存の parity・エンコード回数・fallback 境界テストが変更なしで green であること
- 共通骨格の単体テスト: 削除失敗が混ざった候補集合で件数が 1 の定義になること
- 検証: `npm run type-check` と `src/utils/aiSummaryCleaner/__tests__/` の vitest

## 実装内容

1. 共通後処理（重複除去 → safe 削除 → 件数）の抽出
2. リンク密度計算の純関数化と 2 経路の置換
3. 8 つの strip 関数を共通骨格へ寄せる

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02）

### 変更内容

- 共通後処理の尾部（重複除去済み集合に対する safe 削除と件数カウント）を `selectorRules.ts` に `removeCollected(collected, apply?)` として置いた。同ファイルは既に「共有 strip エンジン」と名乗っているモジュールなので、新しい import 辺を発生させずに済む
- `selectorRules.ts` から `stripCollected(root, groups, apply?)` を追加。selector 行は `stripBySelectors` 経由でこの共通コレクタを通るため、selector 経路と非 selector 経路が同じ `claimed Set` と同じ尾部を使う
- `helpers.ts` に純関数 `isLinkDenseBlock(elem, minTextLength, ratioThreshold)` を新設し、`stripCore.ts` の `stripHighLinkDensityElements` と `stripExtended.ts` の `stripTextDensityElements` の重複計算を 1 実装へ集約
- `stripCore.ts` / `stripExtended.ts` の非 selector strip を共通骨格へ寄せた

### 追加テスト

- 新規 `src/utils/aiSummaryCleaner/__tests__/stripScaffold.test.ts`: 削除失敗が混ざった候補集合で件数が 1 つの定義になること、`stripCollected` の「集合全体収集してから削除」順序（祖先と子孫が別グループで一致しても両方が数えられる）、`isLinkDenseBlock` の境界

### 逸脱

- 新規 import 辺は 0 追加、新規ファイルは `stripScaffold.test.ts` のみ
- **依頼書は `stripFixedElements` の query ブロックを 6 と記載していたが実際は 5**（fixed / sticky / fixed-player / yahoo-news / game8）。5 ブロックすべてが単一の `claimed Set` を共有するようになった
- 依頼書に名前のない 9 つ目の重複 `stripCookieConsentElements` も同じ尾部へ寄せ、その 12 行の twin `collectCookieConsentElements` を等価であるとして削除した
- `selectorRules.ts` の doc comment が削除済み関数を参照していたため修正

### 検証

`npx tsc --noEmit` / `npm run lint`（error 0）/ `npm test`（999 files, 15367 tests passed）/ `npm run validate` すべて green。既存 parity・エンコード回数・fallback 境界テストは変更なしで green。
