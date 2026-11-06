# バックログ: A/B/D/E コレクション活用の配線 (2026-11-02)

3視点 x 30連のなぜなぜ (`../.superpowers/sdd/2026-11-02-abde/dig-findings.md` は gitignore 下のため内容をここに要約) を RICE 採点して PBI 化した。

## 統合結論の要約

- 検索スコープ転送は半分しか開通していない。c8522f2b は dashboard から validator までで、background の `buildSearchParams`・`ReadOnlyDeps.search` 型・wire `encodeOp/encodePayload` が tagFilter/since/until を落とす。offscreen は対応済み。残り半分 (PBI 01) が最優先の前提工事。
- v2 を読む consumer がいない。recall・ask・report は全て v1 ロック、ids は保存できるが誰も読まない。
- ask の fail-open が最危険。v2 collection 指定は scope が読めず無制限検索に縮退する。
- ids 意味論は UNION (clause 結果と ids の和集合) で定義する。定義なく consumer を増やさない。
- B/E は ids 前提で順序づける。セッション変換は ids 優先・単一のみ・ガード付き。preset は today のみ即時。

## 順位表

| 順位 | 候補 | RICE | 内訳 | 根拠・依存関係 |
|---|---|---|---|---|
| 1 | [2026-11-02-01-bg-search-scope-background.md](../dev-docs/archived/pbi/2026-11-02-01-bg-search-scope-background.md) | 1.44 | Reach=0.6 / Impact=2 / Confidence=80% / Effort=0.33人週 | c8522f2b の残り半分。プレビュー件数の正確化の前提 |
| 2 | [2026-11-02-02-feat-ask-collection-v2.md](../dev-docs/archived/pbi/2026-11-02-02-feat-ask-collection-v2.md) | 0.90 | Reach=0.5 / Impact=2 / Confidence=90% / Effort=0.5人週 | fail-open の解消。01 の scope 型を流用 |
| 3 | [2026-11-02-03-feat-history-save-handoff.md](../dev-docs/archived/pbi/2026-11-02-03-feat-history-save-handoff.md) | 0.72 | Reach=0.6 / Impact=1.5 / Confidence=80% / Effort=0.5人週 | 履歴→保存ボタンと recall 規約 pin。PBI 2026-11-01-06 の決着を含む |
| 4 | [2026-11-02-04-feat-report-v2.md](../dev-docs/archived/pbi/2026-11-02-04-feat-report-v2.md) | 0.56 | Reach=0.4 / Impact=2 / Confidence=70% / Effort=0.75人週 | UNION 意味論は本 PBI 内で定義。records 経路は対応済みのため BG 不要 |
| 5 | [2026-11-02-05-feat-session-to-collection.md](../dev-docs/archived/pbi/2026-11-02-05-feat-session-to-collection.md) | 0.42 | Reach=0.3 / Impact=2 / Confidence=70% / Effort=0.75人週 | D の ids 消費と同時リリースすること |
| 6 | [2026-11-02-06-feat-today-preset.md](../dev-docs/archived/pbi/2026-11-02-06-feat-today-preset.md) | 0.36 | Reach=0.3 / Impact=1 / Confidence=80% / Effort=0.33人週 | 依存なし。草稿注入のみ |
| 7 | [2026-11-02-07-feat-history-multi-execution.md](../dev-docs/archived/pbi/2026-11-02-07-feat-history-multi-execution.md) | 0.28 | Reach=0.2 / Impact=2 / Confidence=70% / Effort=1.0人週 | 延期可。合算 cap と一体。PBI 06 本実行の本体 |

## 依存関係

- 01 は 02・04 のプレビュー/証拠の正確化の前提ではないが、件数の正しさの前提。先行実施。
- 02 は 01 の scope 型を流用する (01 なしでも型追加はできるが二重定義を避けるため 01 先行)。
- 03 は単独実施可。06 (2026-11-01-06) の決着を含み、完了後は 06 をアーカイブする。
- 04 は UNION 意味論を本 PBI 内で定義する (別 PBI にしない)。
- 05 は 02/04 の ids 消費対応と同時リリースする (D なしの変換ボタン禁止)。
- 06 は単独実施可。
- 07 は延期可。03 の規約固定後に実施する。

## 実装順

01 → 02 → 03 → 04 → 05 → 06 → 07 (05 は 02/04 と同時リリース、07 は延期可)

## やらない項目 (掘りで否決)

- その場保存 (履歴側で命名まで完結)。custom/disjoint 範囲の保存。unread-hole preset。
- gap 値の collection 保持。単一 SQL の DNF 化。一括セッション変換。無制限 fan-out。
- 検索語彙にない条件の近似保存。
