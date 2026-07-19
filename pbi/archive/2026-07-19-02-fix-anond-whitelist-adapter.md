# PBI: anond.hatelabo.jp（はてな匿名ダイアリー）専用ホワイトリスト抽出アダプタの追加

## ユーザーストーリー
Yasumaro拡張機能ではてな匿名ダイアリー（anond.hatelabo.jp）を閲覧するユーザーとして、記事本文（増田自身の投稿）だけを対象にしたAI要約がほしい、なぜなら現状は「記事への反応」「人気/注目エントリ」「広告枠」などの本文と無関係なノイズが本文候補として混入し、全く関係ない内容（例:「Amazonのセール情報と印鑑の必要性について」）が要約結果として保存されてしまい、記録の価値がないから。

## ビジネス価値
- はてな匿名ダイアリーの閲覧記録が正しい要約とともにObsidianに保存されるようになり、後から検索・参照する際の実用性が回復する
- 誤った要約によるノイズがVaultに蓄積するのを防ぐ

## 背景・原因（実機HTML調査で確認済み）

`https://anond.hatelabo.jp/20260718145925` と `https://anond.hatelabo.jp/20260718204039` を実際にcurlしてHTML構造を確認した。

- 本文: `.day .body div.section` 内の `<p>` / `<ul><li>` 等（`.sectionfooter`, `.share-button`, `.ad-in-entry-block` 等を除く）
- ノイズ要素（本文より遥かに長文になりがち）:
  - `.refererlist`（「記事への反応」= トラックバック/コメント一覧。ネストした `<ul><li>` で無限にネストしうる）
  - `#bookmark-comment-unit`（はてなブックマークコメント欄。JS動的読込だが要素自体はDOMに存在）
  - `.hotentries-wrapper`（「人気エントリ」「注目エントリ」= 他記事へのリンク集）
  - `.double-rectangle`, `.ad-in-entry-block`, `#logly-lift-*`（広告枠）
- 増田の投稿は1〜数文と極端に短いことが多く、本文以外のテキスト量が本文を容易に圧倒する。これが現在Readabilityベースの汎用抽出で本文ノイズが混入する直接原因。

既存実装確認: `grep -rn "anond" src/` はヒットなし。`src/utils/contentExtractor/whitelistAdapters.ts` の `WHITELIST_ADAPTERS`（Togetter, Wikipedia, CNN, Qiita, Zenn等13件）にも `anond.hatelabo.jp` は含まれておらず、未実装であることを確認済み。`b.hatena.ne.jp`（はてなブックマーク）は別ドメインの既存アダプタでありスコープ外。

## スコープ外
- Readabilityアルゴリズム自体の汎用改善（ドメイン別ホワイトリスト方式で対応する方針をユーザーが明示的に選択）
- 本文が極端に短い場合のAI要約品質チューニング（本文抽出さえ正確なら短い記事はそのまま短く要約されればよい、とユーザーが許容）
- はてなブックマーク（b.hatena.ne.jp）アダプタの変更（既に実装済み・対象外）

## BDD受け入れシナリオ

```gherkin
Scenario: 増田の記事ページで本文のみが抽出される
  Given ユーザーが anond.hatelabo.jp の記事ページ（div.sectionに本文を含む）を開いている
  And ページには .refererlist（記事への反応）、.hotentries-wrapper（人気/注目エントリ）、広告枠が含まれている
  When コンテンツ抽出処理が実行される
  Then 抽出結果には div.section 内の本文テキストが含まれる
  And 抽出結果には .refererlist 内のコメント・トラックバックのテキストが含まれない
  And 抽出結果には .hotentries-wrapper 内の他記事タイトルが含まれない
  And 抽出結果には .sectionfooter（Permalink/反応数/投稿時刻）や .share-button のテキストが含まれない

Scenario: 本文が1〜2文と極端に短い増田記事でも本文のみが抽出される
  Given ユーザーが本文が1文のみの anond.hatelabo.jp 記事ページを開いている
  And 同ページには本文より長い .refererlist のコメント群が存在する
  When コンテンツ抽出処理が実行される
  Then 抽出結果は本文の1文のみで構成される
  And 抽出結果は空文字列にならない
```

## 受け入れ基準
- [x] `WHITELIST_ADAPTERS` に `anond.hatelabo.jp` 用のエントリが追加されている（`domains: ['anond.hatelabo.jp']`）
- [x] `contentSelectors` は本文を囲む `div.section` を指し、`excludeSelectors` で `.sectionfooter`, `.share-button`, `.ad-in-entry-block` を除外する
- [x] `.refererlist`, `#bookmark-comment-unit`, `.hotentries-wrapper`, `.double-rectangle` はいずれも `contentSelectors` の対象外であり、抽出結果に混入しない
- [x] 既存の13アダプタの挙動・既存テストに影響を与えない（回帰なし）
- [x] 実際のサンプルHTML（`https://anond.hatelabo.jp/20260718145925` 相当の構造）に対するテストで、本文のみが抽出されることを確認する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Chrome拡張のE2Eは本PBIのスコープでは重すぎるため見送り。手動確認で代替）
- 手動確認手順を「実装者向け注記」に記載

