# PBI: popup の未翻訳 tooltip とトークン未使用 SVG 属性の是正

## ユーザーストーリー

popup を利用するユーザーとして、履歴ボタンに hover したときの説明が現在のロケールと一致し、spinner の色が design token で決まる状態を利用したい。アイコンのみの履歴ボタンでは `aria-label` による accessible name を維持しながら、テーマ設定に従った spinner を表示できるようにする。

## ビジネス価値

- 英語圏ユーザーが、履歴ボタンの hover 説明と accessible name の言語のずれを感じなくなる。
- 全ユーザーが spinner の色について、CSS の design token と SVG のハードコードを二重に参照しない状態を利用できる。
- 既存の手動翻訳箇所を減らし、locale parity の維持を容易にする。

## 優先度

- 順位: 09 / 30
- RICEスコア: 2.0（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 英語ロケールで履歴ボタンの説明を表示する
  Given popup が en ロケールで読み込まれる
  When ユーザーが履歴ボタンに hover する
  Then 履歴ボタンの title に en ロケールの openHistory メッセージが表示される
  And  固定文字列 "Browse History" が title として残っていない
  And  履歴ボタンの aria-label が維持される

Scenario: 日本語ロケールで履歴ボタンの説明を表示する
  Given popup が ja ロケールで読み込まれる
  When ユーザーが履歴ボタンに hover する
  Then 履歴ボタンの title に ja ロケールの openHistory メッセージが表示される
  And  英語固定の title が表示されない
  And  履歴ボタンの aria-label が維持される

Scenario: spinner の色を design token に一本化する
  Given popup の spinner が表示される
  When  テーマに応じたスタイルが適用される
  Then  spinner の path は .spinner-path の design token を使う
  And  spinner circle に `stroke` 属性がハードコードされていない
