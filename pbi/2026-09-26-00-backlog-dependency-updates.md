# 依存更新ラウンド（2026-09-26）— 未反映 3 件の PBI 化と優先度付け

## 経緯

2026-09-26 の依存棚卸し（`docs/DEPENDINGS.md`）で `npm outdated` 12 件を検出。範囲内の minor / patch 9 件は同日中に lockfile へ反映済み（`npm run validate` と `npm run release:check:deps` が PASS）。残り 3 件（範囲外メジャー 2 件 + テスト基盤破壊 1 件）を本ラウンドで PBI 化した。

## 採点結果（RICE・同一基準・同一前提）

| 順位 | 候補 | Reach | Impact | Confidence | Effort(SP) | RICE | 種別 |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | `@types/chrome` 0.2.9 → 0.3.0 更新 | 2 | 0.5 | 1.0 | 0.25 | **4.0** | fix |
| 2 | `jsdom` 30.0.1 → 30.1.1 + セレクタ長対策 | 2 | 1.0 | 0.8 | 1 | **1.6** | fix |
| 3 | `typescript` 6.0.3 → 7.0.2 移行準備 | 2 | 1.0 | 0.8 | 2 | **0.8** | backlog（監視） |

- Reach は 3 候補とも同一前提（CI 実行・ローカル開発環境・リリースゲートのすべてが対象で月次相当は等しい）。相対比較が主眼のため絶対値より一貫性を優先
- 依存関係: 3 候補間の依存なし。`typescript` のみ外部トリガー依存（typescript-eslint の peer 更新待ち）

## PBI 一覧

| NN | PBI | 順位 | 状態 |
|---|---|---|---|
| 10 | [fix-update-chrome-types](2026-09-26-10-fix-update-chrome-types.md) | 1 | ⬜ 未着手（即実施可能） |
| 11 | [fix-jsdom-selector-length-limit](2026-09-26-11-fix-jsdom-selector-length-limit.md) | 2 | ⬜ 未着手 |
| 12 | [backlog-typescript-7-adoption](2026-09-26-12-backlog-typescript-7-adoption.md) | 3 | 🔵 監視中（トリガー待ち） |

## 実測で確認した技術的事実（2026-09-26）

### `@types/chrome` 0.3.0 — ドロップイン互換を実証

0.3.0 を仮適用した状態で `npm run type-check`（本体）がエラー 0 件、`npm run type-check:test` の型エラー発生箇所リストが 0.2.9 時点と完全一致。メジャー更新だが実質的な影響はゼロ。

### `jsdom` 30.1.1 — 根因と回避不能性を特定

- 30.1.1 が同梱する `@asamuzakjp/dom-selector` 9.x がセレクタ長上限 `MAX_LENGTH = 2048` を導入
- 超過セレクタは `buildClassIdSelectors` が生成する結合セレクタのうち `deep`（4191 文字）と `jpLayout`（4714 文字）。他は 1013〜1464 文字で余裕がない
- jsdom は `Document-impl.js` で `new DOMSelector(globalObject, document, { idlUtils })` と構築し、dom-selector の `maxLength` オプションを渡せない → リポジトリ側での対応が必須
- 上限は dom-selector 固有で、Chrome 本体の `querySelectorAll` には存在しない（拡張機能の実行時挙動には無関係）
- 仮適用時の失敗: 15 ファイル 86 テスト（aiSummaryCleaner 系が中心）。30.0.1 へ戻すと全 PASS

### `typescript` 7.0.2 — 上流ブロッカーを発見

- `@typescript-eslint/eslint-plugin@8.70.1`（npm latest）の peer 範囲は `typescript >=4.8.4 <6.1.0`
- TS 7.0.2 を入れた状態で他パッケージの `npm install` を実行すると ERESOLVE で失敗（実測）。現状の適用はツールチェーン全体を不動化する
- TS 7 単体の品質は良好: 本体 `type-check` 0 エラー、test 型チェックはエラー発生箇所数が TS 6.0.3 と同一（既存 278 件は先行ドリフト。TS 7 による差分はメッセージ表記のみ）

## なぜなぜ分析の要約

- 「TypeScript 7 はなぜ今入れられないのか」→ 原因は typescript-eslint が未対応だから（peer 制約で npm install が失敗）。示唆: コストの問題ではなく時期の問題であり、待つしかない。解: トリガー付き監視 PBI として起票し、移行手順を先行整備する
- 「jsdom の対応はなぜセレクタ短縮ではなくチャンク分割なのか」→ 原因は patterns 配列が今後も伸びる（ドメイン対応・新規ルール追加）ため、発生源での短縮は再発する。示唆: 上限は dom-selector 固有でブラウザに影響せず、分割は意味論（union）を変えない。解: `stripBySelectors` の `collect()` 一点でのチャンク分割を SSOT にする
- 「`@types/chrome` はなぜメジャー更新なのに最優先なのか」→ 原因は工数ではなく実測の信頼度がスコアを左右するから。示唆: 「メジャー=危険」の先入観より実測での順序決定が正しい。解: 検証済み 0.25 SP として即実施可能な fix PBI にする

## 反映済み分の記録

範囲内の 9 件（`@types/node`, `@typescript-eslint/*`, `@vitest/coverage-v8`, `eslint`, `happy-dom`, `knip`, `vite`, `vitest`）は 2026-09-26 に反映済みで PBI 不要。詳細は `docs/DEPENDINGS.md`「依存の実質的な更新」を参照。