### 統合テスト
- `extractMainContent`（`src/utils/contentExtractor/index.ts`）を通しで呼び、`whitelistExtractionEnabled: true` の設定下で anond.hatelabo.jp 相当のDOMから正しい本文だけが返ることを確認するテストを1件追加（既存の `contentExtractor/__tests__/index.test.ts` にある他アダプタの統合テストと同じ形式）

### 単体テスト
`src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` に以下を追加:
- `WHITELIST_ADAPTERS` の件数が14件に増えたことの確認（既存の「defines exactly 13 adapters」テストを更新）
- `anond` アダプタが `domains` に `anond.hatelabo.jp` を含むことの確認
- `matchWhitelistAdapter('anond.hatelabo.jp', ...)` が `anond` アダプタを返すことの確認
- `extractWhitelistedContent` で以下を検証する境界値テスト:
  - 本文（`div.section` 内の `<p>`）が抽出結果に含まれる
  - `.refererlist` 内のコメントテキストが抽出結果に含まれない
  - `.hotentries-wrapper` 内の他記事タイトルが抽出結果に含まれない
  - `.sectionfooter`（Permalink | 記事への反応(N) | 時刻）が抽出結果に含まれない
  - `.share-button`（ツイート/シェアボタンのラベル文言）が抽出結果に含まれない
  - 本文が1文のみの短い記事でも、本文が空文字列にならず正しく抽出される

## 実装アプローチ
- **Outside-In**: まず `whitelistAdapters.test.ts` に新規テストケース（失敗する状態）を追加 → `WHITELIST_ADAPTERS` にアダプタ定義を追加してグリーンにする → 統合テストを追加してグリーンを確認
- **Red-Green-Refactor**: 各テスト追加のたびに Red → Green を確認してから次へ進む
- 新規ロジック（`matchWhitelistAdapter` / `extractWhitelistedContent`）の追加は不要。既存関数はドメイン非依存の汎用実装のため、`WHITELIST_ADAPTERS` 配列にエントリを1件追加するのみで完結する

## 見積もり
1pt（🟢低）— 既存パターンへのデータ追加+テストのみ。新規ロジック実装なし。

## 技術的考慮事項
- 依存関係: なし。既存の `WhitelistAdapter` インターフェース・`matchWhitelistAdapter`・`extractWhitelistedContent` をそのまま利用
- テスタビリティ: jsdom + `document.body.innerHTML` によるDOM構造の直接構築で完結。ネットワークアクセス不要
- 非機能要件: なし（既存の抽出パイプラインの設定データ拡張のみ）

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行すること）
```bash
grep -rn "anond" src/
grep -n "domains:" src/utils/contentExtractor/whitelistAdapters.ts
```
上記はいずれも本PBI作成時点で「anond関連の実装なし」「既存13アダプタにanond.hatelabo.jpなし」を確認済み。再着手時に状況が変わっていないか再確認すること。

### 実装手順
1. `src/utils/contentExtractor/whitelistAdapters.ts` の `WHITELIST_ADAPTERS` 配列に以下を追加する:

```typescript
{
    name: 'anond',
    domains: ['anond.hatelabo.jp'],
    detectSelector: 'div.section',
    contentSelectors: ['div.section'],
    excludeSelectors: ['.sectionfooter', '.share-button', '.ad-in-entry-block'],
    metadataPatterns: [],
},
```

2. `metadataPatterns: []` を明示し、デフォルトの `@username`/`RT(数字)` 除去パターンが増田の本文（`@`を含む言及等は通常ないが、念のため既存のQiita/Zenn等と同様の扱いに合わせる）に誤爆しないようにする

3. `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` に以下のテストを追加（既存の `cnn-jp`・`qiita` のexcludeSelectorsテストを参考にする）:

```typescript
it('defines exactly 14 adapters', () => {
  expect(WHITELIST_ADAPTERS).toHaveLength(14); // 13 → 14 に更新
});

it('includes the anond adapter with correct domain', () => {
  const anond = WHITELIST_ADAPTERS.find(a => a.name === 'anond');
  expect(anond).toBeDefined();
  expect(anond?.domains).toContain('anond.hatelabo.jp');
});
```

```typescript
it('matches anond by exact hostname', () => {
  const adapter = matchWhitelistAdapter('anond.hatelabo.jp', document.body);
  expect(adapter?.name).toBe('anond');
});
```

