# PBI: querySelectorAllDeep の Shadow/iframe 事前検出による再帰短絡

## ユーザーストーリー
ブラウジング中のユーザーとして、AI 要約クレンジングが有効でもページ離脱時の処理が重くならないでほしい。なぜなら `querySelectorAllDeep()` は再帰の各レベルで `root.querySelectorAll('*')` により全子孫を配列化し、その全要素をループして `shadowRoot` / `iframe` を探すため、Shadow DOM も iframe も無い大多数のページでも DOM 全要素の完全列挙 + `Array.from` をクレンジングルールのたびに繰り返すから。

## ビジネス価値
- Shadow DOM / same-origin iframe を持たないページ（大多数）で deep 走査のコストを実質ゼロにする
- AI 要約クレンジング有効時の抽出処理のメインスレッド占有を削減

## 既実装確認（Phase 0）
- `src/utils/aiSummaryCleaner/helpers.ts:146-203` `querySelectorAllDeep(root, selector)`:
  - `:154` root 直下の `querySelectorAll(selector)`
  - `:165` `root.querySelectorAll('*')` で**全子孫を列挙** → `Array.from`
  - `:174-200` その全要素をループし `el.shadowRoot`（open のみ）と `iframe.contentDocument` を再帰
- `:208` `export const collectElementsDeep = querySelectorAllDeep;`
- 呼び出し元: `grep -rn "querySelectorAllDeep\|collectElementsDeep" src/utils/aiSummaryCleaner` で確認（複数ルールが個別に呼ぶ想定）
- iframe 再帰部（`:191-194`）にはコメントだけで実処理がない箇所がある（documentElement 再帰の TODO 的記述）

## BDD受け入れシナリオ

```gherkin
Scenario: Shadow DOM も iframe も無いページでは再帰しない
  Given ページに open shadowRoot を持つ要素が 0 個、iframe が 0 個
  When querySelectorAllDeep(document.body, 'nav, footer') を呼ぶ
  Then querySelectorAll('*') による全子孫列挙は 1 回も行われない
  And 結果は document.body.querySelectorAll('nav, footer') と同一

Scenario: Shadow DOM があるページでは該当サブツリーだけ再帰する
  Given ページに open shadowRoot を持つ要素が 2 個ある
  When querySelectorAllDeep で selector 走査する
  Then その 2 個の shadowRoot 内が再帰的に走査される
  And shadowRoot を持たない他の全要素は再帰対象にならない

Scenario: 事前検出は 1 回だけ行い結果を共有する
  Given 同一ドキュメントに対してクレンジングルールが 10 個順に走る
  When 各ルールが deep 走査を要求する
  Then Shadow/iframe ホスト要素の検出（ツリー全体スキャン）は 1 回だけ実行される
```

## 受け入れ基準
- [ ] `querySelectorAllDeep` の入口で「このサブツリーに open shadowRoot を持つ要素 or iframe が存在するか」を判定し、無ければ `root.querySelectorAll(selector)` の結果だけを返して再帰処理をスキップ
- [ ] 判定は `root.querySelectorAll('*')` の 1 回スキャンで「shadowRoot あり要素」と「iframe」を収集し、それらだけを再帰対象にする（全要素ループの中で毎回分岐、ではなく収集済みリストを回す）
- [ ] クレンジングのエントリポイント（`cleanseAISummaryContent`）で、対象要素の Shadow/iframe ホスト集合を 1 回だけ計算し、各ルールへ渡す（or WeakMap キャッシュ）。ルールごとの重複スキャンを排除
- [ ] iframe 再帰部の未実装コメント（`helpers.ts:191-194`）を整理（実装するか削除するか明確化）
- [ ] Shadow DOM / iframe を含むケースの既存テスト（`aiSummaryCleaner` の shadow/iframe 系）がすべてパス
- [ ] `collectElementsDeep` エイリアスは維持

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/aiSummaryCleaner/__tests__/helpers.deep-shortcircuit.test.ts`（新規）:
  - Shadow/iframe 無し DOM: `Element.prototype.querySelectorAll` を spy し、`'*'` セレクタでの呼び出しが 0 回、結果が非 deep 版と一致
  - open shadowRoot 2 個: shadow 内の要素が結果に含まれ、他要素の再帰が起きないこと
  - same-origin iframe: iframe 内要素が拾われること（既存テスト踏襲）
  - cross-origin iframe: SecurityError で握りつぶしてスキップ（既存挙動維持）
- エントリポイントで Shadow/iframe 検出が 1 回に集約されること（検出関数を spy）

### 統合テスト
- `extractMainContent` + AI 要約クレンジング有効で、shadow-dom.html / iframe-nested.html フィクスチャの本文が従来どおり抽出されること

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c3` でベースライン取得（fixtures: news-article（shadow なし）と shadow-dom.html を S/M/L。wall-clock P50/P95、`querySelectorAll('*')` 呼び出し回数、走査ノード総数）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。shadow なしページで `querySelectorAll('*')` 回数が「ルール数 × 再帰深さ」から 0〜1 に激減。P95 が改善（目標: shadow なし L で -50% 以上）。shadow ありページは回帰なし。無関係な指標が +15% 超で悪化していないこと。

## 見積もり
1.5 pt（`helpers.ts` の 1 関数 + エントリポイントでの集約。テストは Shadow DOM 構築がやや手間）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**
- 「shadowRoot を持つ要素の検出」自体が `querySelectorAll('*')` + ループを要する。これを 1 回に抑えるのがポイント（現状はルールごと・再帰レベルごとに繰り返している）
- WeakMap キャッシュのキーは対象ルート要素。クレンジングは clone に対して行われるので、clone 単位でキャッシュが効く
- closed shadowRoot は `element.shadowRoot` が null で検出不可 → 仕様どおりスキップ（現状維持）
- 動的に後から shadowRoot が付くケースは考慮外（クレンジングは一括処理なのでスナップショットで十分）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '140,209p' src/utils/aiSummaryCleaner/helpers.ts
grep -rn "querySelectorAllDeep\|collectElementsDeep" src/utils/aiSummaryCleaner/
```

### 実装方針
1. `helpers.ts` に `findDeepHosts(root): { shadowHosts: Element[]; iframes: HTMLIFrameElement[] }` を追加（`querySelectorAll('*')` 1 回 + フィルタ）
2. `querySelectorAllDeep` を「`hosts` を引数で受け取れる」オーバーロードに。渡されなければ内部で `findDeepHosts` を 1 回呼ぶ。`hosts.shadowHosts.length === 0 && hosts.iframes.length === 0` なら `Array.from(root.querySelectorAll(selector))` を即返す
3. `cleanseAISummaryContent`（`aiSummaryCleaner/index.ts`）で clone に対し `findDeepHosts` を 1 回呼び、WeakMap or 引数で各ルールに供給
4. iframe 再帰の未実装コメントを削除 or 実装（same-origin iframe 内 shadowRoot の探索まで必要かは既存テストで判断）

### 落とし穴
- `findDeepHosts` を clone でなく live DOM に対して呼ぶと、クレンジング中の DOM 変更で不整合。必ず clone に対して
- `querySelectorAll('*')` は要素順（文書順）。再帰対象の順序が結果配列の順序に影響するテストがあれば注意
- エイリアス `collectElementsDeep` を使う箇所が新シグネチャで壊れないこと

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `npm run bench:micro -- --filter c3` の before/after を PR に添付
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（パフォーマンス改善・非機能）
