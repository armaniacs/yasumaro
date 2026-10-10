# 2026-10-11 code-review 指摘の PBI 化台帳（review-followup）

`/code-review`（対象: 直近3コミット = NN08 実装 `93afd02e`＋前後 docs 2件）の Suggestions 5 件を全件 PBI 化する。RICE 採点は本台帳の「RICE スコアリング」節に集約し、個別 PBI には順位・スコア・根拠のみを持つ。

- 出所: code-review レビュー（2026-10-11）
- 候補とレビュー番号の対応: #1 init 並列化 / #2 キー契約テスト / #3 キャスト除去 / #4 strip 完全除去 / #5 非 export 化
- ファイル番号は同日 checking-team 番号（01–10）との衝突回避のため NN11–15 を使用する。NN 昇順＝優先降順。

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 保守作業での関与頻度（相対 1-10、archloop-1010 台帳と同一基準）
Impact: 3=圧倒的 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| 優先順位 | NN | PBI | 種別 | R | I | C | E | RICE | SP |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 11 | [2026-10-11-11-test-e2e-probe-key-contract.md](2026-10-11-11-test-e2e-probe-key-contract.md) | test | 4 | 1 | 1.0 | 0.25 | 16.0 | 0.25 |
| 2 | 12 | [2026-10-11-12-refactor-kernel-init-parallel.md](2026-10-11-12-refactor-kernel-init-parallel.md) | refactor | 6 | 0.5 | 0.8 | 0.5 | 4.8 | 0.5 |
| 3 | 13 | [2026-10-11-13-refactor-e2e-probe-wait-narrowing.md](2026-10-11-13-refactor-e2e-probe-wait-narrowing.md) | refactor | 2 | 0.5 | 1.0 | 0.25 | 4.0 | 0.25 |
| 4 | 14 | [2026-10-11-14-chore-e2e-probe-strip-complete.md](2026-10-11-14-chore-e2e-probe-strip-complete.md) | chore | 3 | 0.5 | 0.8 | 0.5 | 2.4 | 0.5 |
| 5 | 15 | [2026-10-11-15-refactor-probe-flag-unexport.md](2026-10-11-15-refactor-probe-flag-unexport.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | 2.0 | 0.25 |

根拠（相対比較）:

- **NN11 が突出（16.0）**: キー文字列不一致は「E2E 全滅」という静かな故障に直結し（Impact 1）、テスト1件・0.25 SP で恒久検出できる。効果が確定（C 1.0）で最も安い。
- **NN12（4.8）**: 全 content-script 初期化に効く（Reach 6）が、削減は session 1 読み分（sub-ms、Impact 0.5）。並列化の安全性に設計判断が残る（C 0.8）。
- **NN13（4.0）**: 触る範囲が1ヘルパー（Reach 2）だが型安全性の小改善が確定（C 1.0）で安い（0.25）。
- **NN14（2.4）**: 出荷物のバイト衛生（Impact 0.5）。dead-code 除去の完全性確認に一手間（C 0.8）。
- **NN15（2.0）**: 公開 API 面の微縮小（Impact 0.25）。効果は小さいが確定・安価。

## 依存・実行順

- ハードな依存関係はない。RICE 順（NN11 → NN15）を推奨する。
- 同一ファイルに触るのは NN12 と NN14（`src/content/contentKernel.ts`、別ハンク）、NN14 と NN15（`src/content/e2eTestState.ts`、別行）のみ。実装時は NN12 → NN14 → NN15 の順で直列に当て、NN11・NN13 は並列可。
- 推奨バッチ: W1（NN11 / NN12 / NN13 並列）→ W2（NN14）→ W3（NN15）。

## 5 Whys サマリー（代表1件のみ・他は自明のため省略）

- **なぜキー重複が残ったのか** → E2E 側ヘルパーを testDir に新設する際、src の定数を import せず文字列を転記したから。なぜ import しなかったか → content モジュールの chrome 依存を Playwright 側に引き込む懸念があったから（未検証の仮定）。解: NN11（転記をやめられないか1回検証し、無理なら等価 pin テストで drift を検出する）。