```typescript
it('extracts anond article body and excludes reactions/hotentries/ads/footer', () => {
  document.body.innerHTML = `
    <div class="day"><div class="body">
      <div class="section">
        <p>百合系の作品が中高年のオタクにヒットしてるのって、自分がまだ若い頃なら主人公の男に感情移入できたけど、中高年になると感情移入できなくなったからだと思う。</p>
        <p class="sectionfooter">Permalink | 記事への反応(12) | 14:59</p>
        <p class="share-button">ツイート シェア</p>
        <div class="ad-in-entry-block" id="rectangle-middle"></div>
      </div>
    </div></div>
    <div class="refererlist">
      <ul><li><div class="box-curve"><p>感情よりケツに移入しろ</p></div></li></ul>
    </div>
    <div class="hotentries-wrapper">
      <h2 class="title">人気エントリ</h2>
      <ul><li><a href="/x">別の記事タイトル</a></li></ul>
    </div>`;
  const anond = WHITELIST_ADAPTERS.find(a => a.name === 'anond')!;
  const result = extractWhitelistedContent(document.body, anond);
  expect(result).toContain('百合系の作品が中高年のオタクにヒットしてるのって');
  expect(result).not.toContain('感情よりケツに移入しろ');
  expect(result).not.toContain('別の記事タイトル');
  expect(result).not.toContain('Permalink');
  expect(result).not.toContain('ツイート');
  document.body.innerHTML = '';
});

it('extracts short single-sentence anond post without dropping to empty', () => {
  document.body.innerHTML = `
    <div class="section">
      <p>日本三大ガキといえば、メスガキ、生牡蠣、あとひとつは？</p>
      <p class="sectionfooter">Permalink | 記事への反応(16) | 20:40</p>
    </div>
    <div class="refererlist">
      <ul><li><div class="box-curve"><p>長いコメントがここに何個も続く想定のテキストです。本文よりずっと長い。</p></div></li></ul>
    </div>`;
  const anond = WHITELIST_ADAPTERS.find(a => a.name === 'anond')!;
  const result = extractWhitelistedContent(document.body, anond);
  expect(result).toContain('日本三大ガキといえば');
  expect(result).not.toContain('長いコメントがここに何個も続く');
  document.body.innerHTML = '';
});
```

4. `src/utils/contentExtractor/__tests__/index.test.ts` に、`whitelistExtractionEnabled: true` 設定下で anond.hatelabo.jp のURL/DOMを渡した統合テストを1件追加する（既存の他アダプタ統合テストの形式に倣う）

5. 実装後、`npm test` と `npm run type-check` を実行してグリーンを確認する

### 落とし穴
- `detectSelector: 'div.section'` はクラス名ベースのセレクタなので `matchWhitelistAdapter` のDOM構造フォールバック判定（`/[.#\[]/.test(adapter.detectSelector)` の分岐）でも問題なく機能するが、`domains` が一致する場合は常にドメイン一致が優先されるため、実運用上はDOM構造判定に頼らずドメイン一致で発火する
- `.refererlist` 内のネストしたコメントには増田の本文と紛らわしい文体のテキストが含まれることがあるが、`contentSelectors` に `div.section` のみを指定していれば `.refererlist` はDOMツリー上の兄弟要素であり自動的に除外される（`div.section` のクローン内を辿らないため誤って含まれることはない）
- `excludeSelectors` はクローンした要素の**内部**からのみ除外する仕組み（`extractWhitelistedContent` 実装参照）。`.refererlist` や `.hotentries-wrapper` は `div.section` の**外**にあるため、そもそも `excludeSelectors` に含める必要はない
- 手動確認: `npm run build` 後、実際に `https://anond.hatelabo.jp/` の適当な記事ページを開き、ポップアップの「今すぐ記録」またはダッシュボードの履歴で、記事本文相当のテキストのみがAI要約対象として送信されていることを確認する（送信データはダッシュボード履歴の「AIへ送信したデータ」ボタンで確認可能）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `whitelistAdapters.test.ts` の新規テストが全てパスする
- [x] `index.test.ts` の統合テストがパスする
- [x] 既存テストに回帰がない（`npm test` 全体グリーン: 14271件パス）
- [x] `npm run type-check` がパスする
- [x] コードレビュー完了
- [x] 手動確認（実際のanond.hatelabo.jpページでの送信データ確認）完了

## 実装完了メモ
- 実装日: 2026-07-19
- `src/utils/contentExtractor/whitelistAdapters.ts` に `anond` アダプタ追加（既存パターンへのデータ追加のみ、新規ロジックなし）
- `npm test`: 739 test files / 14271 tests 全パス（回帰なし）
- `npm run type-check`: エラーなし
- `npm run build`: 成功
- ユーザーによる実機での手動確認完了（Chrome拡張として読み込み、実際のanond.hatelabo.jpページで送信データを確認）
