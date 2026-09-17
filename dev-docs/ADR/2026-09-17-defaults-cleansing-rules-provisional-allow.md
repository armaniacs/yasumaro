# ADR: storage/defaults.ts → aiSummaryCleaner/rules.ts の暫定許可の裁定 — 値導出のみの Layer 1→2 辺として継続

## ステータス
採用

## 日付
2026-09-17

## コンテキスト
`src/utils/storage/defaults.ts`（Layer 1）は `src/utils/aiSummaryCleaner/rules.ts`
（Layer 2 の `aiSummaryCleaner/` ディレクトリ配下）から `CLEANSING_RULES` と
`THRESHOLD_RULES` を静的に import し、`Object.fromEntries(...map(...))` で
`DEFAULT_SETTINGS` の一部（32 の per-rule 有効フラグと閾値デフォルト）を導出している
（`defaults.ts:11,19-25`）。層境界ルール `local/utils-layer-boundary` の Layer 1→Layer 2
禁止に触れるため、`eslint.config.js` の `allow` に暫定許可1件として登録されている
（PBI 2026-09-17-05。ADR 未記録のまま残っていた）。

この辺は値の導出のみであり、ロジック依存はない。`defaults.ts` が使うのは各ルール行の
`storageKey`・`newUserDefault`・`default` フィールドだけで、strip 関数等の実行時
ロジックには一切触れない。

経緯として、表の複製は実害を出したことがある。以前は同じ 32 デフォルトをここに手写し
しており、7 ルールで rule 表と乖離していた（pbi/2026-08-09-20）。現在の静的 import は
その drift の再発防止策であり、`rules.ts` 冒頭の「ルール表（単一の情報源）」方針と
一体である。

検討した代替案（いずれも今回は不採用）:
1. 純粋定数の抽出 — `CLEANSING_RULES`・`THRESHOLD_RULES` のテーブル部だけを別モジュール
   に切り出す案。`rules.ts` 自体は `stripCore.js`・`stripExtended.js`・`selectorRules.js`
   の strip 関数群を静的に import しており（`rules.ts:22-37`）、モジュール全体は正当に
   Layer 2 である。テーブルとロジックの分割は単なる移動ではなく依存設計の変更であり、
   別リファクタの予算が必要。
2. 再分類 — テーブル行だけ Layer 0/1 と見なす案。`aiSummaryCleaner/` はディレクトリ単位で
   Layer 2 に分類されており（`LAYERS.md`・`LAYER2_MODULES` の `aiSummaryCleaner/` エントリ）、
   ファイル1枚の切り出しは分類単位と矛盾する。ディレクトリ分割（テーブル層とロジック層の
   分離）とセットでなければ正当化できない。

## 決定
暫定許可を継続する。`eslint.config.js` の `allow` エントリを維持し、本 ADR を裁定記録と
する。純粋定数抽出・再分類のいずれも本 PBI のスコープでは行わない。

継続の理由。辺の実体は純粋な値導出であり、Layer 1 の実行時挙動に Layer 2 ロジックを
持ち込まない。表の複製は過去に 7 ルールの drift を実起こしており、重複排除の利益が
層の純粋性の形式的瑕疵を上回る。抽出・再分類は正当だが、依存設計の変更を伴うため
独立した PBI の予算で扱うべきである。

## 結果
- `storage/defaults.ts` → `aiSummaryCleaner/rules` の静的 import は許可のまま運用する。
  層境界ルールのテストは allowlist 経由の通過パターンとして pin 済み
  （`eslint/__tests__/utils-layer-boundary.test.ts` の allowlisted Layer 1 edge）。
- `eslint.config.js` の許可コメントは「ADR 未記録」から本 ADR 参照に更新する。
- `dev-docs/LAYERS.md` の既知の暫定許可項は本 ADR 記録済みとして更新する。
- 再検討トリガー（いずれかが満たされたら本 ADR を置換する ADR を起票する）:
  1. `rules.ts` のテーブル部がロジックから分離可能になり、純粋定数モジュールとしての
     抽出が見通せたとき（抽出先は Layer 0/1 に配置し、両者から import する形）。
  2. `aiSummaryCleaner/` の層分割（テーブル層とロジック層の分離）が計画されたとき。
  3. `defaults.ts` 以外からの Layer 2 への静的 import が増え、本許可が前例として
     援用され始めたとき（許可の前例化は層規律の浸食であり、抽出を優先する）。
- 本 ADR のためのコード変更はコメント参照の更新のみであり、挙動変更はない。

## Implements

- `eslint.config.js` (defaults.ts → aiSummaryCleaner/rules の暫定許可エントリ)
- `src/utils/storage/defaults.ts` (CLEANSING_RULES/THRESHOLD_RULES からの値導出)
- `src/utils/aiSummaryCleaner/rules.ts` (SSOT ルール表)
- `dev-docs/LAYERS.md` (既知の暫定許可項)
- `scripts/lint-layers-docs.mjs` (層リスト照合スクリプト)

## 参照
- PBI: `pbi/2026-09-17-14-refactor-layer-list-single-source.md`
- 5 Whys: `/tmp/whywhy/pbi14-layer-list-single-source.md`
- `pbi/2026-08-09-20` — 32 デフォルト手写しの 7 ルール drift incident
- `dev-docs/ADR/2026-03-20-default-settings-single-source.md` — DEFAULT_SETTINGS 単一ソース化