```

## 受け入れ基準

- [ ] 履歴ボタンの `title` が、現在のロケールで解決した既存 `openHistory` メッセージと一致する。
- [ ] 履歴ボタンの icon-only 設計を維持し、`aria-label="Open history"` に相当する accessible name を維持する。
- [ ] `data-i18n` だけでは `title` を翻訳できないため、tooltip の文言は DOM i18n の追加対応または既存の `getMessage()` による `.title` 代入で設定する。
- [ ] 新しい専用 locale キーを追加せず、en/ja の parity を維持する。
- [ ] spinner circle の `stroke="#2E7D32"` を撤去する。
- [ ] `entrypoints/popup/styles.css:1263-1271` の `.spinner-path` が design token を使う既存定義を維持する。
- [ ] 新しい design token は追加せず、既存の design token 規約に従う。
- [ ] i18n parity / check-i18n の検査範囲外にある固定 `title` を、テストで明示的に検証する。
- [ ] `PRIVACY.md` は変更しない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- en ロケールで popup を開き、履歴ボタンに hover して、既存 `openHistory` メッセージが `title` に表示されることを確認する。
- ja ロケールで popup を開き、履歴ボタンに hover して、既存 `openHistory` メッセージが `title` に表示されることを確認する。
- 両ロケールで `aria-label` が維持されていることを確認する。
- spinner 表示時に `stroke` のハードコードがなく、既存の `.spinner-path` スタイルが適用されることを確認する。

### 統合テスト

- `src/popup/__tests__/ui-ux-improvements.test.ts:19-23,77-106` を起点に、popup の初期化と履歴ボタンの `title` 設定を検証する。
- `src/utils/__tests__/i18n.test.ts:77-126` の既存の data-i18n、placeholder、aria-label の pin を崩さないことを確認する。
- `scripts/__tests__/localeParity.test.ts:19-43` と `scripts/release-checks/i18n-core.mjs:154-193` で en/ja parity と i18n 検査が維持されることを確認する。
- 汎用 `data-i18n-title` seam を採用する場合は、DOM i18n の属性処理に `title` のテストを追加する。既存 TS `.title` 方式を採る場合は、汎用 seam のテストを追加しない。

### 単体テスト

- popup の DOM テストで spinner circle の `stroke="#2E7D32"` がなく、`title="Browse History"` が固定されていないことを検証する。
- 翻訳方式を採用した実装の分岐について、履歴ボタンの `title` が `getMessage("openHistory")` の結果へ更新されることを検証する。
- en/ja の既存 `openHistory` メッセージだけを使い、新しい専用キーを追加しないことを確認する。

## 実装アプローチ

- **Outside-In**: E2Eシナリオが失敗することを先に確認し、popup のローカライズと spinner スタイルを段階的に検証する。
- **Red-Green-Refactor**: 失敗するテストを追加してから最小実装を入れ、green にした後に不要な raw 属性や重複定義を除去する。
- **tooltip**: `data-i18n` に `title` の上書きを期待せず、既存の `getMessage()` と `element.title` のパターンを利用する。
- **spinner**: SVG circle の `stroke` 属性を削除し、CSS の既存 `.spinner-path` と design token を唯一の色の定義として残す。
- **locale**: 既存 `openHistory` キーを再利用し、`public/_locales` を変更しない。

## 見積もり

- 0.5 SP

推奨する既存 TS `.title` 方式を想定した見積もりです。汎用 `data-i18n-title` seam を採用する場合は、見積もりを見積もり直します。

## 技術的考慮事項

- 依存関係はない。専用キーを追加せず `openHistory` を再利用するため、`_locales` の変更は不要です。
- `src/utils/i18n-dom.ts:71-126` は text、input placeholder、ARIA label を処理しますが、button の `title` は処理しません。`data-i18n` の既存挙動だけに依存する実装は不十分です。
- `entrypoints/popup/main.ts:15-19` の `applyI18n()` 呼び出しは 1 箇所です。tooltip の設定位置をここで統一するか、選択した方式に応じて既存テスト可能な関数へ閉じ込める必要があります。
- `aria-label` は icon-only ボタンに必要な accessible name であり、tooltip の翻訳方式変更によって削除・変更してはいけません。
- `.spinner-path` は CSS で `stroke` を上書きするため、SVG の `stroke="#2E7D32"` は実行時の色には影響しない一方、design token とハードコードの二重定義を残します。
- 新規 design token は追加しません。既存の `--ym-*` 規約と `.spinner-path` の既存定義を利用します。
- i18n parity / check-i18n は data 属性を検査するため、raw HTML の `title` を検出できません。runtime の `title` を明示的にアサートするテストが必要です。
- `PRIVACY.md` は変更しません。

## 実装者向け注記

### 現状コードの確認

- `entrypoints/popup/index.html:35-40` の履歴ボタンには `title="Browse History"` があり、`applyI18n()` の翻訳対象外です。
- `entrypoints/popup/index.html:184-189` の spinner SVG circle には `stroke="#2E7D32"` があります。
- `entrypoints/popup/styles.css:1263-1271` の `.spinner-path` は既に design token を使用しています。
- `entrypoints/popup/main.ts:15-19` で popup の `applyI18n()` が呼び出されます。
- `openHistory` は `public/_locales/en/messages.json:4436-4438` と `public/_locales/ja/messages.json:4418-4420` にあります。
- `src/popup/previewView.ts:181-185` に `element.title = getMessage(...)` を使う既存パターンがあります。
- `src/utils/__tests__/i18n.test.ts:77-126` は data-i18n、placeholder、aria-label を検証していますが、title 属性は未対応です。
- 着手時に、tooltip の採用方式と 0.5 SP の範囲が整合していることを確認する。

### 実装手順

1. `ui-ux-improvements` の既存テストを起点に、履歴ボタンの `title` がロケールに対応することと spinner の `stroke` ハードコードがないことを追加する。
2. 推奨案として、既存の `getMessage()` と `.title` のパターンで履歴ボタンに `openHistory` の解決済み文言を設定する。
3. `entrypoints/popup/index.html` の `title="Browse History"` 固定値を撤去し、`aria-label` は維持する。
4. spinner circle の `stroke="#2E7D32"` を撤去し、CSS の `.spinner-path` 定義は変更せずに残す。
5. en/ja の既存 `openHistory` と、既存の i18n、locale parity、release check のテストを確認する。
6. 汎用 `data-i18n-title` seam や専用キーを採用する場合は、テスト範囲と 0.5 SP の見積もりを更新する。

### 落とし穴

- `data-i18n` のテストが通っても、button の `title` は翻訳されない。runtime の `title` 値を直接検証する。
- icon-only のボタンから `aria-label` を削除すると accessible name を失う。
- spinner の表示色だけを確認すると、CSS に上書きされる古い `stroke` 属性が残ったまま検出できない。
- 汎用 seam を追加すると、既存 `i18n-dom` の処理範囲とテスト範囲が広がる。0.5 SP の最小修正とは分けて評価する。
- 新しい専用キーを追加すると、今回不要となる locale parity の変更範囲が広がる。

## 決定事項

- tooltip の方式は、既存 TS の `element.title = getMessage("openHistory")` を推奨する。
- 新しい専用キー追加と汎用 `data-i18n-title` seam 新設は代替案とする。汎用 seam を採る場合は、PBI の直接的な実装範囲と 0.5 SP の見積もりを見直す。
- spinner は raw `stroke` 属性を撤去し、既存の `.spinner-path` design token 定義を維持する。
- 専用 locale キーと `PRIVACY.md` は変更しない。

## Definition of Done

- [ ] 履歴ボタンの `title` が en/ja の既存 `openHistory` メッセージで更新される。
- [ ] 履歴ボタンの `aria-label` が維持される。
- [ ] `title="Browse History"` と `stroke="#2E7D32"` の raw 属性が残っていない。
- [ ] spinner の色が既存 `.spinner-path` design token 定義だけで決まる。
- [ ] en/ja parity と既存の i18n 検査に影響されないしない。
- [ ] BDD シナリオに対応する自動テストが存在し、成功する。
- [ ] 専用 locale キーおよび `PRIVACY.md` を変更していない。
- [ ] 採用した tooltip 方式と 0.5 SP のスコープが整合している。
