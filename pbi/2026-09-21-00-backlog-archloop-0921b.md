# バックログ: arch-delivery-loop 0921b (2026-09-21・差分ラウンド)

ラウンド2（archloop-0921・9 PBI）完了直後の差分診断。対象: 前ラウンドの新コード（17-25）+ PBI-18 が宣言した follow-up + R4 トリガー（privacy step 改修・発火済み）の再評価。5候補を RICE 採点して PBI 化（NN 26-30）。台帳送りは新規ゼロ（P3/P4 はトリガー不発のまま据え置き）。HTML レポート: `$TMPDIR/architecture-review-0921b.html`。

## 採点

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-09-21-26](2026-09-21-26-refactor-manifest-adoption-completion.md) | B1 manifest 採用完了（test:wasm・cache paths・parity 2行・prose を manifest 宇宙へ） | 8 | 2 | 1.0 | 0.5 | **32** |
| 2 | [2026-09-21-27](2026-09-21-27-refactor-wasm-success-mock-migration.md) | A2 wasm-success mock 残り2箇所を createNodeWasmInit へ + 陳腐 doc 2行 | 4 | 1 | 1.0 | 0.25 | **16** |
| 3 | [2026-09-21-28](2026-09-21-28-refactor-privacy-predecision-pending-builder.md) | A1 privacy bypass の pre-decision 化 + pending builder 抽出（R4 クロージャ） | 5 | 1 | 1.0 | 0.5 | **10** |
| 4 | [2026-09-21-29](2026-09-21-29-refactor-opfs-search-input-union.md) | A3 RunOpfsSearchArgs の判別共用体化 | 3 | 0.5 | 1.0 | 0.25 | **6** |
| 5 | [2026-09-21-30](2026-09-21-30-refactor-extract-apply-pair-retirement.md) | A4 extract/apply ペアの移行期残余解消 | 3 | 1 | 0.8 | 0.5 | **4.8** |

## 実行順と依存

- 全5件がファイル非重複 → 1バッチ並列実装可（順序は RICE 降順を維持: 26 → 27 → 28 → 29 → 30）
- 依存なし（26 は scripts/ci/wxt/docs、27 は test 2ファイル+rust doc 2行、28 は pipeline step+pendingStorage、29 は searchExecution、30 は content 3ファイル）

## 台帳送り

- 新規ゼロ。P3（2 wire table hop codec・トリガー: 同時改修時）/ P4（resolver 入力 literal・トリガー: backend 状態 field 追加時）はトリガー不発のまま据え置き。R4 は本ラウンドの PBI 28 でクローズ

## なぜなぜ要約

- 「前ラウンド完了直後に follow-up が出るのはなぜか」→ PBI-18 の実装者が所有権外の4箇所（ci cache・test:wasm・CSP prose・docs）を意図的に保留した。大口 SSOT 化では所有権バンドルを厳密に守る方が安全で、保留は台帳に宣言されていた — 差分ラウンドがそれを拾う構造は正常
- 「R4 が今ラウンドで実残になったか」→ deniedBy 修正で deny 側は seam 単一所有になったが、allow 側の bypass（force/whitelist）と pending 組み立ては未処理のままだった。トリガー（privacy step 改修）が発火したことで再評価し、実残と判定
- 「A4 が移行期のまま残ったか」→ PBI-25 が pair 互換を意図的に保持した（extractor.ts が禁止ファイルだったため）。今ラウンドで所有障壁が消えたので narrow 化が可能に
